// HTTP-level tests for the Roamfit preview service. No paid calls: live generation is forced off (or served from a
// pre-seeded cache entry), so these prove the job contract, caching and safety checks, NOT live Gemini output.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import express from 'express'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { previewRouter } from './routes.js'
import { createPreviewService } from './service.js'
import { createPreviewCache } from './cache.js'
import { previewFingerprint } from '../../shared/tryon/contract.js'
import { modelConfig } from '../tryon/models.js'
import { PIPELINE_VERSION } from './service.js'
import { existsSync } from 'node:fs'
import { CACHE_DIR } from '../avatar3d/cache.js'

// These tests read locally generated results (spike-results/avatar-cache, git-ignored because they derive from a personal
// photo). On a fresh clone they are skipped, not failed.
const HAS_LOCAL_CACHE = existsSync(path.join(CACHE_DIR, 'demo__little-self__stroll', 'meta.json'))
const itLocal = it.skipIf(!HAS_LOCAL_CACHE)

const OFF = () => ({ enabled: false, reasons: ['test: live disabled'] })
let server, base, tmp, cache
const tee = { id: 'rf-tee-ivory', category: 'top', name: 'Ivory square-neck tee', imageUrl: '/media/garment_white_squareneck_tee.png', source: 'wardrobe' }
const trousers = { id: 'rf-trousers-gingham', category: 'bottom', name: 'Gingham flared trousers', imageUrl: '/media/garment_gingham_flare_trousers.png', source: 'wardrobe' }
const sweater = { id: 'wd-03', category: 'top', name: 'Beige knit sweater', imageUrl: '/fixtures/team-wardrobe/wd-03.jpg', source: 'wardrobe' }
const jeans = { id: 'wd-06', category: 'bottom', name: 'Blue denim jeans', imageUrl: '/fixtures/team-wardrobe/wd-06.jpg', source: 'wardrobe' }
const MONTREAL = { id: 'bg-montreal-old-port-street-v1', destinationId: 'montreal', imageUrl: '/backgrounds/montreal-old-port-street.jpg' }
const KYOTO = { id: 'bg-kyoto-ninenzaka-morning-v1', destinationId: 'kyoto', imageUrl: '/backgrounds/kyoto-ninenzaka-morning.jpg' }
let n = 0
const req = (garments, extra = {}) => ({ contractVersion: 'tryon-preview.v1', requestId: `t-${++n}`, inputRevision: n,
  avatar: { mode: 'realistic', creationMethod: 'photo', personMediaId: 'demo-person-v1' }, selectedLook: { garmentIds: garments.map(g => g.id) }, garments,
  background: MONTREAL, previewMode: 'turnaround', ...extra })
const post = (body, headers = {}) => fetch(`${base}/api/v1/tryon-previews`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
async function until(jobId, pred, ms = 3000) {
  const t0 = Date.now()
  for (;;) { const j = await (await fetch(`${base}/api/v1/tryon-previews/${jobId}`)).json(); if (pred(j) || Date.now() - t0 > ms) return j; await new Promise(r => setTimeout(r, 15)) }
}

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-preview-'))
  // Stand-in for the private demo person photo (not bundled in the repo). Only existence is checked; live generation is off.
  await fs.mkdir(path.join(tmp, 'private/derived'), { recursive: true })
  await fs.writeFile(path.join(tmp, 'private/derived/person_front.png'), Buffer.from('89504e470d0a1a0a', 'hex'))
  process.env.ROAMFIT_PRIVATE_ASSETS_DIR = path.join(tmp, 'private')
  cache = createPreviewCache(tmp)
  const app = express()
  let liveOn = false
  app.use('/__live', (r, s) => { liveOn = r.query.on === '1'; s.end() })
  app.use(previewRouter({ service: createPreviewService({ cache, delays: { step: 5 }, live: () => (liveOn ? { enabled: true, reasons: [] } : OFF()) }), live: OFF }))
  delete process.env.SHOPIFY_STORE_DOMAIN; delete process.env.SHOPIFY_STOREFRONT_TOKEN
  await new Promise(ok => { server = app.listen(0, '127.0.0.1', ok) })
  base = `http://127.0.0.1:${server.address().port}`
})
afterAll(async () => { server?.close(); await fs.rm(tmp, { recursive: true, force: true }) })

