// Routes for the simplified full-scene try-on. Jobs live in memory; results live in spike-results/scene-cache.
import express from 'express'
import path from 'node:path'
import crypto from 'node:crypto'
import { hasGeminiKey } from '../tryon/geminiClient.js'
import { SCENE_DIR, BACKGROUNDS, GARMENTS, LOOKS, VIDEO_MODEL, VIDEO_SECONDS, VIDEO_COST_ESTIMATE_USD, resolveGarments, sceneKey, readScene, listScenes, generateScene, generateSceneVideo } from './service.js'

const jobs = new Map()
function startJob(kind, key, fn) {
  const job = { id: crypto.randomUUID().slice(0, 8), kind, key, status: 'running', step: 'starting', startedAt: Date.now() }
  jobs.set(job.id, job)
  fn(s => { job.step = s }).then(() => { job.status = 'done' }, e => { job.status = 'failed'; job.error = { message: e.message } }).finally(() => { job.finishedAt = Date.now() })
  return job
}
const fileUrl = (key, f) => `/api/scene/file/${encodeURIComponent(key)}/${f}`
const view = m => ({ ...m,
  still: m.still && { ...m.still, url: fileUrl(m.key, m.still.file) },
  video: m.video && { ...m.video, url: fileUrl(m.key, m.video.file), frames: Array.from({ length: m.video.frameCount }, (_, i) => fileUrl(m.key, `${m.video.framesDir}/${String(i + 1).padStart(3, '0')}.jpg`)) } })

/** @returns {import("express").Router} */
export function sceneRouter() {
  const r = express.Router()
  r.get('/api/scene/config', (_, res) => res.json({
    gemini: hasGeminiKey(),
    backgrounds: Object.entries(BACKGROUNDS).map(([id, b]) => ({ id, name: b.name, title: b.title, url: `/${b.file}`, credit: b.credit })),
    garments: Object.entries(GARMENTS).map(([id, g]) => ({ id, name: g.name, category: g.category, thumb: g.thumb })),
    looks: LOOKS, video: { model: VIDEO_MODEL, seconds: VIDEO_SECONDS, costEstimateUsd: VIDEO_COST_ESTIMATE_USD },
  }))
  r.get('/api/scene/results', async (_, res) => res.json((await listScenes()).map(view)))
  r.get('/api/scene/file/:key/*rest', (req, res) => {
    const key = req.params.key.replace(/[^a-zA-Z0-9_.+-]/g, '')
    const rel = [].concat(req.params.rest).join('/')
    if (!/^(still\.(png|jpg)|video-[a-z0-9]+\.mp4|frames-[a-z0-9]+\/\d{3}\.jpg)$/.test(rel)) return res.status(404).end()
    res.sendFile(path.join(SCENE_DIR, key, rel), { maxAge: '1h' }, e => e && !res.headersSent && res.status(404).end())
  })
  const parse = b => {
    const mode = b.mode
    if (!['little-self', 'real-me'].includes(mode)) return { error: 'Unknown mode' }
    const rg = resolveGarments(b.garments ?? b.garmentIds); if (rg.error) return { error: rg.error }
    const garments = rg.garments
    if (!BACKGROUNDS[b.backgroundId]) return { error: 'Pick a destination' }
    const input = mode === 'little-self' && b.input === 'text' ? 'text' : 'photo'
    const description = typeof b.description === 'string' ? b.description.slice(0, 500) : ''
    if (input === 'text' && description.trim().length < 3) return { error: 'Describe yourself (hair, glasses, style) to create a Little Self without a photo' }
    const personId = typeof b.personId === 'string' && /^person-[a-f0-9]{12}\.(png|jpg|webp)$/.test(b.personId) ? b.personId : null
    return { mode, input, description, personId, garments, backgroundId: b.backgroundId, key: sceneKey({ mode, input, description, personId, garments, backgroundId: b.backgroundId }).key }
  }
  // Side-effect free: which cached result (if any) matches this selection.
  r.post('/api/scene/lookup', express.json(), async (req, res) => {
    const p = parse(req.body || {}); if (p.error) return res.json({ key: null })
    const m = await readScene(p.key); res.json({ key: p.key, result: m?.still ? view(m) : null })
  })
  r.post('/api/scene/tryon', express.json(), async (req, res) => {
    const b = req.body || {}
    const p = parse(b); if (p.error) return res.status(400).json({ error: p.error })
    const { mode, input, description, personId, garments, key } = p
    const cached = await readScene(key)
    if (cached?.still && b.regenerate !== true) return res.json({ cached: true, key }) // reuse, no new calls
    if (!hasGeminiKey()) return res.status(503).json({ error: 'GEMINI_API_KEY not configured' })
    if (b.consent !== true) return res.status(400).json({ error: 'Consent to send your inputs to Google Gemini API is required' })
    res.json(startJob('still', key, onStep => generateScene({ mode, input, description, personId, garments, backgroundId: b.backgroundId, onStep })))
  })
  r.post('/api/scene/video', express.json(), async (req, res) => {
    const key = String(req.body?.key || '').replace(/[^a-zA-Z0-9_.+-]/g, '')
    if (!(await readScene(key))?.still) return res.status(400).json({ error: 'Generate the try-on photo first' })
    if (req.body?.authorizeCost !== true) return res.status(402).json({ error: `The rotating preview is a paid video call (about US$${VIDEO_COST_ESTIMATE_USD}) and needs your explicit OK` })
    if (!hasGeminiKey()) return res.status(503).json({ error: 'GEMINI_API_KEY not configured' })
    if ([...jobs.values()].some(j => j.key === key && j.kind === 'video' && j.status === 'running')) return res.status(409).json({ error: 'A video for this look is already being generated' })
    res.json(startJob('video', key, onStep => generateSceneVideo(key, { authorized: true, onStep })))
  })
  r.get('/api/scene/jobs/:id', (req, res) => { const j = jobs.get(req.params.id); j ? res.json(j) : res.status(404).json({ error: 'no such job' }) })
  return r
}
