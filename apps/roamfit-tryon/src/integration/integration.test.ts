// Mock integration tests for the try-on boundary. FIXTURES ONLY: these prove contract handling, not live Gemini/Shopify/video.
import { describe, expect, it } from 'vitest'
import { compositionConflicts, findSecrets, previewFingerprint, previewLookKey, validatePreviewRequest, type TryOnGarment } from '../../shared/tryon/contract.js'
import { DESTINATIONS, findBackground, matchDestination } from './backgrounds'
import { roamfitFixtureOutfits, roamfitWardrobe, rewriteTeamFixtureUrl, teamPlanRequest, teamPlanResponse } from './fixtures'
import { buildPreviewRequest, type AvatarInput } from './previewRequest'
import { acceptJobUpdate, emptyStore, startRequest } from './previewStore'
import { addGarment, applyLook, emptySelection, removeGarment, setTopLayering, toggleGarment } from './selection'
import { inferCategory, normalizeStorefrontProduct, productToGarment, type StorefrontProductNode } from './shopifyAdapter'
import { adaptOutfitPlan, buildGarmentIndex, resolveDailyOutfit, wardrobeItemToGarment } from './teamAdapter'

const plan = adaptOutfitPlan(teamPlanResponse, [...teamPlanRequest.wardrobe, ...roamfitWardrobe], { resolveImageUrl: rewriteTeamFixtureUrl, isFixture: true })
const index = plan.index
const g = (id: string) => index.get(id)!
const kyoto = findBackground('bg-kyoto-ninenzaka-morning-v1')!
const montreal = findBackground('bg-montreal-old-port-street-v1')!
const littleSelf: AvatarInput = { mode: 'stylized', creationMethod: 'text', description: 'shoulder-length black hair, round glasses', personMediaId: null }
const realMe: AvatarInput = { mode: 'realistic', creationMethod: 'photo', description: '', personMediaId: 'demo-person-v1' }
let rev = 0
const build = (selection: ReturnType<typeof emptySelection>, avatar = littleSelf, background = montreal) =>
  buildPreviewRequest({ requestId: `req-${++rev}`, inputRevision: rev, avatar, selection, index, background, previewMode: 'turnaround' })

// FIXTURE Storefront node in the exact shape server/shopify.js requests. example.com domain: not a real listing.
const SHOP_NODE: StorefrontProductNode = {
  id: 'gid://shopify/Product/1000000001', handle: 'fixture-hooded-rain-shell', title: 'FIXTURE Hooded Rain Shell', vendor: 'Fixture Outfitters', productType: 'Jacket', tags: ['rain'],
  onlineStoreUrl: null, featuredImage: { url: 'https://cdn.shopify.com/s/files/fixture/rain-shell.jpg' }, images: { nodes: [] },
  priceRange: { minVariantPrice: { amount: '120.0', currencyCode: 'USD' }, maxVariantPrice: { amount: '120.0', currencyCode: 'USD' } },
  variants: { nodes: [
    { id: 'gid://shopify/ProductVariant/2000000001', title: 'S / Black', availableForSale: true, price: { amount: '120.0', currencyCode: 'USD' }, selectedOptions: [{ name: 'Size', value: 'S' }, { name: 'Color', value: 'Black' }] },
    { id: 'gid://shopify/ProductVariant/2000000002', title: 'M / Black', availableForSale: true, price: { amount: '120.0', currencyCode: 'USD' }, selectedOptions: [{ name: 'Size', value: 'M' }, { name: 'Color', value: 'Black' }] },
  ] },
}

