// Turnaround assets (image-based, NOT 3D): either validated multi-view sets or a validated AI turntable video.
// Both read an APPROVED 2D source from the avatar cache and write frames + manifest under <cache>/<key>/.
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { CACHE_DIR, readEntry, writeEntry } from '../avatar3d/cache.js'
import { makeBackView, makeSideView } from '../avatar3d/backView.js'
import { interact, outputVideo, outputText, parseJsonLoose } from '../tryon/geminiClient.js'
import { modelConfig } from '../tryon/models.js'

export const VIDEO_MODEL = process.env.VIDEO_MODEL || 'gemini-omni-1.2-flash'
export const VIDEO_SECONDS = 8
// Published price used for the up-front estimate (aistudio.google.com/docs/pricing, read 2026-11-21): ~$0.07/s at 720p.
export const VIDEO_COST_ESTIMATE_USD = Math.round(VIDEO_SECONDS * 0.07 * 100) / 100

const py = (args, timeout = 15 * 60_000) => new Promise((ok, fail) => execFile('python3', args, { env: { ...process.env, HF_HUB_DISABLE_IMPLICIT_TOKEN: '1' }, maxBuffer: 1 << 24, timeout },
  (err, stdout, stderr) => err ? fail(new Error(String(stderr).split('\n').filter(l => /Error|error/.test(l)).slice(-2).join(' ') || err.message)) : ok(JSON.parse(String(stdout).trim().split('\n').filter(l => l.startsWith('{')).pop()))))

async function requireApproved(key) {
  const e = await readEntry(key)
  if (!e?.source) throw Object.assign(new Error('Generate a 2D character first'), { status: 400 })
  if (!e.source.approved) throw Object.assign(new Error('Approve the 2D character before building a turnaround'), { status: 400 })
  return e
}

/** Multi-view set: front (approved source) + AI side + AI back + mirrored side. Gemini image calls only if views are missing. */
export async function buildViewsTurnaround(key, onStep = () => {}) {
  let e = await requireApproved(key)
  if (!e.back) { onStep('Gemini: back view'); await makeBackView(key) }
  e = await readEntry(key)
  if (!e.side) { onStep('Gemini: side view'); await makeSideView(key) }
  e = await readEntry(key)
  onStep('local: cut-out + alignment')
  const dir = path.join(CACHE_DIR, key)
  const m = await py(['scripts/turnaround_frames.py', 'views', path.join(dir, 'turnaround-views'), `front=${path.join(dir, e.source.file)}`, `side=${path.join(dir, e.side.file)}`, `facing=${e.side.facing || 'left'}`, `back=${path.join(dir, e.back.file)}`])
  const fresh = await readEntry(key)
  await writeEntry(key, { ...fresh, turnaround: { ...fresh.turnaround, views: { dir: 'turnaround-views', frameCount: m.frameCount, views: m.views, createdAt: new Date().toISOString(),
    qa: { back: fresh.back?.qa?.verdict, side: fresh.side?.qa?.verdict } } } })
  return m
}

