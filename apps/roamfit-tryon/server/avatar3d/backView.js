// Back view of an existing Little Self concept (same character/pose/framing) + Model B front/back consistency QA.
// Sends the generated concept (no real-person photo) to Google Gemini API.
import fs from 'node:fs/promises'
import path from 'node:path'
import { interact, outputImage, outputText, parseJsonLoose } from '../tryon/geminiClient.js'
import { modelConfig } from '../tryon/models.js'
import { CACHE_DIR, readEntry, writeEntry } from './cache.js'

const BG = 'Background: a plain, seamless, uniform MEDIUM GREY studio backdrop (about #8e8e8e) with no gradient and no visible floor line, so the figure can be cut out cleanly. Soft even lighting, a very faint contact shadow only.'
const subject = mode => mode === 'real-me'
  ? 'This is a photorealistic studio photo of a real person (FRONT view). Keep her identity (hair colour, length and style, skin tone, body proportions) and every garment detail exactly; do not stylise.'
  : 'This is a 3D character render (FRONT view) in a soft-clay collectible style. Keep the clay material, simplified design and colours exactly.'

// Original stroll/layered wording is kept for entries without a garment summary; dynamic looks (try-on integration) describe their own garments.
const outfitDetail = (entry, view) => entry.garmentSummary
  ? (view === "back" ? `the back of every garment: ${entry.garmentSummary}; same colours, pattern scale, hem lengths and the heels of the same shoes` : `the side of every garment: ${entry.garmentSummary}; same colours, pattern scale and hem lengths, shoes in profile, fully visible`)
  : (view === "back" ? "back of the top, back of the gingham trousers with the same check size, heels of the same shoes" : "side of the top, side of the gingham trousers with the same check size, shoes in profile, fully visible")

export async function makeBackView(key) {
  const entry = await readEntry(key)
  if (!entry?.source) throw new Error(`no concept for ${key}`)
  const cfg = modelConfig()
  const buf = await fs.readFile(path.join(CACHE_DIR, key, entry.source.file))
  const front = { type: 'image', mime: buf[0] === 0xff ? 'image/jpeg' : 'image/png', data: buf.toString('base64') }
  const PROMPT = `${subject(entry.mode)} Show the EXACT same subject seen from DIRECTLY BEHIND: the camera has moved 180 degrees around her. Keep the outfit identical (${outfitDetail(entry, "back")}) and the hair as seen from behind. Keep IDENTICAL framing for alignment: same canvas, same height and position in the frame, feet at the same height, same A-pose seen from behind. No face visible. No props, no text. ${BG}`
  const g = await interact({ model: cfg.image, parts: [{ type: 'text', text: PROMPT }, front], responseFormat: { type: 'image', aspect_ratio: '9:16', image_size: '2K' }, timeoutMs: 240000 })
  const back = outputImage(g.json); if (!back) throw new Error('no back image returned')
  const file = `back.${back.mime === 'image/png' ? 'png' : 'jpg'}`
  await fs.writeFile(path.join(CACHE_DIR, key, file), Buffer.from(back.data, 'base64'))
  const q = await interact({ model: cfg.qa, parts: [{ type: 'text', text: `IMAGE 1 = FRONT view. IMAGE 2 = generated BACK view that must be the same character from behind, for front/back 3D reconstruction.
Check by pixels: same character design and colours; hair consistent; garments consistent (${entry.garmentSummary ? "colours, pattern scale, hem lengths, layering, shoes" : "gingham scale, hem lengths, shoes"}); same height/position/pose in frame (for alignment); truly a back view (no face).
Return ONLY JSON {"verdict":"pass|review|fail","consistency":{"verdict":"","issues":[]},"alignment":{"verdict":"","issues":[]}}` }, front, { type: 'image', mime: back.mime, data: back.data }] })
  const qa = parseJsonLoose(outputText(q.json))
  const fresh = await readEntry(key)
  await writeEntry(key, { ...fresh, back: { file, qa, createdAt: new Date().toISOString() },
    trace: [...fresh.trace, { role: 'Image generator · back view', model: cfg.image, generation: 'Nano Banana 2.1 (Gemini 3.1 Flash Image lineage)', latencyMs: g.latencyMs }, { role: 'Model B · Gemini 4 front/back consistency QA', model: cfg.qa, generation: 'Gemini 4', latencyMs: q.latencyMs }] })
  return { file, qa, latency: { gen: g.latencyMs, qa: q.latencyMs } }
}


// Side view (left profile) for depth + side texture. Model B reports which way the character faces so we can mirror.
export async function makeSideView(key) {
  const entry = await readEntry(key)
  if (!entry?.source) throw new Error(`no concept for ${key}`)
  const cfg = modelConfig()
  const buf = await fs.readFile(path.join(CACHE_DIR, key, entry.source.file))
  const front = { type: 'image', mime: buf[0] === 0xff ? 'image/jpeg' : 'image/png', data: buf.toString('base64') }
  const PROMPT = `${subject(entry.mode)} Show the EXACT same subject in a strict 90-degree SIDE PROFILE: the camera has moved to her LEFT side, so she faces toward the LEFT edge of the image. Keep the outfit identical (${outfitDetail(entry, "side")}) and the hair as seen from the side. Same height and feet position in the frame, standing straight with arms relaxed. No props, no text. ${BG}`
  const g = await interact({ model: cfg.image, parts: [{ type: 'text', text: PROMPT }, front], responseFormat: { type: 'image', aspect_ratio: '9:16', image_size: '2K' }, timeoutMs: 240000 })
  const side = outputImage(g.json); if (!side) throw new Error('no side image returned')
  const file = `side.${side.mime === 'image/png' ? 'png' : 'jpg'}`
  await fs.writeFile(path.join(CACHE_DIR, key, file), Buffer.from(side.data, 'base64'))
  const q = await interact({ model: cfg.qa, parts: [{ type: 'text', text: `IMAGE 1 = FRONT view. IMAGE 2 = generated SIDE view of the same character.
Check by pixels: is IMAGE 2 a true side profile (about 90 degrees)? Which image edge is the character's face/toes pointing toward? Same design, colours, hair, garments, height in frame?
Return ONLY JSON {"verdict":"pass|review|fail","is_profile":true,"facing":"left|right","consistency":{"verdict":"","issues":[]}}` }, front, { type: 'image', mime: side.mime, data: side.data }] })
  const qa = parseJsonLoose(outputText(q.json))
  const fresh = await readEntry(key)
  await writeEntry(key, { ...fresh, side: { file, qa, facing: qa.facing === 'right' ? 'right' : 'left', createdAt: new Date().toISOString() },
    trace: [...fresh.trace, { role: 'Image generator · side view', model: cfg.image, generation: 'Nano Banana 2.1 (Gemini 3.1 Flash Image lineage)', latencyMs: g.latencyMs }, { role: 'Model B · Gemini 4 side-view check (profile + facing)', model: cfg.qa, generation: 'Gemini 4', latencyMs: q.latencyMs }] })
  return { file, qa, latency: { gen: g.latencyMs, qa: q.latencyMs } }
}
