// Right sidebar wardrobe dashboard: Pieces (one garment = one card), Looks (team DailyOutfit[]), Shop (Shopify for gaps),
// plus the selected-look tray with the explicit Generate action. Tapping a card only updates selection state.
import { useMemo, useState } from 'react'
import { GARMENT_CATEGORIES, type GarmentCategory, type TryOnGarment, type ValidationError } from '../../shared/tryon/contract.js'
import type { SelectionState } from '../integration/selection'
import { inferCategory, normalizeStorefrontProduct, productToGarment, type CommerceProduct, type StorefrontProductNode } from '../integration/shopifyAdapter'
import type { GarmentIndex, LookCard } from '../integration/teamAdapter'
import type { TeamShoppingGap } from '../integration/teamContracts'

const CAT_LABEL: Record<GarmentCategory, string> = { top: 'Top', bottom: 'Bottom', dress: 'Dress', outerwear: 'Outerwear', shoes: 'Shoes', accessory: 'Accessory' }
const money = (p?: { amount: string; currencyCode: string }) => (p ? new Intl.NumberFormat(undefined, { style: 'currency', currency: p.currencyCode }).format(Number(p.amount)) : '')

function GarmentImage({ g, className }: { g: TryOnGarment; className?: string }) {
  const [broken, setBroken] = useState(false)
  if (!g.imageUrl || broken) return <div className={`rf-noimg ${className ?? ''}`} role="img" aria-label={`${g.name}: image unavailable`}>{g.imageUrl ? 'Image failed to load' : 'No image'}</div>
  return <img className={className} src={g.imageUrl} alt={g.name} loading="lazy" onError={() => setBroken(true)} />
}

type Props = {
  index: GarmentIndex
  looks: LookCard[]
  gaps: TeamShoppingGap[]
  selection: SelectionState
  notice?: string
  onToggle: (g: TryOnGarment) => void
  onUseLook: (l: LookCard) => void
  onLayering: (on: boolean) => void
  onAddShopify: (g: TryOnGarment) => void
  validation: ValidationError[]
  generate: { label: string; disabled: boolean; hint?: string; onClick: () => void }
}

export function WardrobeSidebar(p: Props) {
  const [tab, setTab] = useState<'pieces' | 'looks' | 'shop'>('looks')
  const [cat, setCat] = useState<GarmentCategory | 'all'>('all')
  const [shopQuery, setShopQuery] = useState<{ q: string; gapId?: string; category?: GarmentCategory } | null>(null)
  const garments = useMemo(() => [...p.index.values()], [p.index])
  const counts = useMemo(() => Object.fromEntries(GARMENT_CATEGORIES.map(c => [c, garments.filter(g => g.category === c).length])), [garments])
  const shown = cat === 'all' ? garments : garments.filter(g => g.category === cat)
  const selected = p.selection.garmentIds.map(id => p.index.get(id)).filter((g): g is TryOnGarment => !!g)

  return <aside className="rf-side" aria-label="Wardrobe">
    <div className="rf-tabs" role="tablist">
      {(['looks', 'pieces', 'shop'] as const).map(t => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
        {t === 'looks' ? `Looks · ${p.looks.length}` : t === 'pieces' ? `Pieces · ${garments.length}` : 'Shop'}</button>)}
    </div>

    <div className="rf-scroll">
      {tab === 'pieces' && <>
        <div className="rf-chips" role="group" aria-label="Filter by category">
          <button className={cat === 'all' ? 'on' : ''} onClick={() => setCat('all')}>All</button>
          {GARMENT_CATEGORIES.map(c => <button key={c} disabled={!counts[c]} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{CAT_LABEL[c]} <small>{counts[c]}</small></button>)}
        </div>
        <div className="rf-grid">
          {shown.map(g => {
            const on = p.selection.garmentIds.includes(g.id)
            return <div key={g.id} className={`rf-piece ${on ? 'on' : ''}`} role="button" tabIndex={0} aria-pressed={on}
              onClick={() => p.onToggle(g)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.onToggle(g) } }}>
              <div className="rf-piece-img"><GarmentImage g={g} />{on && <span className="rf-check" aria-hidden>✓</span>}
                {g.imageStatus && g.imageStatus !== 'ok' && <span className="rf-flag">{g.imageStatus === 'missing' ? 'no image' : 'not previewable'}</span>}</div>
              <b>{g.name}</b>
              <small>{CAT_LABEL[g.category]}{g.color ? ` · ${g.color}` : ''}</small>
              {g.source === 'shopify' && <small className="rf-shop">{g.merchant ?? 'Shopify'}{g.price ? ` · ${money(g.price)}` : ''}{g.selectedSize ? ` · ${g.selectedSize}` : ''}</small>}
              <button className={`rf-add ${on ? 'on' : ''}`} onClick={e => { e.stopPropagation(); p.onToggle(g) }}>{on ? 'Remove' : 'Add'}</button>
            </div>
          })}
        </div>
      </>}

      {tab === 'looks' && <>
        {!p.looks.length && <p className="rf-fine">No recommended looks yet. Looks come from the team outfit planner.</p>}
        {p.looks.map(l => <LookCardView key={l.id} look={l} index={p.index} active={p.selection.sourceOutfitId === l.id} onUse={() => p.onUseLook(l)}
          onShop={(q, category) => { setShopQuery({ q, category }); setTab('shop') }} />)}
      </>}

      {tab === 'shop' && <ShopPanel gaps={p.gaps} initial={shopQuery} onAdd={g => { p.onAddShopify(g); setTab('pieces') }} />}
    </div>

    <section className="rf-tray" aria-label="Selected look">
      <div className="rf-tray-head"><b>Selected look</b><small>{selected.length ? `${selected.length} piece${selected.length > 1 ? 's' : ''}` : 'nothing selected'}</small>
        <label className="rf-layer" title="Allow two tops (e.g. a tee under a sweater)"><input type="checkbox" checked={p.selection.allowTopLayering} onChange={e => p.onLayering(e.target.checked)} /> Layer tops</label></div>
      <div className="rf-tray-items">{selected.map(g => <button key={g.id} className="rf-chip" onClick={() => p.onToggle(g)} title={`Remove ${g.name}`}>
        <GarmentImage g={g} /><span>{g.name}</span><i aria-hidden>×</i></button>)}</div>
      {p.notice && <p className="rf-notice" role="status">{p.notice}</p>}
      {!!selected.length && p.validation.length > 0 && <ul className="rf-errors">{[...new Set(p.validation.map(v => v.message))].slice(0, 4).map(m => <li key={m}>{m}</li>)}</ul>}
      <button className="rf-generate" disabled={p.generate.disabled} onClick={p.generate.onClick}>{p.generate.label}</button>
      {p.generate.hint && <small className="rf-fine">{p.generate.hint}</small>}
    </section>
  </aside>
}

