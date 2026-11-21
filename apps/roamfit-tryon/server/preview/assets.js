// Turnaround manifests built from the on-disk avatar cache, plus the registry of APPROVED previously generated assets.
// An approved asset is served only when the request's generation identity matches the inputs it was really made from.
import fs from 'node:fs/promises'
import path from 'node:path'
import { CACHE_DIR, readEntry } from '../avatar3d/cache.js'
import { previewLookKey } from '../../shared/tryon/contract.js'
import { DEMO_PERSON_ID } from './media.js'

const LIMITS = [
  'Image-based turnaround: the character is chosen from pre-generated views, not a 3D model.',
  'AI-generated illustration. Not a physically accurate fit, size or fabric simulation.',
]
const STROLL = ['rf-tee-ivory', 'rf-trousers-gingham']

/** Inputs each cached asset was actually generated from (see spike-results/avatar-cache/<key>/meta.json). */
export const APPROVED_ASSETS = [
  { avatarCacheKey: 'demo__little-self__stroll', avatar: { mode: 'stylized', creationMethod: 'photo', personMediaId: DEMO_PERSON_ID, description: 'short black hair, small gold hoop earrings' }, garmentIds: STROLL },
  { avatarCacheKey: 'demo__real-me__stroll', avatar: { mode: 'realistic', creationMethod: 'photo', personMediaId: DEMO_PERSON_ID }, garmentIds: STROLL },
]

const syntheticRequest = (a, previewMode) => ({ avatar: a.avatar, selectedLook: { garmentIds: a.garmentIds }, garments: a.garmentIds.map(id => ({ id })), previewMode })

export function findApprovedAsset(req) {
  const key = previewLookKey(req)
  return APPROVED_ASSETS.find(a => previewLookKey(syntheticRequest(a, req.previewMode)) === key) ?? null
}

const url = (key, ...p) => `/generated/${encodeURIComponent(key)}/${p.map(encodeURIComponent).join('/')}`

/** Build a TurnaroundManifestV1 from an avatar-cache entry. Only verified viewpoints are exposed. */
export async function manifestFromCacheEntry(key, { previewMode, fingerprint, provenance, provenanceNote }) {
  const e = await readEntry(key)
  if (!e?.source) return null
  const still = url(key, e.source.file)
  const base = { manifestVersion: 'turnaround.v1', fingerprint, neutralBackground: true, previewImageUrl: still, provenance, provenanceNote, limitations: LIMITS }
  if (previewMode === 'photo') return { ...base, method: 'still', frames: [still], frameCount: 1, coverageDegrees: 0, verifiedFullRotation: false, generatedAt: e.source.createdAt }
  const v = e.turnaround?.video
  if (v?.verified) {
    const frames = Array.from({ length: v.frameCount }, (_, i) => url(key, v.dir, `${String(i).padStart(3, '0')}.webp`))
    return { ...base, method: 'video', frames, frameCount: v.frameCount, coverageDegrees: 360, verifiedFullRotation: true, generatedAt: v.createdAt }
  }
  const t = e.turnaround?.views
  if (!t) return null
  for (let i = 0; i < t.frameCount; i++) { try { await fs.access(path.join(CACHE_DIR, key, t.dir, `${String(i).padStart(3, '0')}.webp`)) } catch { return null } }
  const frames = Array.from({ length: t.frameCount }, (_, i) => url(key, t.dir, `${String(i).padStart(3, '0')}.webp`))
  return { ...base, method: 'views', frames, frameCount: t.frameCount, views: t.views, coverageDegrees: null, verifiedFullRotation: false, generatedAt: t.createdAt,
    limitations: [...LIMITS, `${t.views.filter(x => x.origin === 'generated').length} generated views; ${t.views.filter(x => x.origin !== 'generated').map(x => `${x.label} is ${x.origin}`).join('; ') || 'no mirrored views'}. Not continuous 360°.`] }
}

/** Fixture manifest for mock jobs: a stored sample, explicitly NOT the user's selected outfit. */
export async function fixtureManifest(req, fingerprint) {
  const key = req.avatar.mode === 'realistic' ? 'demo__real-me__stroll' : 'demo__little-self__stroll'
  return manifestFromCacheEntry(key, { previewMode: req.previewMode, fingerprint, provenance: 'fixture',
    provenanceNote: 'FIXTURE: a stored sample of the demo person in the Roamfit tee and gingham trousers. Your selected garments and avatar were NOT rendered. Used to test the pipeline without paid calls.' })
}