describe('team contract adapter (real team example payload)', () => {
  it('converts every fixture WardrobeItem and rewrites fixture image hosts only', () => {
    expect(index.size).toBe(13)
    expect(g('wd-03')).toMatchObject({ id: 'wd-03', category: 'top', source: 'wardrobe', imageUrl: '/fixtures/team-wardrobe/wd-03.jpg', imageStatus: 'ok' })
    expect(plan.issues).toEqual([])
  })
  it('resolves DailyOutfit wardrobeItemIds into look cards, preserving rationale, tips and missing-item needs', () => {
    const look = plan.looks.find(l => l.id === 'look-01')!
    expect(look.garmentIds).toEqual(['wd-01', 'wd-03', 'wd-05', 'wd-06', 'wd-09', 'wd-10'])
    expect(look.layeredTops).toBe(true)
    expect(look.missingItems[0]).toMatchObject({ id: 'miss-01-01', priority: 'essential' })
    expect(look.missingItems[0]).not.toHaveProperty('price')
    expect(look.stylingTips.length).toBe(3)
  })
  it('marks unknown IDs unavailable instead of inventing garments, and de-duplicates repeated IDs', () => {
    const look = resolveDailyOutfit({ ...teamPlanResponse.outfits[1], wardrobeItemIds: ['wd-01', 'wd-01', 'wd-99'] }, index)
    expect(look.garmentIds).toEqual(['wd-01'])
    expect(look.unavailableIds).toEqual(['wd-99'])
    expect(index.has('wd-99')).toBe(false)
  })
  it('flags B demo-wardrobe SVGs as unsupported for the image model', () => {
    const r = wardrobeItemToGarment({ id: 'top-01', name: 'Cream sweater', category: 'top', color: 'cream', styleTags: [], imageUrl: '/wardrobe/top-01.svg' })
    expect(r.garment!.imageStatus).toBe('unsupported-format')
    expect(r.issues[0].code).toBe('IMAGE_UNSUPPORTED')
  })
})

