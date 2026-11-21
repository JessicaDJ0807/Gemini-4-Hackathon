// C. Preview result adapter + client-side preview cache.
// Results are stored by lookKey (avatar + garments + params, NOT background). The viewer always shows the entry for the
// CURRENT lookKey, so a late response for an older selection can never overwrite what the user is looking at.
import { TERMINAL_JOB_STATES, type TryOnPreviewJobV1, type TurnaroundManifestV1 } from '../../shared/tryon/contract.js'
import type { TurnaroundAsset } from '../studio2/TurnaroundViewer'

export type ActiveRequest = { requestId: string; inputRevision: number; lookKey: string }
export type PreviewEntry = { job: TryOnPreviewJobV1; manifest?: TurnaroundManifestV1 }
export type PreviewStoreState = {
  byLookKey: Record<string, PreviewEntry>
  active: ActiveRequest | null
  /** Responses ignored because a newer request superseded them (kept for diagnostics). */
  ignored: { requestId: string; inputRevision: number; reason: string }[]
}

export const emptyStore = (): PreviewStoreState => ({ byLookKey: {}, active: null, ignored: [] })

export const isTerminal = (j: TryOnPreviewJobV1) => TERMINAL_JOB_STATES.includes(j.status)

export function startRequest(s: PreviewStoreState, active: ActiveRequest): PreviewStoreState {
  return { ...s, active }
}

/**
 * Accept a job update. Rules:
 *  • An update whose requestId/inputRevision doesn't match the active request is NOT allowed to become the active job.
 *  • A READY result is still stored under its own lookKey (it is a valid preview for that older selection), so going back
 *    to that outfit is instant. Failures/progress for stale requests are dropped.
 */
export function acceptJobUpdate(s: PreviewStoreState, job: TryOnPreviewJobV1, lookKey: string, manifest?: TurnaroundManifestV1): PreviewStoreState {
  const current = !!s.active && s.active.requestId === job.requestId && s.active.inputRevision === job.inputRevision
  if (current) {
    return { ...s, byLookKey: { ...s.byLookKey, [lookKey]: { job, manifest: manifest ?? s.byLookKey[lookKey]?.manifest } }, active: isTerminal(job) ? null : s.active }
  }
  const ignored = [...s.ignored, { requestId: job.requestId, inputRevision: job.inputRevision, reason: 'superseded by a newer selection' }].slice(-20)
  if (job.status === 'ready' && lookKey !== s.active?.lookKey) return { ...s, byLookKey: { ...s.byLookKey, [lookKey]: { job, manifest } }, ignored }
  return { ...s, ignored }
}

/** Manifest → the existing TurnaroundViewer asset type. Sparse view sets expose only their verified viewpoints. */
export function manifestToAsset(m: TurnaroundManifestV1, avatarMode: 'stylized' | 'realistic', lookKey: string): TurnaroundAsset {
  return {
    id: `${m.fingerprint}:${m.method}:${m.generatedAt ?? ''}`,
    avatarMode, outfitId: lookKey,
    frames: m.frames, frameCount: m.frameCount,
    coverageDegrees: m.coverageDegrees, verifiedFullRotation: m.verifiedFullRotation,
    method: m.method, views: m.views,
  }
}