function LookCardView({ look, index, active, onUse, onShop }: { look: LookCard; index: GarmentIndex; active: boolean; onUse: () => void; onShop: (q: string, c?: GarmentCategory) => void }) {
  const [open, setOpen] = useState(false)
  return <article className={`rf-look ${active ? 'on' : ''}`}>
    <div className="rf-look-head"><b>{look.name}</b>{look.isFixture && <em className="rf-tag">fixture</em>}</div>
    <small className="rf-meta">{new Date(`${look.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}{look.occasions.length ? ` · ${look.occasions.slice(0, 3).join(', ')}` : ''}</small>
    <div className="rf-thumbs">
      {look.garmentIds.map(id => { const g = index.get(id)!; return <GarmentImage key={id} g={g} /> })}
      {look.unavailableIds.map(id => <div key={id} className="rf-noimg unavailable" title={`${id} is not in the wardrobe`}>Unavailable<br /><code>{id}</code></div>)}
    </div>
    <p className={`rf-why ${open ? 'open' : ''}`}>{look.rationale}</p>
    {open && !!look.stylingTips.length && <ul className="rf-tips">{look.stylingTips.map(t => <li key={t}>{t}</li>)}</ul>}
    {!!look.missingItems.length && <div className="rf-needs">{look.missingItems.map(m => <div key={m.id}>
      <span><b>Not in your wardrobe{m.priority === 'essential' ? ' (essential)' : ''}:</b> {m.description}</span>
      <button className="rf-link" onClick={() => onShop(m.searchQuery, (m.category ?? undefined) as GarmentCategory | undefined)}>Find on Shopify</button></div>)}</div>}
    <div className="rf-look-foot">
      <button className="rf-link" onClick={() => setOpen(o => !o)}>{open ? 'Less' : 'Why this look'}</button>
      <button className="rf-use" onClick={onUse} disabled={!look.garmentIds.length}>{active ? 'Loaded ✓' : 'Use this look'}</button>
    </div>
  </article>
}

type ShopState = { status: 'idle' | 'loading' | 'ok' | 'unconfigured' | 'error'; products: CommerceProduct[]; message?: string }

function ShopPanel({ gaps, initial, onAdd }: { gaps: TeamShoppingGap[]; initial: { q: string; gapId?: string; category?: GarmentCategory } | null; onAdd: (g: TryOnGarment) => void }) {
  const [q, setQ] = useState(initial?.q ?? '')
  const [hint, setHint] = useState<{ gapId?: string; category?: GarmentCategory }>({ gapId: initial?.gapId, category: initial?.category })
  const [st, setSt] = useState<ShopState>({ status: 'idle', products: [] })
  const search = async (query: string, h = hint) => {
    if (query.trim().length < 2) return
    setSt({ status: 'loading', products: [] })
    try {
      const r = await fetch(`/api/v1/commerce/products?q=${encodeURIComponent(query)}${h.gapId ? `&gapId=${encodeURIComponent(h.gapId)}` : ''}`)
      const b = await r.json().catch(() => ({}))
      if (r.status === 503 && b.error?.code === 'SHOPIFY_NOT_CONFIGURED') return setSt({ status: 'unconfigured', products: [], message: b.error.message })
      if (!r.ok) return setSt({ status: 'error', products: [], message: b.error?.message ?? `HTTP ${r.status}` })
      setSt({ status: 'ok', products: (b.nodes as StorefrontProductNode[]).map(n => normalizeStorefrontProduct(n, b.storeDomain, h.gapId)) })
    } catch (e) { setSt({ status: 'error', products: [], message: (e as Error).message }) }
  }
  return <div className="rf-shoppanel">
    <p className="rf-fine">Planner gaps are shopping <b>needs</b>, not products. Only real Shopify results can be added, and only after you pick a variant.</p>
    {!!gaps.length && <div className="rf-gaps">{gaps.map(g => <button key={g.id} className="rf-gap" onClick={() => { const h = { gapId: g.id, category: (g.category ?? undefined) as GarmentCategory | undefined }; setQ(g.searchQuery); setHint(h); search(g.searchQuery, h) }}>
      <b>{g.searchQuery}</b><small>{g.priority} · for {g.outfitIds.join(', ')}{g.similarOwnedItemIds?.length ? ` · you may own something similar (${g.similarOwnedItemIds.join(', ')})` : ''}</small></button>)}</div>}
    <form className="rf-search" onSubmit={e => { e.preventDefault(); search(q) }}><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search Shopify, e.g. black rain coat" /><button>Search</button></form>
    {st.status === 'loading' && <p className="rf-fine">Searching Shopify…</p>}
    {st.status === 'unconfigured' && <p className="rf-warn">Shopify is not connected on this server, so no products are shown. Set SHOPIFY_STORE_DOMAIN and SHOPIFY_STOREFRONT_TOKEN.</p>}
    {st.status === 'error' && <p className="rf-err">Shopify search failed: {st.message}</p>}
    {st.status === 'ok' && !st.products.length && <p className="rf-fine">No products found.</p>}
    {st.products.map(pr => <ProductRow key={pr.productId} p={pr} categoryHint={hint.category} onAdd={onAdd} />)}
  </div>
}

function ProductRow({ p, categoryHint, onAdd }: { p: CommerceProduct; categoryHint?: GarmentCategory; onAdd: (g: TryOnGarment) => void }) {
  const [variantId, setVariantId] = useState(p.variants.length === 1 ? p.variants[0].id : '')
  const [category, setCategory] = useState<GarmentCategory | ''>(inferCategory(p, categoryHint) ?? '')
  const [err, setErr] = useState('')
  const add = () => { const r = productToGarment(p, { variantId: variantId || undefined, category: category || undefined }); if (r.ok) { setErr(''); onAdd(r.garment) } else setErr(r.message) }
  return <div className="rf-product">
    {p.imageUrl ? <img src={p.imageUrl} alt={p.title} /> : <div className="rf-noimg">No image from Shopify</div>}
    <div>
      <b>{p.title}</b>
      <small>{p.merchant ?? p.storeDomain}{p.priceRange ? ` · ${money(p.priceRange.min)}` : ''} · <a href={p.productUrl} target="_blank" rel="noreferrer">View product</a></small>
      <div className="rf-row">
        <select value={variantId} onChange={e => setVariantId(e.target.value)} aria-label="Variant">
          <option value="">Choose variant…</option>
          {p.variants.map(v => <option key={v.id} value={v.id} disabled={!v.availableForSale}>{v.title}{v.price ? ` · ${money(v.price)}` : ''}{v.availableForSale ? '' : ' (sold out)'}</option>)}
        </select>
        <select value={category} onChange={e => setCategory(e.target.value as GarmentCategory)} aria-label="Category">
          <option value="">Category…</option>{GARMENT_CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
        </select>
      </div>
      <button className="rf-add" disabled={!p.imageUrl} onClick={add}>Add to look</button>
      {err && <small className="rf-err">{err}</small>}
    </div>
  </div>
}