describe('POST /api/v1/tryon-previews', () => {
  itLocal('8. generate: mock job moves through async states to ready, labelled FIXTURE, with a viewer manifest', async () => {
    const r = await post(req([sweater, jeans]))
    expect(r.status).toBe(202)
    const j0 = await r.json()
    expect(j0).toMatchObject({ status: 'queued', provider: 'mock', provenance: 'fixture' })
    const j = await until(j0.jobId, x => x.status === 'ready' || x.status === 'failed')
    expect(j.status).toBe('ready')
    expect(j.requestId).toBe(j0.requestId)
    const m = await (await fetch(base + j.turnaroundManifestUrl)).json()
    expect(m).toMatchObject({ manifestVersion: 'turnaround.v1', provenance: 'fixture', method: 'views', verifiedFullRotation: false, neutralBackground: true })
    expect(m.provenanceNote).toMatch(/NOT rendered/)
    expect(m.views.some(v => v.origin !== 'generated')).toBe(true) // the mirrored view is disclosed
  })
  itLocal('9. an approved previously generated asset is returned instantly when inputs truly match', async () => {
    const r = await post(req([tee, trousers]))
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j).toMatchObject({ status: 'ready', provider: 'approved-asset', provenance: 'approved-asset' })
    expect(j.provenanceNote).toMatch(/demo photo/)
    // Real Me ignores notes, so a note still matches. A Little Self note changes the inputs, so it does NOT match.
    const k = await (await post(req([tee, trousers], { avatar: { mode: 'realistic', creationMethod: 'photo', personMediaId: 'demo-person-v1', description: 'hair in a bun' } }))).json()
    expect(k.provider).toBe('approved-asset')
    const ls = { mode: 'stylized', creationMethod: 'photo', personMediaId: 'demo-person-v1' }
    expect((await (await post(req([tee, trousers], { avatar: { ...ls, description: 'short black hair, small gold hoop earrings' } }))).json()).provider).toBe('approved-asset')
    expect((await (await post(req([tee, trousers], { avatar: { ...ls, description: 'long red hair' } }))).json()).provider).toBe('mock')
  })
  it('7. changing only the background keeps the same fingerprint and the same asset', async () => {
    const a = await (await post(req([tee, trousers]))).json()
    const b = await (await post(req([tee, trousers], { background: KYOTO }))).json()
    expect(b.fingerprint).toBe(a.fingerprint)
    expect(b.previewImageUrl).toBe(a.previewImageUrl)
  })
  itLocal('9/10. live path: a cached fingerprint is reused without generating; a different outfit misses the cache', async () => {
    await fetch(`${base}/__live?on=1`)
    const c = modelConfig()
    const pv = `${PIPELINE_VERSION}|planner=${c.planner}|image=${c.image}|qa=${c.qa}`
    const body = req([sweater, jeans], { authorization: { sendToGemini: true } })
    await cache.put(previewFingerprint(body, pv), { avatarCacheKey: 'demo__real-me__stroll', provider: 'live', providerVersion: pv })
    const r = await post(body)
    const j = await r.json()
    expect(r.status).toBe(200)
    expect(j).toMatchObject({ status: 'ready', provider: 'live', provenance: 'cache' })
    // Without consent the live provider is not used even though it is enabled.
    const noConsent = await (await post(req([sweater, jeans]))).json()
    expect(noConsent.provider).toBe('mock')
    expect(noConsent.provenanceNote).toMatch(/not authorised/)
    await fetch(`${base}/__live?on=0`)
  })
  it('12. a provider error becomes a failed job with a structured, retryable error', async () => {
    const j0 = await (await post(req([sweater, jeans]), { 'x-roamfit-simulate': 'error' })).json()
    const j = await until(j0.jobId, x => x.status === 'failed' || x.status === 'ready')
    expect(j).toMatchObject({ status: 'failed', error: { code: 'SIMULATED_PROVIDER_ERROR', retryable: true } })
    expect(j.turnaroundManifestUrl).toBeUndefined()
  })
  it('resubmitting the same requestId + inputRevision is idempotent', async () => {
    const body = req([sweater, jeans])
    const a = await (await post(body)).json(), b = await (await post(body)).json()
    expect(b.jobId).toBe(a.jobId)
  })
  it('11. rejects missing images, unauthorised hosts, unknown person media, secrets and invalid looks', async () => {
    const noImg = await post(req([{ ...sweater, imageUrl: '' }]))
    expect(noImg.status).toBe(400)
    expect((await noImg.json()).error.code).toBe('GARMENT_IMAGE_MISSING')
    const host = await post(req([{ ...sweater, imageUrl: 'https://evil.example/x.jpg' }]))
    expect(host.status).toBe(403)
    expect((await host.json()).error.code).toBe('MEDIA_FORBIDDEN')
    const path1 = await post(req([{ ...sweater, imageUrl: '/media/person_front.png' }]))
    expect((await path1.json()).error.code).toBe('MEDIA_FORBIDDEN')
    const person = await post(req([sweater], { avatar: { mode: 'realistic', personMediaId: '../../etc/passwd' } }))
    expect((await person.json()).error.code).toBe('MEDIA_FORBIDDEN')
    const secret = await post({ ...req([sweater]), apiKey: 'AIza' + 'q'.repeat(35) })
    const sb = await secret.json()
    expect(sb.error.code).toBe('SECRET_IN_REQUEST')
    expect(sb.requestId).toMatch(/^t-/)
    const conflict = await post(req([sweater, tee]))
    expect((await conflict.json()).error.code).toBe('LOOK_CONFLICT')
  })
})

describe('other Roamfit endpoints', () => {
  it('capabilities report live generation as disabled with reasons, and video as not exposed', async () => {
    const c = await (await fetch(`${base}/api/v1/tryon/capabilities`)).json()
    expect(c.contractVersion).toBe('tryon-preview.v1')
    expect(c.providers.live.enabled).toBe(false)
    expect(c.video.enabled).toBe(false)
  })
  it('Shopify search without credentials returns 503 instead of demo products', async () => {
    const r = await fetch(`${base}/api/v1/commerce/products?q=rain+coat`)
    expect(r.status).toBe(503)
    expect((await r.json()).error.code).toBe('SHOPIFY_NOT_CONFIGURED')
  })
  it('approve is refused for a job that is not awaiting approval', async () => {
    const j = await (await post(req([tee, trousers]))).json()
    const r = await fetch(`${base}/api/v1/tryon-previews/${j.jobId}/approve`, { method: 'POST' })
    expect(r.status).toBe(409)
  })
})
