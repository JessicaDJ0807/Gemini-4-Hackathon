// HTTP surface Roamfit EXPOSES for the team app. All paths are new and versioned; existing routes are untouched.
//   GET  /api/v1/tryon/capabilities
//   POST /api/v1/tryon-previews                 → TryOnPreviewJobV1 (202 while running, 200 when already ready)
//   GET  /api/v1/tryon-previews/:jobId          → TryOnPreviewJobV1
//   POST /api/v1/tryon-previews/:jobId/approve  → continue a live turnaround after the user approves the still
//   GET  /api/v1/tryon-previews/:jobId/manifest → TurnaroundManifestV1
//   GET  /api/v1/commerce/products?q=&gapId=    → Shopify Storefront search (raw nodes) or 503 SHOPIFY_NOT_CONFIGURED
//   POST /api/v1/team/outfit-plans              → explicit, server-side proxy to the team AI service (503 if not configured)
// Error body mirrors the team contract: { requestId, inputRevision, error: { code, message, retryable, details? } }.
import express from 'express'
import { CONTRACT_VERSION, PREVIEW_JOB_STATES, validatePreviewRequest } from '../../shared/tryon/contract.js'
import { searchProducts } from '../shopify.js'
import { allowedHosts, checkGarmentReferences, checkPerson } from './media.js'
import { createPreviewService, liveStatus } from './service.js'

const errorBody = (body, code, message, retryable, details) => ({
  requestId: typeof body?.requestId === 'string' ? body.requestId : null,
  inputRevision: Number.isSafeInteger(body?.inputRevision) ? body.inputRevision : null,
  error: { code, message, retryable, ...(details ? { details } : {}) },
})
const STATUS = { SECRET_IN_REQUEST: 400, MEDIA_FORBIDDEN: 403, MEDIA_UNREADABLE: 400, UNSUPPORTED_VERSION: 400 }

/** @returns {import('express').Router} */
export function previewRouter({ service = createPreviewService(), live = liveStatus } = {}) {
  const r = express.Router()
  const json = express.json({ limit: '256kb' })

  r.get('/api/v1/tryon/capabilities', (_, res) => {
    const ls = live()
    res.json({ contractVersion: CONTRACT_VERSION, jobStates: PREVIEW_JOB_STATES,
      providers: { approvedAsset: true, mock: true, live: ls },
      video: { enabled: false, note: 'Turntable video (paid) is not exposed through this API; use the studio with explicit authorisation.' },
      mediaAllowedHosts: allowedHosts(), shopifyConfigured: Boolean(process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_STOREFRONT_TOKEN),
      teamAiConfigured: Boolean(process.env.TEAM_AI_BASE_URL) })
  })

  r.post('/api/v1/tryon-previews', json, async (req, res) => {
    const body = req.body
    const v = validatePreviewRequest(body)
    if (!v.ok) {
      const first = v.errors[0]
      return res.status(STATUS[first.code] ?? 400).json(errorBody(body, first.code, first.message, false, v.errors))
    }
    const problems = [...(await checkPerson(body.avatar)), ...(await checkGarmentReferences(body.garments))]
    if (problems.length) return res.status(STATUS[problems[0].code] ?? 400).json(errorBody(body, problems[0].code, problems[0].message, false, problems))
    try {
      const job = await service.submit(body, { simulate: req.get('x-roamfit-simulate') })
      res.status(job.status === 'ready' ? 200 : 202).json(job)
    } catch (e) { res.status(503).json(errorBody(body, 'AI_UNAVAILABLE', e.message, true)) }
  })

  r.get('/api/v1/tryon-previews/:jobId', (req, res) => {
    const j = service.get(req.params.jobId)
    j ? res.json(j) : res.status(404).json(errorBody(null, 'NOT_FOUND', 'No such preview job', false))
  })
  r.post('/api/v1/tryon-previews/:jobId/approve', (req, res) => {
    const out = service.approve(req.params.jobId)
    out.error ? res.status(out.error.status).json(errorBody(null, out.error.code, out.error.message, false)) : res.status(202).json(out.job)
  })
  r.get('/api/v1/tryon-previews/:jobId/manifest', (req, res) => {
    const m = service.manifest(req.params.jobId)
    m ? res.json(m) : res.status(404).json(errorBody(null, 'NOT_FOUND', 'No manifest for this job (not ready yet?)', false))
  })

  r.get('/api/v1/commerce/products', async (req, res) => {
    const q = String(req.query.q || '').trim()
    if (q.length < 2) return res.status(400).json(errorBody(null, 'INVALID_REQUEST', 'q (search query) is required', false))
    try {
      const out = await searchProducts(q)
      if (out.mode === 'unconfigured') return res.status(503).json(errorBody(null, 'SHOPIFY_NOT_CONFIGURED', 'Shopify Storefront credentials are not configured on this server. No products are shown rather than demo listings.', false))
      res.json({ ...out, query: q, gapId: req.query.gapId || null, fetchedAt: new Date().toISOString() })
    } catch (e) { res.status(502).json(errorBody(null, 'SHOPIFY_UNAVAILABLE', e.message, true)) }
  })

  // Explicit user action only (costs a Gemini call on the team service). Token stays server-side.
  r.post('/api/v1/team/outfit-plans', json, async (req, res) => {
    const base = process.env.TEAM_AI_BASE_URL
    if (!base) return res.status(503).json(errorBody(req.body, 'TEAM_AI_NOT_CONFIGURED', 'Set TEAM_AI_BASE_URL (and AI_SERVICE_TOKEN if the team service requires it).', false))
    try {
      const r2 = await fetch(new URL('/v1/outfit-plans', base), { method: 'POST', headers: { 'content-type': 'application/json', ...(process.env.AI_SERVICE_TOKEN ? { authorization: `Bearer ${process.env.AI_SERVICE_TOKEN}` } : {}) },
        body: JSON.stringify(req.body), signal: AbortSignal.timeout(90_000) })
      const b = await r2.json().catch(() => null)
      res.status(r2.status).json(b ?? errorBody(req.body, 'INVALID_UPSTREAM', 'Team AI service returned a non-JSON body', true))
    } catch (e) { res.status(504).json(errorBody(req.body, 'UPSTREAM_TIMEOUT', e.message, true)) }
  })
  return r
}