describe('user stories', () => {
  it('1. selects one wardrobe top', () => {
    const r = toggleGarment(emptySelection(), g('wd-01'), index)
    expect(r.state.garmentIds).toEqual(['wd-01'])
  })
  it('2. selects pants and a cardigan (one bottom, one outer layer)', () => {
    let s = addGarment(emptySelection(), g('rf-trousers-gingham'), index).state
    s = addGarment(s, g('rf-cardigan-black'), index).state
    expect(s.garmentIds).toEqual(['rf-trousers-gingham', 'rf-cardigan-black'])
    const r = addGarment(s, g('wd-06'), index) // second bottom replaces the first, with a notice
    expect(r.state.garmentIds).toEqual(['rf-cardigan-black', 'wd-06'])
    expect(r.notice).toMatch(/replaced Gingham flared trousers/)
  })
  it('3. deselects a garment', () => {
    const s = addGarment(addGarment(emptySelection(), g('wd-01'), index).state, g('wd-06'), index).state
    expect(removeGarment(s, 'wd-01').state.garmentIds).toEqual(['wd-06'])
    expect(toggleGarment(s, g('wd-06'), index).state.garmentIds).toEqual(['wd-01'])
  })
  it('conflict policy: dress replaces top+bottom; a top replaces the dress; accessories cap at 3', () => {
    let s = addGarment(addGarment(emptySelection(), g('wd-01'), index).state, g('wd-06'), index).state
    const d = addGarment(s, g('wd-07'), index)
    expect(d.state.garmentIds).toEqual(['wd-07'])
    expect(d.notice).toMatch(/replaced/)
    s = addGarment(d.state, g('wd-02'), index).state
    expect(s.garmentIds).toEqual(['wd-02'])
    expect(compositionConflicts([g('wd-07'), g('wd-01')])).toHaveLength(1)
    const tops = setTopLayering(s, true, index).state
    expect(addGarment(tops, g('wd-03'), index).state.garmentIds).toEqual(['wd-02', 'wd-03'])
  })
  it('4. chooses a complete AI-recommended look; no generation is triggered by selection', () => {
    const r = applyLook(plan.looks[0], index)
    expect(r.state).toMatchObject({ garmentIds: plan.looks[0].garmentIds, sourceOutfitId: 'look-01', allowTopLayering: true })
    expect(r.skippedIds).toEqual([])
    const b = build(r.state)
    expect(b.ok).toBe(true)
    expect(b.request.selectedLook).toEqual({ garmentIds: plan.looks[0].garmentIds, sourceOutfitId: 'look-01', allowTopLayering: true })
  })
  it('5. adds a real Shopify garment: requires a variant and preserves product/variant/link/price/size', () => {
    const p = normalizeStorefrontProduct(SHOP_NODE, 'fixture-store.example', 'gap-01')
    expect(productToGarment(p, {})).toMatchObject({ ok: false, code: 'VARIANT_REQUIRED' })
    const r = productToGarment(p, { variantId: 'gid://shopify/ProductVariant/2000000002' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.garment).toMatchObject({ id: 'shopify:gid://shopify/ProductVariant/2000000002', source: 'shopify', category: 'outerwear', productId: SHOP_NODE.id,
      variantId: 'gid://shopify/ProductVariant/2000000002', productUrl: 'https://fixture-store.example/products/fixture-hooded-rain-shell', selectedSize: 'M', color: 'Black',
      price: { amount: '120.0', currencyCode: 'USD' }, merchant: 'Fixture Outfitters', imageUrl: SHOP_NODE.featuredImage!.url })
    const idx = buildGarmentIndex(teamPlanRequest.wardrobe, { resolveImageUrl: rewriteTeamFixtureUrl }, [r.garment]).index
    const s = addGarment(applyLook(plan.looks[1], idx).state, r.garment, idx)
    expect(s.state.garmentIds).toContain(r.garment.id)
    expect(s.state.garmentIds).not.toContain('wd-04') // one outer layer: the raincoat replaced the blazer
    const req = buildPreviewRequest({ requestId: 'shop-1', inputRevision: 1, avatar: littleSelf, selection: s.state, index: idx, background: kyoto, previewMode: 'turnaround' })
    expect(req.ok).toBe(true)
    expect(req.request.garments.find(x => x.source === 'shopify')).toMatchObject({ productId: SHOP_NODE.id, variantId: 'gid://shopify/ProductVariant/2000000002' })
  })
  it('5b. a Shopify product without an image is rejected, never given a placeholder; ambiguous category must be chosen', () => {
    const p = normalizeStorefrontProduct({ ...SHOP_NODE, featuredImage: null }, 'fixture-store.example')
    expect(productToGarment(p, { variantId: 'gid://shopify/ProductVariant/2000000001' })).toMatchObject({ ok: false, code: 'IMAGE_MISSING' })
    expect(inferCategory({ productType: 'Shirt dress', tags: [], title: '' })).toBeUndefined()
    const bad: TryOnGarment = { id: 'shopify:x', category: 'top', name: 'x', imageUrl: 'https://cdn.shopify.com/x.jpg', source: 'shopify', productId: 'p' }
    expect(validatePreviewRequest({ ...build(addGarment(emptySelection(), g('wd-01'), index).state).request, selectedLook: { garmentIds: ['shopify:x'] }, garments: [bad] }).errors.map(e => e.code)).toContain('SHOPIFY_VARIANT_REQUIRED')
  })
  it('6. switching My Little Self → Real Me keeps the outfit and destination; the preview identity changes', () => {
    const s = applyLook(plan.looks[1], index).state
    const a = build(s, littleSelf, kyoto), b = build(s, realMe, kyoto)
    expect(b.request.selectedLook.garmentIds).toEqual(a.request.selectedLook.garmentIds)
    expect(b.request.background).toEqual(a.request.background)
    expect(b.lookKey).not.toBe(a.lookKey)
    expect(b.request.avatar).toEqual({ mode: 'realistic', creationMethod: 'photo', personMediaId: 'demo-person-v1' })
  })
  it('7. changing Montreal → Kyoto does not change the preview cache identity (no regeneration)', () => {
    const s = applyLook(plan.looks[1], index).state
    const m = build(s, littleSelf, montreal), k = build(s, littleSelf, kyoto)
    expect(k.request.background.destinationId).toBe('kyoto')
    expect(k.lookKey).toBe(m.lookKey)
    expect(previewFingerprint(k.request, 'p1')).toBe(previewFingerprint(m.request, 'p1'))
    expect(matchDestination(teamPlanRequest.trip.destination)?.id).toBe('kyoto')
    expect(DESTINATIONS.every(d => d.backgrounds.every(b => b.credit.license))).toBe(true)
  })
  it('9/10. revisiting a look reuses its key; changing the outfit or variant gives a distinct key', () => {
    const s1 = applyLook(plan.looks[0], index).state, s2 = applyLook(plan.looks[1], index).state
    expect(build(s1).lookKey).toBe(build({ ...s1 }).lookKey)
    expect(build(s2).lookKey).not.toBe(build(s1).lookKey)
    const req = build(s1).request
    const withVariant = { ...req, garments: req.garments.map((x, i) => (i === 0 ? { ...x, variantId: 'v2' } : x)) }
    expect(previewLookKey(withVariant)).not.toBe(previewLookKey(req))
    expect(previewFingerprint(req, 'model-a')).not.toBe(previewFingerprint(req, 'model-b'))
  })
  it('11. a garment whose image is missing is shown but blocks the preview with an explicit error', () => {
    const r = wardrobeItemToGarment({ id: 'wd-x', name: 'Mystery scarf', category: 'accessory', imageUrl: '' })
    expect(r.garment!.imageStatus).toBe('missing')
    const idx = new Map(index); idx.set('wd-x', r.garment!)
    const s = addGarment(emptySelection(), r.garment!, idx).state
    const b = buildPreviewRequest({ requestId: 'm', inputRevision: 1, avatar: littleSelf, selection: s, index: idx, background: kyoto, previewMode: 'turnaround' })
    expect(b.ok).toBe(false)
    expect(b.errors.map(e => e.code)).toContain('GARMENT_IMAGE_MISSING')
  })
  it('validation: Real Me needs a person photo; Little Self needs text or photo; no keys; no inline base64', () => {
    const s = applyLook(plan.looks[1], index).state
    expect(build(s, { ...realMe, personMediaId: null }).errors.map(e => e.code)).toContain('PERSON_PHOTO_REQUIRED')
    expect(build(s, { ...littleSelf, description: '' }).errors.map(e => e.code)).toContain('AVATAR_INPUT_REQUIRED')
    expect(build(s, { ...littleSelf, creationMethod: 'photo', personMediaId: null }).errors.map(e => e.code)).toContain('AVATAR_INPUT_REQUIRED')
    const req = build(s).request
    expect(validatePreviewRequest({ ...req, apiKey: 'abc123' }).errors.map(e => e.code)).toContain('SECRET_IN_REQUEST')
    expect(findSecrets({ note: 'AIza' + 'x'.repeat(35) })).toEqual(['$.note'])
    expect(validatePreviewRequest({ ...req, avatar: { ...req.avatar, personMediaId: 'data:image/png;base64,AAAA' } }).errors.map(e => e.code)).toContain('INLINE_MEDIA')
    expect(validatePreviewRequest({ ...req, selectedLook: { garmentIds: [...req.selectedLook.garmentIds, 'ghost'] } }).errors.map(e => e.code)).toContain('UNKNOWN_GARMENT')
  })
  it('12/13. stale responses never replace the active job; failures surface only for the current request', () => {
    const a = build(applyLook(plan.looks[0], index).state), b = build(applyLook(plan.looks[1], index).state)
    let st = startRequest(emptyStore(), { requestId: a.request.requestId, inputRevision: a.request.inputRevision, lookKey: a.lookKey })
    st = startRequest(st, { requestId: b.request.requestId, inputRevision: b.request.inputRevision, lookKey: b.lookKey }) // user changed outfit
    const lateReady = { jobId: 'j1', requestId: a.request.requestId, inputRevision: a.request.inputRevision, status: 'ready' as const }
    st = acceptJobUpdate(st, lateReady, a.lookKey)
    expect(st.active?.requestId).toBe(b.request.requestId)
    expect(st.byLookKey[a.lookKey].job.status).toBe('ready') // kept for instant revisit of look A
    expect(st.byLookKey[b.lookKey]).toBeUndefined()
    const lateFail = { jobId: 'j0', requestId: 'req-old', inputRevision: 0, status: 'failed' as const, error: { code: 'AI_UNAVAILABLE', message: 'x', retryable: true } }
    st = acceptJobUpdate(st, lateFail, b.lookKey)
    expect(st.byLookKey[b.lookKey]).toBeUndefined()
    const curFail = { jobId: 'j2', requestId: b.request.requestId, inputRevision: b.request.inputRevision, status: 'failed' as const, error: { code: 'AI_UNAVAILABLE', message: 'down', retryable: true } }
    st = acceptJobUpdate(st, curFail, b.lookKey)
    expect(st.byLookKey[b.lookKey].job.error?.code).toBe('AI_UNAVAILABLE')
    expect(st.active).toBeNull()
  })
  it('Roamfit fixture look is labelled as fixture and resolves fully', () => {
    const l = resolveDailyOutfit(roamfitFixtureOutfits[0], index, { isFixture: true })
    expect(l).toMatchObject({ isFixture: true, garmentIds: ['rf-tee-ivory', 'rf-trousers-gingham'], unavailableIds: [] })
  })
})
