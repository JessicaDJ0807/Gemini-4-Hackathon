// Phase 0 probe: which Gemini 4 model IDs does this key reach, and do they accept / produce images?
// Sends ONLY a synthetic 64x64 test pattern (no user assets). Usage: node --env-file=.env scripts/probe-gemini4.mjs
import fs from 'node:fs/promises'
import zlib from 'node:zlib'
import { interact, outputText, outputImage } from '../server/tryon/geminiClient.js'

if (!process.env.GEMINI_API_KEY) { console.error('GEMINI_API_KEY missing in .env'); process.exit(1) }
await fs.mkdir('spike-results', { recursive: true })

// Synthetic PNG: left half red, right half blue.
function testPng(w = 64, h = 64) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = x < w / 2 ? 255 : 0; raw[o + 2] = x < w / 2 ? 0 : 255 }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const img = { type: 'image', mime: 'image/png', data: testPng().toString('base64') }

const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY } })
const list = await res.json()
const listed = (list.models || []).map(m => m.name.replace('models/', ''))
const candidates = [...new Set([...listed.filter(n => n.startsWith('gemini-4')), 'gemini-4-argon', 'gemini-4-carbon', 'gemini-4-neon', 'gemini-4-hydrogen'])]
const report = { probedAt: new Date().toISOString(), listModelsStatus: res.status, listModelsError: list.error?.message, gemini4Listed: listed.filter(n => n.startsWith('gemini-4')), imageModelsListed: listed.filter(n => /image|banana/.test(n)), models: {} }

async function attempt(fn) { try { return await fn() } catch (e) { return { ok: false, status: e.status, error: e.message, latencyMs: e.latencyMs } } }

for (const model of candidates) {
  const r = {}
  r.text = await attempt(async () => { const x = await interact({ model, parts: [{ type: 'text', text: 'Reply with exactly: OK' }], timeoutMs: 60000 }); return { ok: true, latencyMs: x.latencyMs, reply: outputText(x.json).slice(0, 40), servedModel: x.servedModel, usage: x.usage } })
  if (r.text.ok) {
    r.imageInput = await attempt(async () => { const x = await interact({ model, parts: [{ type: 'text', text: 'What two colors are in this image, left then right? Answer in 4 words max.' }, img], timeoutMs: 60000 }); const t = outputText(x.json); return { ok: /red/i.test(t) && /blue/i.test(t), latencyMs: x.latencyMs, reply: t.slice(0, 60) } })
    r.imageOutput = await attempt(async () => { const x = await interact({ model, parts: [{ type: 'text', text: 'Generate a simple image of a green square.' }], responseFormat: { type: 'image' }, timeoutMs: 90000 }); const o = outputImage(x.json); return { ok: Boolean(o), latencyMs: x.latencyMs, mime: o?.mime } })
  }
  report.models[model] = r
  console.log(model, JSON.stringify(r))
}
// Image generator sanity check (synthetic edit, no user assets)
const imgModel = process.env.IMAGE_MODEL || 'gemini-nano-banana-2.1'
report.imageGenerator = { model: imgModel, ...(await attempt(async () => { const x = await interact({ model: imgModel, parts: [{ type: 'text', text: 'Turn the red half of this image green.' }, img], responseFormat: { type: 'image' }, timeoutMs: 120000 }); const o = outputImage(x.json); if (o) await fs.writeFile('spike-results/probe-image-output.' + (o.mime.split('/')[1] || 'png'), Buffer.from(o.data, 'base64')); return { ok: Boolean(o), latencyMs: x.latencyMs, usage: x.usage } })) }
console.log('image generator', JSON.stringify(report.imageGenerator))
await fs.mkdir('spike-results', { recursive: true })
await fs.writeFile('spike-results/gemini4-probe.json', JSON.stringify(report, null, 2))
console.log('\nwritten spike-results/gemini4-probe.json')
