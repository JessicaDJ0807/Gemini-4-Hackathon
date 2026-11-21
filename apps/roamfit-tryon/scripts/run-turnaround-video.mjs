// "Approximate 360": animate an approved try-on still into an in-place turnaround clip, then let Model B QA sampled frames.
// Side/back views in the clip are model-inferred, not captured. Sends the still (and source refs for QA) to Google Gemini API.
//   node --env-file=.env scripts/run-turnaround-video.mjs --image=spike-results/runs/<id>/attemptN.jpg [--duration=10] [--aspect=9:16]
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { interact, outputVideo, outputText, parseJsonLoose } from '../server/tryon/geminiClient.js'
import { intake } from '../server/tryon/assetIntake.js'
import { modelConfig } from '../server/tryon/models.js'

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true] }))
if (!args.image) { console.error('--image=<path to try-on still> required'); process.exit(1) }
const VIDEO_MODEL = process.env.VIDEO_MODEL || 'gemini-omni-1.2-flash'
const duration = `${args.duration || 10}s`
const stillBuf = await fs.readFile(args.image)
const still = { mime: stillBuf[0] === 0xff ? 'image/jpeg' : 'image/png', data: stillBuf.toString('base64') }
const aspect = args.aspect || (() => { const s = intake('scene', stillBuf).image; return s.height > s.width ? '9:16' : '16:9' })()

const outDir = path.join('spike-results/video', new Date().toISOString().replace(/[:.]/g, '-'))
await fs.mkdir(path.join(outDir, 'frames'), { recursive: true })
const trace = []

const PROMPT = `Realistic live-action footage made from this exact photo. The camera is locked off on a tripod and never moves; the background stays completely still.
The woman stays standing on the same spot and slowly turns in place clockwise through one full 360-degree rotation at an even pace over the whole clip (front → her left side → back → her right side → front), ending facing the camera again in the starting pose.
Keep her face, hair, body proportions and every piece of clothing and footwear identical to the photo throughout — same colours, same pattern scale, same garment lengths. Natural, relaxed movement, arms by her sides. Ambient street sound only, no music, no speech, no text, no other people.`

console.log(`▶ ${VIDEO_MODEL} image→video ${duration} ${aspect} 720p …`)
let vid
try {
  const r = await interact({
    model: VIDEO_MODEL, timeoutMs: 600_000,
    parts: [{ type: 'image', mime: still.mime, data: still.data }, { type: 'text', text: PROMPT }],
    extra: { generation_config: { video_config: { task: 'image_to_video' } } },
    responseFormat: { type: 'video', aspect_ratio: aspect, resolution: '720p', duration },
  })
  vid = outputVideo(r.json)
  trace.push({ role: 'Video generator', provider: 'gemini', model: VIDEO_MODEL, servedModel: r.servedModel, latencyMs: r.latencyMs, requestId: r.requestId, usage: r.usage })
  if (!vid?.data) throw new Error(`no inline video returned${vid?.uri ? ' (uri delivery not handled)' : ''}${outputText(r.json) ? ': ' + outputText(r.json).slice(0, 300) : ''}`)
} catch (e) {
  trace.push({ role: 'Video generator FAILED', provider: 'gemini', model: VIDEO_MODEL, latencyMs: e.latencyMs, status: e.status, error: e.message })
  await fs.writeFile(path.join(outDir, 'trace.json'), JSON.stringify({ source: args.image, prompt: PROMPT, trace }, null, 2))
  console.error('✖', e.message); process.exit(1)
}
const mp4 = path.join(outDir, 'turnaround.mp4')
await fs.writeFile(mp4, Buffer.from(vid.data, 'base64'))
console.log(`  saved ${mp4} (${trace[0].latencyMs}ms)`)

// Sample 8 evenly spaced frames + a contact sheet for humans.
const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4]).toString().trim())
const frames = []
for (let i = 0; i < 8; i++) {
  const t = ((i + 0.5) * dur / 8).toFixed(2), f = path.join(outDir, 'frames', `f${i}_${t}s.jpg`)
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', t, '-i', mp4, '-frames:v', '1', '-q:v', '3', f]); frames.push({ t, f })
}
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', mp4, '-vf', `fps=8/${dur},scale=320:-1,tile=8x1`, '-frames:v', '1', path.join(outDir, 'contact_sheet.jpg')])

// Model B: independent frame-consistency QA against the original person + garment and the approved still.
const cfg = modelConfig()
const load = async p => { const b = await fs.readFile(p); return { type: 'image', mime: b[0] === 0xff ? 'image/jpeg' : (b.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : 'image/png'), data: b.toString('base64') } }
const qaParts = [
  { type: 'text', text: `You are an independent visual QA inspector for an in-place turnaround video generated from a single try-on still.
IMAGE 1 = original PERSON photo. IMAGE 2 = target GARMENT product photo. IMAGE 3 = approved try-on STILL used as the first frame.
IMAGES 4-11 = frames sampled in order at ${frames.map(f => f.t + 's').join(', ')}.
Side and back views were never photographed, so they are necessarily inferred; judge whether they are plausible and CONSISTENT, not "accurate".
Check across frames: identity drift (face, hair, skin, build), garment consistency (colour, pattern scale/alignment, waistband, flare, hem length; front-facing views must match the product), footwear, does she really rotate ~360° and return to front, feet stay planted on the same spot, background stays still and unaltered, artifacts (morphing limbs, flicker, extra people/text).
Return ONLY JSON: {"verdict":"pass|review|fail","rotation_observed":"e.g. full 360 / partial ~180 / none","identity":{"verdict":"","issues":[]},"garment":{"verdict":"","issues":[]},"scene":{"verdict":"","issues":[]},"artifacts":[],"per_frame_notes":["t: note"],"human_review_points":[]}` },
  await load('../assets/derived/person_front.png'), await load(args.garment || '../assets/derived/garment_gingham_flare_trousers.png'),
  { type: 'image', mime: still.mime, data: still.data }, ...(await Promise.all(frames.map(f => load(f.f)))),
]
let qa = null
try {
  const r = await interact({ model: cfg.qa, parts: qaParts })
  qa = parseJsonLoose(outputText(r.json))
  trace.push({ role: 'Model B · Gemini 4 video-frame QA', provider: 'gemini', model: cfg.qa, servedModel: r.servedModel, latencyMs: r.latencyMs, requestId: r.requestId, usage: r.usage })
} catch (e) {
  trace.push({ role: 'Model B QA FAILED', provider: 'gemini', model: cfg.qa, latencyMs: e.latencyMs, error: e.message })
}
await fs.writeFile(path.join(outDir, 'trace.json'), JSON.stringify({ source: args.image, prompt: PROMPT, aspect, duration, videoSeconds: dur, frames: frames.map(f => f.f), qa, trace, note: 'Side/back views are model-inferred, not captured. Not a fit or size guarantee.' }, null, 2))
console.log(JSON.stringify({ qa, trace: trace.map(t => `${t.role} ${t.model} ${t.latencyMs}ms`) }, null, 2))
console.log(`\nOutputs in ${outDir}/ (turnaround.mp4, contact_sheet.jpg, frames/, trace.json)`)