/** AI turntable video → local validation → Model B frame QA. Paid: refuses unless `authorized === true`. Never retries. */
export async function generateTurnaroundVideo(key, { authorized, onStep = () => {} }) {
  if (authorized !== true) throw Object.assign(new Error(`Video generation is a paid call (~$${VIDEO_COST_ESTIMATE_USD}); explicit authorisation required`), { status: 402 })
  const e = await requireApproved(key)
  const dir = path.join(CACHE_DIR, key)
  const buf = await fs.readFile(path.join(dir, e.source.file))
  const still = { type: 'image', mime: buf[0] === 0xff ? 'image/jpeg' : 'image/png', data: buf.toString('base64') }
  const subject = e.mode === 'real-me' ? 'the real person in this photo (keep her face, hair and body exactly; photorealistic)' : 'this soft-clay collectible character (keep the clay style exactly)'
  const PROMPT = `Character turntable for a product viewer. Show ${subject} standing on a plain seamless MEDIUM GREY studio backdrop (about #8e8e8e, uniform, no floor line).
She keeps a fixed neutral standing pose and rotates smoothly in place around her vertical axis at a constant speed, making EXACTLY ONE complete 360-degree revolution over the whole clip, ending facing the camera exactly as she started.
The camera is locked: no zoom, no pan. Head and feet stay fully visible and the figure stays centred at the same scale. No walking, no gestures, no pose or outfit changes, no added props, consistent soft lighting. Silent.`
  onStep(`Gemini Omni: generating ${VIDEO_SECONDS}s turntable`)
  const cfg = modelConfig()
  const r = await interact({ model: VIDEO_MODEL, timeoutMs: 600_000, parts: [still, { type: 'text', text: PROMPT }],
    extra: { generation_config: { video_config: { task: 'image_to_video' } } }, responseFormat: { type: 'video', aspect_ratio: '9:16', resolution: '720p', duration: `${VIDEO_SECONDS}s` } })
  const v = outputVideo(r.json)
  if (!v?.data) throw new Error(`video model returned no inline video${outputText(r.json) ? ': ' + outputText(r.json).slice(0, 200) : ''}`)
  await fs.writeFile(path.join(dir, 'turntable.mp4'), Buffer.from(v.data, 'base64'))
  onStep('local: validation + frame extraction')
  const m = await py(['scripts/turnaround_frames.py', 'video', path.join(dir, 'turntable.mp4'), path.join(dir, 'turnaround-video'), '36'])
  onStep('Gemini 4: frame QA')
  const sample = [0, 4, 9, 13, 18, 22, 27, 31]
  const frames = await Promise.all(sample.map(async i => ({ type: 'image', mime: 'image/webp', data: (await fs.readFile(path.join(dir, 'turnaround-video', `${String(i).padStart(3, '0')}.webp`))).toString('base64') })))
  const q = await interact({ model: cfg.qa, parts: [{ type: 'text', text: `IMAGE 1 = approved character. IMAGES 2-9 = frames sampled in time order from a turntable video (cut out). Judge by pixels:
does the figure rotate through one FULL revolution (front → side → back → other side → front)? Are identity and outfit consistent across frames? Any pose change, morphing, extra objects?
Return ONLY JSON {"verdict":"pass|review|fail","rotation":"full|partial|none|irregular","identity":{"verdict":"","issues":[]},"outfit":{"verdict":"","issues":[]},"artifacts":[]}` }, still, ...frames] })
  const qa = parseJsonLoose(outputText(q.json))
  const verified = Boolean(m.automatedRotationPass && qa.rotation === 'full' && qa.verdict !== 'fail')
  const fresh = await readEntry(key)
  await writeEntry(key, { ...fresh, turnaround: { ...fresh.turnaround, video: { dir: 'turnaround-video', frameCount: m.frameCount, checks: m.checks, qa, verified,
    status: verified ? 'accepted' : 'rejected', model: VIDEO_MODEL, costEstimateUsd: VIDEO_COST_ESTIMATE_USD, latencyMs: r.latencyMs, createdAt: new Date().toISOString() } },
    trace: [...fresh.trace, { role: 'Turntable video (paid, user-authorised)', model: VIDEO_MODEL, generation: 'Gemini Omni (not Gemini 4)', latencyMs: r.latencyMs },
      { role: 'Model B · Gemini 4 turntable frame QA', model: cfg.qa, generation: 'Gemini 4', latencyMs: q.latencyMs }] })
  return { verified, checks: m.checks, qa }
}

/** Re-run local validation + frame extraction + Model B QA on an ALREADY generated turntable.mp4. No video-model call, no new video charge. */
export async function revalidateTurnaroundVideo(key, onStep = () => {}) {
  const e = await requireApproved(key)
  const dir = path.join(CACHE_DIR, key)
  await fs.access(path.join(dir, 'turntable.mp4'))
  onStep('local: validation + frame extraction (existing video)')
  const m = await py(['scripts/turnaround_frames.py', 'video', path.join(dir, 'turntable.mp4'), path.join(dir, 'turnaround-video'), '36'])
  onStep('Gemini 4: frame QA')
  const cfg = modelConfig()
  const buf = await fs.readFile(path.join(dir, e.source.file))
  const still = { type: 'image', mime: buf[0] === 0xff ? 'image/jpeg' : 'image/png', data: buf.toString('base64') }
  const sample = [0, 4, 9, 13, 18, 22, 27, 31]
  const frames = await Promise.all(sample.map(async i => ({ type: 'image', mime: 'image/webp', data: (await fs.readFile(path.join(dir, 'turnaround-video', `${String(i).padStart(3, '0')}.webp`))).toString('base64') })))
  const q = await interact({ model: cfg.qa, parts: [{ type: 'text', text: `IMAGE 1 = approved character. IMAGES 2-9 = frames sampled in time order from a turntable video, cut out from the background. Judge by pixels:
does the figure rotate through one FULL revolution (front → side → back → other side → front)? Are identity and outfit consistent across frames? Any pose change, morphing, extra objects, or cut-out damage (missing parts)?
Return ONLY JSON {"verdict":"pass|review|fail","rotation":"full|partial|none|irregular","identity":{"verdict":"","issues":[]},"outfit":{"verdict":"","issues":[]},"artifacts":[]}` }, still, ...frames] })
  const qa = parseJsonLoose(outputText(q.json))
  const verified = Boolean(m.automatedRotationPass && qa.rotation === 'full' && qa.verdict !== 'fail')
  const fresh = await readEntry(key)
  const prev = fresh.turnaround?.video || {}
  await writeEntry(key, { ...fresh, turnaround: { ...fresh.turnaround, video: { ...prev, dir: 'turnaround-video', frameCount: m.frameCount, checks: m.checks, qa, verified, status: verified ? 'accepted' : 'rejected', revalidatedAt: new Date().toISOString(), createdAt: new Date().toISOString() } },
    trace: [...fresh.trace, { role: 'Model B · Gemini 4 turntable frame QA (revalidation, no new video)', model: cfg.qa, generation: 'Gemini 4', latencyMs: q.latencyMs }] })
  return { verified, checks: m.checks, qa }
}
