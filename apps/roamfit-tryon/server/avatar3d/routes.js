// Express routes for the two-mode studio. Jobs run in-process; state is in memory + the on-disk cache.
import express from 'express'
import path from 'node:path'
import crypto from 'node:crypto'
import { CACHE_DIR, listEntries, readEntry, writeEntry, keyOf, fileUrl } from './cache.js'
import { generateSource, OUTFITS, resolveOutfit, UPLOADS } from './sources.js'
import { buildViewsTurnaround, generateTurnaroundVideo, VIDEO_MODEL, VIDEO_SECONDS, VIDEO_COST_ESTIMATE_USD } from '../turnaround/service.js'
import { intake } from '../tryon/assetIntake.js'
import { imageTo3D, PROVIDERS, hasFalKey } from './providers.js'
import { hasGeminiKey } from '../tryon/geminiClient.js'
import fs from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { makeBackView } from './backView.js'
import { assetPath } from '../assetPaths.js'

const jobs = new Map() // id → { id, kind, key, status, step, error, startedAt, finishedAt }
const DEFAULT_PROVIDER = { 'little-self': 'tripo-h3.1', 'real-me': 'hunyuan-3.1-pro' }

const view = e => ({
  key: e.key, mode: e.mode, outfitId: e.outfitId, outfitName: e.outfitName,
  source: e.source && { url: fileUrl(e.key, e.source.file), qa: e.source.qa, createdAt: e.source.createdAt, live: e.source.live, note: e.source.note, input: e.source.input ?? 'photo', description: e.source.description, notes: e.source.analysis?.uncertain ?? [], defaults: e.source.analysis?.defaults_used ?? [] },
  approved: !!e.source?.approved,
  turnaround: Object.fromEntries(Object.entries(e.turnaround || {}).map(([k, t]) => [k, { ...t, base: `/generated/${encodeURIComponent(e.key)}/${t.dir}/` }])),
  models: Object.fromEntries(Object.entries(e.models || {}).map(([pid, m]) => [pid, { ...m, url: fileUrl(e.key, m.file) }])),
  trace: e.trace,
})

function startJob(kind, key, run) {
  const id = crypto.randomUUID().slice(0, 8)
  const job = { id, kind, key, status: 'running', step: 'queued', startedAt: Date.now() }
  jobs.set(id, job)
  run(step => { job.step = step }).then(() => { job.status = 'done' }, e => { job.status = 'failed'; job.error = { message: e.message, code: e.code } }).finally(() => { job.finishedAt = Date.now() })
  return job
}

