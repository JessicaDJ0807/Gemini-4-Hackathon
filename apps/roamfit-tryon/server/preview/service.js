// Personalized try-on preview service (Roamfit-owned). Asynchronous jobs over three providers, in this order:
//   1. approved-asset: a previously generated asset whose real inputs match this request exactly (free, instant)
//   2. live:           Gemini planner → image model → Gemini QA, then optional 4-view turnaround after user approval.
//                      Disabled unless TRYON_LIVE_ENABLED=1, a key, valid Gemini 4 model config AND per-request consent.
//                      Checks the fingerprint cache first. Never retries automatically. Never calls video or 3D providers.
//   3. mock:           clearly labelled FIXTURE result so the integration can be tested without paid calls.
// This is separate from the team's POST /v1/outfit-previews (anonymous lookbook image), which is left untouched.
import crypto from 'node:crypto'
import { previewFingerprint, previewLookKey } from '../../shared/tryon/contract.js'
import { generateSource } from '../avatar3d/sources.js'
import { keyOf, readEntry, writeEntry } from '../avatar3d/cache.js'
import { buildViewsTurnaround } from '../turnaround/service.js'
import { hasGeminiKey } from '../tryon/geminiClient.js'
import { modelConfig, validateModelConfig } from '../tryon/models.js'
import { findApprovedAsset, fixtureManifest, manifestFromCacheEntry } from './assets.js'
import { createPreviewCache } from './cache.js'
import { DEMO_PERSON_ID, loadGarmentPart } from './media.js'

export const PIPELINE_VERSION = 'roamfit-tryon-pipeline.v1'

export function liveStatus(env = process.env) {
  const reasons = []
  if (env.TRYON_LIVE_ENABLED !== '1') reasons.push('TRYON_LIVE_ENABLED is not 1')
  if (!hasGeminiKey()) reasons.push('GEMINI_API_KEY is not set')
  reasons.push(...validateModelConfig())
  return { enabled: reasons.length === 0, reasons }
}
const liveProviderVersion = () => { const c = modelConfig(); return `${PIPELINE_VERSION}|planner=${c.planner}|image=${c.image}|qa=${c.qa}` }

