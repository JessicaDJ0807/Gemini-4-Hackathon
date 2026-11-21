// Step 2 of the 3D path: single image → textured 3D asset via SAM 3D Objects hosted on fal.ai.
// The back/sides of the result are INFERRED by the model. Sends the image to fal.ai — requires FAL_KEY and --confirm-upload.
//   node --env-file=.env scripts/run-sam3d.mjs --image=spike-results/3d/<run>/ready_still.jpg --confirm-upload
import fs from 'node:fs/promises'
import path from 'node:path'

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true] }))
const ENDPOINT = 'fal-ai/sam-3/3d-objects'
if (!args.image) { console.error('--image required'); process.exit(1) }
if (!args['confirm-upload']) { console.error(`Dry run: would send ${args.image} to fal.ai ${ENDPOINT}. Re-run with --confirm-upload.`); process.exit(0) }
if (!process.env.FAL_KEY) { console.error('FAL_KEY missing in .env'); process.exit(1) }

const buf = await fs.readFile(args.image)
const mime = buf[0] === 0xff ? 'image/jpeg' : 'image/png'
const headers = {
  Authorization: `Key ${process.env.FAL_KEY}`,
  'Content-Type': 'application/json',
  'X-Fal-Store-IO': '0',                                                     // don't keep payload in request history
  'X-Fal-Object-Lifecycle-Preference': JSON.stringify({ expiration_duration_seconds: 3600 }), // CDN files expire after 1h
}
const body = { image_url: `data:${mime};base64,${buf.toString('base64')}`, prompt: args.prompt || 'person', export_textured_glb: true, ...(args.seed && { seed: Number(args.seed) }) }

const t0 = Date.now()
const sub = await fetch(`https://queue.fal.run/${ENDPOINT}`, { method: 'POST', headers, body: JSON.stringify(body) })
const subJson = await sub.json()
if (!sub.ok) { console.error('submit failed', sub.status, JSON.stringify(subJson).slice(0, 500)); process.exit(1) }
console.log('submitted', subJson.request_id)
let status
for (;;) {
  await new Promise(r => setTimeout(r, 3000))
  status = await (await fetch(subJson.status_url, { headers })).json()
  process.stdout.write(`${status.status} `)
  if (status.status === 'COMPLETED' || status.error) break
}
const result = await (await fetch(subJson.response_url, { headers })).json()
const latencyMs = Date.now() - t0
if (status.error || result.detail) { console.error('\nfailed', JSON.stringify(status.error || result.detail).slice(0, 800)); process.exit(1) }

const outDir = path.dirname(args.image)
const fileUrl = f => (typeof f === 'string' ? f : f?.url)
const saved = {}
for (const [key, name] of [['model_glb', 'person.glb'], ['gaussian_splat', 'person_splat.ply']]) {
  const url = fileUrl(result[key]); if (!url) continue
  const b = Buffer.from(await (await fetch(url)).arrayBuffer())
  await fs.writeFile(path.join(outDir, name), b); saved[key] = { file: name, bytes: b.length }
}
const trace = { role: '3D reconstruction', provider: 'fal.ai', model: ENDPOINT, requestId: subJson.request_id, latencyMs, inferenceSec: status.metrics?.inference_time, saved, metadata: result.metadata,
  note: 'Unseen sides are model-inferred, not captured. Not a fit or size measurement.' }
await fs.writeFile(path.join(outDir, 'sam3d_trace.json'), JSON.stringify(trace, null, 2))
console.log('\n' + JSON.stringify(trace, null, 2))