/** @returns {import("express").Router} */
export function studioRouter() {
  const r = express.Router()
  r.use('/generated', express.static(CACHE_DIR, { fallthrough: false, maxAge: 0 }))
  // Whitelisted reference media only (garment crops + style reference). The person photo is never served here.
  const MEDIA = { 'garment_white_squareneck_tee.png': 'derived', 'garment_gingham_flare_trousers.png': 'derived', 'garment_black_cropped_cardigan.png': 'derived', 'style_cozy_clay_traveler.png': 'reference' }
  r.get('/media/:file', (req, res) => { const d = MEDIA[req.params.file]; d ? res.sendFile(assetPath(`${d}/${req.params.file}`)) : res.status(404).end() })
  r.get('/api/studio/capabilities', (_, res) => res.json({
    gemini: hasGeminiKey(), fal: hasFalKey(), outfits: Object.entries(OUTFITS).map(([id, o]) => ({ id, name: o.name, label: o.label })),
    video: { model: VIDEO_MODEL, seconds: VIDEO_SECONDS, costEstimateUsd: VIDEO_COST_ESTIMATE_USD, note: 'Gemini Omni is not a Gemini 4 model. Paid per generated second.' }, threeDProvidersEnabled: process.env.ENABLE_3D_PROVIDERS === '1',
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, endpoint: p.endpoint, views: p.supports })), defaults: DEFAULT_PROVIDER,
  }))
  r.get('/api/studio/assets', async (_, res) => res.json((await listEntries()).map(view)))
  r.post('/api/studio/source', express.json(), (req, res) => {
    const { mode, outfitId } = req.body || {}
    if (!['little-self', 'real-me'].includes(mode) || !resolveOutfit(outfitId)) return res.status(400).json({ error: 'mode/outfitId invalid' })
    if (!hasGeminiKey()) return res.status(503).json({ error: 'GEMINI_API_KEY not configured' })
    if (req.body.consent !== true) return res.status(400).json({ error: 'Consent to send your inputs to Google Gemini API is required' })
    const input = req.body.input === 'text' && mode === 'little-self' ? 'text' : 'photo'
    const description = typeof req.body.description === 'string' ? req.body.description.slice(0, 500) : ''
    if (input === 'text' && description.trim().length < 3) return res.status(400).json({ error: 'Describe your appearance (hair, glasses, style) to create a Little Self without a photo' })
    const personFile = typeof req.body.personId === 'string' && /^person-[a-f0-9]{12}\.(png|jpg|webp)$/.test(req.body.personId) ? req.body.personId : null
    const profile = input === 'text' ? 'described' : personFile ? personFile.replace(/\..*$/, '') : 'demo'
    const key = keyOf({ profile, mode, outfitId })
    res.json(startJob('source', key, onStep => generateSource({ mode, outfitId, profile, input, description, personFile, onStep })))
  })
  r.post('/api/studio/model3d', express.json(), async (req, res) => {
    const { mode, outfitId } = req.body || {}
    const providerId = req.body?.provider || DEFAULT_PROVIDER[mode]
    const key = keyOf({ profile: req.body?.input === 'text' && mode === 'little-self' ? 'described' : 'demo', mode, outfitId })
    const entry = await readEntry(key)
    if (!entry?.source) return res.status(400).json({ error: 'Generate (and approve) the 2D source first' })
    if (process.env.ENABLE_3D_PROVIDERS !== '1') return res.status(410).json({ error: '3D reconstruction is disabled in this version (set ENABLE_3D_PROVIDERS=1 to re-enable the experimental path)' })
    if (providerId === 'local-relief') {
      if (mode !== 'little-self') return res.status(400).json({ error: 'Free local 3D is available for Little Self only' })
      if (!hasGeminiKey()) return res.status(503).json({ error: 'GEMINI_API_KEY not configured (needed for the back view)' })
      if (req.body.consent !== true) return res.status(400).json({ error: 'Consent to send the character concept to Google Gemini API (back view) is required' })
      return res.json(startJob('model3d', key, async onStep => {
        const t0 = Date.now()
        if (!(await readEntry(key)).back) { onStep('Gemini: back view'); await makeBackView(key) }
        onStep('local: depth + reconstruction')
        const out = await new Promise((ok, fail) => execFile('python3', ['scripts/relief3d.py', path.join(CACHE_DIR, key)], { env: { ...process.env, HF_HUB_DISABLE_IMPLICIT_TOKEN: '1' }, maxBuffer: 1 << 24, timeout: 10 * 60_000 },
          (err, stdout, stderr) => err ? fail(new Error(`relief3d failed: ${String(stderr).split('\n').filter(l => /Error|error/.test(l)).slice(-2).join(' ') || err.message}`)) : ok(JSON.parse(String(stdout).trim().split('\n').filter(l => l.startsWith('{')).pop()))))
        const fresh = await readEntry(key)
        await writeEntry(key, { ...fresh, models: { ...fresh.models, 'local-relief': { file: 'model_local-relief.glb', provider: 'local', model: 'Depth Anything V2 Small + rembg IS-Net + silhouette inflation', label: 'Free local 3D (front + back relief)', latencyMs: Date.now() - t0, localSec: out.total_sec, createdAt: new Date().toISOString(), note: 'Sides are interpolated between the AI front and back views.' } },
          trace: [...fresh.trace, { role: '3D reconstruction (local, free)', model: 'Depth Anything V2 Small + rembg IS-Net', generation: 'not Gemini · runs on this machine', latencyMs: Math.round(out.total_sec * 1000) }] })
      }))
    }
    if (!hasFalKey()) return res.status(503).json({ error: 'FAL_KEY not configured — 3D generation unavailable', code: 'NO_KEY' })
    if (req.body.consent !== true) return res.status(400).json({ error: 'Consent to send the image to fal.ai is required' })
    res.json(startJob('model3d', key, async onStep => {
      const { glb, meta } = await imageTo3D({ providerId, imageFile: path.join(CACHE_DIR, key, entry.source.file), onStatus: s => onStep(`fal: ${s}`) })
      const file = `model_${providerId}.glb`
      await fs.writeFile(path.join(CACHE_DIR, key, file), glb)
      const fresh = await readEntry(key)
      await writeEntry(key, { ...fresh, models: { ...fresh.models, [providerId]: { file, ...meta, createdAt: new Date().toISOString(), note: 'Unseen sides are model-inferred.' } },
        trace: [...fresh.trace, { role: '3D reconstruction', model: meta.model, generation: 'not Gemini', latencyMs: meta.latencyMs, requestId: meta.requestId }] })
    }))
  })
  const keyFrom = b => String(b?.key || '').replace(/[^a-zA-Z0-9_.-]/g, '')
  r.post('/api/studio/approve', express.json(), async (req, res) => {
    const key = keyFrom(req.body); const e = await readEntry(key)
    if (!e?.source) return res.status(404).json({ error: 'nothing to approve' })
    await writeEntry(key, { ...e, source: { ...e.source, approved: req.body.approved !== false, approvedAt: new Date().toISOString() } }); res.json({ ok: true })
  })
  r.post('/api/studio/turnaround', express.json(), async (req, res) => {
    const key = keyFrom(req.body); const method = req.body?.method
    const e = await readEntry(key)
    if (!e?.source?.approved) return res.status(400).json({ error: 'Approve the 2D character first' })
    if (!hasGeminiKey()) return res.status(503).json({ error: 'GEMINI_API_KEY not configured' })
    if (method === 'video') {
      if (req.body.authorizeCost !== true) return res.status(402).json({ error: `Paid video generation (about US$${VIDEO_COST_ESTIMATE_USD}) needs explicit authorisation` })
      return res.json(startJob('turnaround-video', key, onStep => generateTurnaroundVideo(key, { authorized: true, onStep })))
    }
    if (req.body.consent !== true) return res.status(400).json({ error: 'Consent to send the approved character to Google Gemini API (extra views) is required' })
    res.json(startJob('turnaround-views', key, onStep => buildViewsTurnaround(key, onStep)))
  })
  r.post('/api/studio/upload', express.json({ limit: '16mb' }), async (req, res) => {
    const kind = req.body?.kind === 'garment' ? 'garment' : 'person'
    const mt = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(req.body?.dataUrl || '')
    if (!mt) return res.status(400).json({ error: 'Send a PNG, JPEG or WebP image' })
    const buf = Buffer.from(mt[2], 'base64'); const chk = intake(kind, buf, kind)
    if (!chk.ok) return res.status(400).json({ error: chk.errors.join('; ') })
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[chk.image.mime]
    const id = `${kind}-${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12)}.${ext}`
    await fs.mkdir(UPLOADS, { recursive: true }); await fs.writeFile(path.join(UPLOADS, id), buf)
    res.json({ id, kind, width: chk.image.width, height: chk.image.height, warnings: chk.warnings, outfitId: kind === 'garment' ? `upload-${id.slice(8)}` : undefined })
  })
  r.delete('/api/studio/upload/:id', async (req, res) => {
    const id = req.params.id.replace(/[^a-zA-Z0-9_.-]/g, ''); await fs.rm(path.join(UPLOADS, id), { force: true }); res.json({ ok: true })
  })
  r.get('/api/studio/jobs/:id', (req, res) => { const j = jobs.get(req.params.id); j ? res.json(j) : res.status(404).json({ error: 'no such job' }) })
  r.delete('/api/studio/assets/:key', async (req, res) => {
    const key = req.params.key.replace(/[^a-zA-Z0-9_.-]/g, '')
    await fs.rm(path.join(CACHE_DIR, key), { recursive: true, force: true }); res.json({ ok: true })
  })
  return r
}