export function createPreviewService({ cache = createPreviewCache(), delays = { step: 400 }, live = liveStatus } = {}) {
  const jobs = new Map()       // jobId → internal job
  const byIdentity = new Map() // `${requestId}#${inputRevision}` → jobId (idempotent submit)
  const wait = ms => new Promise(r => setTimeout(r, ms))

  const publicJob = j => ({
    jobId: j.jobId, requestId: j.requestId, inputRevision: j.inputRevision, status: j.status,
    ...(j.previewImageUrl ? { previewImageUrl: j.previewImageUrl } : {}),
    ...(j.manifest ? { turnaroundManifestUrl: `/api/v1/tryon-previews/${j.jobId}/manifest` } : {}),
    ...(j.error ? { error: j.error } : {}),
    lookKey: j.lookKey, fingerprint: j.fingerprint, provider: j.provider, provenance: j.provenance, provenanceNote: j.provenanceNote,
    step: j.step, createdAt: j.createdAt, updatedAt: j.updatedAt,
  })
  const set = (j, patch) => { Object.assign(j, patch, { updatedAt: new Date().toISOString() }) }
  const fail = (j, code, message, retryable) => set(j, { status: 'failed', step: undefined, error: { code, message, retryable } })

  async function runMock(j, { simulate }) {
    for (const s of ['generating-image', 'validating']) { await wait(delays.step); set(j, { status: s, step: `mock: ${s}` }) }
    await wait(delays.step)
    if (simulate === 'error') return fail(j, 'SIMULATED_PROVIDER_ERROR', 'Simulated provider failure (mock). Nothing was generated.', true)
    const m = await fixtureManifest(j.request, j.fingerprint)
    if (!m) return fail(j, 'FIXTURE_UNAVAILABLE', 'The stored fixture asset is missing on this machine.', false)
    set(j, { status: 'ready', step: undefined, manifest: m, previewImageUrl: m.previewImageUrl })
  }

  async function finishFromCacheEntry(j, avatarCacheKey, provenance, note) {
    const m = await manifestFromCacheEntry(avatarCacheKey, { previewMode: j.request.previewMode, fingerprint: j.fingerprint, provenance, provenanceNote: note })
    if (!m) return false
    set(j, { status: 'ready', step: undefined, manifest: m, previewImageUrl: m.previewImageUrl, avatarCacheKey })
    return true
  }

  async function runLive(j) {
    const req = j.request
    const mode = req.avatar.mode === 'realistic' ? 'real-me' : 'little-self'
    const method = mode === 'real-me' ? 'photo' : (req.avatar.creationMethod ?? 'photo')
    const pid = req.avatar.personMediaId
    const profile = method === 'text' ? 'described' : pid === DEMO_PERSON_ID ? 'demo' : String(pid).replace(/\..*$/, '')
    const outfitId = `look-${j.fingerprint.slice(3, 15)}`
    const key = keyOf({ profile, mode, outfitId })
    set(j, { status: 'generating-image', step: 'loading authorised garment images', avatarCacheKey: key })
    const parts = await Promise.all(req.garments.map(loadGarmentPart))
    const summary = req.garments.map(g => `${g.name} (${g.category}${g.color ? `, ${g.color}` : ''})`).join('; ')
    await generateSource({
      mode, outfitId, profile, input: method, description: req.avatar.description ?? '', personFile: pid && pid !== DEMO_PERSON_ID ? pid : null,
      outfitDef: { name: 'Selected look', label: `exactly these garments, shown in the GARMENT reference images (keep colour, pattern and cut): ${summary}`, garmentSummary: summary, garmentImages: parts },
      onStep: s => set(j, { step: `live: ${s}` }),
    })
    const e = await readEntry(key)
    const still = `/generated/${encodeURIComponent(key)}/${encodeURIComponent(e.source.file)}`
    if (req.previewMode === 'photo') {
      await finishFromCacheEntry(j, key, 'generated-live', 'Generated for this request.')
      await cache.put(j.fingerprint, { lookKey: j.lookKey, avatarCacheKey: key, provider: 'live', providerVersion: j.providerVersion, previewMode: 'photo' })
      return
    }
    // Turnaround needs the user's approval of the still first (avoids paying for views of a wrong character).
    set(j, { status: 'awaiting-approval', step: 'approve the image to build the turnaround', previewImageUrl: still })
  }

  async function continueLive(j) {
    const key = j.avatarCacheKey
    const e = await readEntry(key)
    await writeEntry(key, { ...e, source: { ...e.source, approved: true, approvedAt: new Date().toISOString() } })
    set(j, { status: 'generating-views', step: 'Gemini: side and back views' })
    await buildViewsTurnaround(key, s => set(j, { status: s.startsWith('local') ? 'extracting-frames' : 'generating-views', step: s }))
    set(j, { status: 'validating', step: 'checking frames' })
    if (!(await finishFromCacheEntry(j, key, 'generated-live', 'Generated for this request.'))) return fail(j, 'INVALID_UPSTREAM', 'Turnaround frames are incomplete.', true)
    await cache.put(j.fingerprint, { lookKey: j.lookKey, avatarCacheKey: key, provider: 'live', providerVersion: j.providerVersion, previewMode: 'turnaround' })
  }

  const guard = (j, p) => p.catch(e => fail(j, e.code && typeof e.code === 'string' ? e.code : 'AI_UNAVAILABLE', `Preview generation failed: ${e.message}`, !/MEDIA|UNSUPPORTED|TOO_LARGE/.test(e.code || '')))

  return {
    /** request must already be validated. opts.simulate is honoured by the mock provider only. */
    async submit(request, opts = {}) {
      const ident = `${request.requestId}#${request.inputRevision}`
      if (byIdentity.has(ident)) return publicJob(jobs.get(byIdentity.get(ident)))
      const now = new Date().toISOString()
      const j = { jobId: `job_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`, requestId: request.requestId, inputRevision: request.inputRevision, request,
        lookKey: previewLookKey(request), status: 'queued', createdAt: now, updatedAt: now }
      jobs.set(j.jobId, j); byIdentity.set(ident, j.jobId)

      const approved = findApprovedAsset(request)
      if (approved) {
        Object.assign(j, { provider: 'approved-asset', providerVersion: `approved:${approved.avatarCacheKey}`, fingerprint: previewFingerprint(request, `approved:${approved.avatarCacheKey}`) })
        const e = await readEntry(approved.avatarCacheKey)
        const note = `Previously generated on ${e?.source?.createdAt?.slice(0, 10) ?? 'an earlier date'} from the bundled demo photo with exactly these garments, and approved. Not regenerated now.`
        Object.assign(j, { provenance: 'approved-asset', provenanceNote: note })
        if (await finishFromCacheEntry(j, approved.avatarCacheKey, 'approved-asset', note)) return publicJob(j)
      }

      const ls = live()
      if (ls.enabled && request.authorization?.sendToGemini === true) {
        const pv = liveProviderVersion()
        Object.assign(j, { provider: 'live', providerVersion: pv, fingerprint: previewFingerprint(request, pv) })
        const hit = await cache.get(j.fingerprint)
        if (hit && await finishFromCacheEntry(j, hit.avatarCacheKey, 'cache', `Cached preview generated ${hit.cachedAt?.slice(0, 10)} for these exact inputs.`)) {
          Object.assign(j, { provenance: 'cache', provenanceNote: `Cached preview generated ${hit.cachedAt?.slice(0, 10)} for these exact inputs.` })
          return publicJob(j)
        }
        Object.assign(j, { provenance: 'generated-live', provenanceNote: 'Generated for this request.' })
        guard(j, runLive(j))
        return publicJob(j)
      }

      Object.assign(j, { provider: 'mock', providerVersion: 'mock-fixture.v1', fingerprint: previewFingerprint(request, 'mock-fixture.v1'), provenance: 'fixture',
        provenanceNote: ls.enabled ? 'Live generation was not authorised for this request, so a FIXTURE was returned.' : `Live generation unavailable (${ls.reasons.join('; ')}), so a FIXTURE was returned.` })
      guard(j, runMock(j, opts))
      return publicJob(j)
    },
    get(jobId) { const j = jobs.get(jobId); return j ? publicJob(j) : null },
    manifest(jobId) { return jobs.get(jobId)?.manifest ?? null },
    approve(jobId) {
      const j = jobs.get(jobId)
      if (!j) return { error: { status: 404, code: 'NOT_FOUND', message: 'No such job' } }
      if (j.status !== 'awaiting-approval') return { error: { status: 409, code: 'INVALID_STATE', message: `Job is ${j.status}, not awaiting approval` } }
      guard(j, continueLive(j))
      return { job: publicJob(j) }
    },
  }
}
