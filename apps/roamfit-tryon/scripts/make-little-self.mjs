// My Little Self — step A: stylised character concept image (input to image-to-3D).
// Model A (Gemini 4) extracts visible, non-sensitive appearance traits → image model draws the character in the
// user-supplied "Cozy Minimal / Soft Clay Traveler" style → Model B (Gemini 4) checks style + pose + outfit.
// Sends to Google Gemini API: person photo, style reference, garment photos.
//   node --env-file=.env scripts/make-little-self.mjs [--outfit=stroll|port]
import fs from 'node:fs/promises'
import path from 'node:path'
import { interact, outputText, outputImage, parseJsonLoose } from '../server/tryon/geminiClient.js'
import { intake } from '../server/tryon/assetIntake.js'
import { modelConfig } from '../server/tryon/models.js'

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true] }))
const A = '../assets'
const OUTFITS = {
  stroll: { label: 'ivory square-neck short-sleeve tee, black-and-ecru gingham high-rise flared trousers, white low-top sneakers', garments: ['derived/garment_white_squareneck_tee.png', 'derived/garment_gingham_flare_trousers.png'] },
  port: { label: 'black cropped V-neck button cardigan over the ivory square-neck tee, black-and-ecru gingham flared trousers, white low-top sneakers', garments: ['derived/garment_black_cropped_cardigan.png', 'derived/garment_white_squareneck_tee.png', 'derived/garment_gingham_flare_trousers.png'] },
}
const outfitId = args.outfit || 'stroll'
const outfit = OUTFITS[outfitId]
const img = async (p, role = 'garment') => { const r = intake(role, await fs.readFile(path.join(A, p)), p); if (!r.ok) throw new Error(r.errors.join('; ')); return { type: 'image', mime: r.image.mime, data: r.image.data } }
const person = await img('derived/person_front.png', 'person')
const style = await img('reference/style_cozy_clay_traveler.png')
const garments = await Promise.all(outfit.garments.map(g => img(g)))
const cfg = modelConfig()
const outDir = path.join('spike-results/little-self', `${outfitId}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
await fs.mkdir(outDir, { recursive: true })
const trace = []

// ---- Model A: visible appearance → constrained attributes ----
const ATTR_PROMPT = `You map a real person's VISIBLE appearance onto a fixed stylised avatar system. IMAGE 1 is the person.
Report only what is clearly visible. Do NOT infer age, ethnicity, gender identity, health or any sensitive attribute; do not estimate body measurements.
Return ONLY JSON: {"hair":{"length":"short|chin|shoulder|long","texture":"straight|wavy|curly|coily","parting":"centre|side|none","fringe":true,"color":"plain words e.g. honey brown"},
"skin_tone_swatch":"light|light-medium|medium|medium-deep|deep (closest neutral swatch, for colour only)","glasses":false,"visible_accessories":[],"build":"slim|average|curvy|broad (overall silhouette only)","uncertain":[]}`
const a = await interact({ model: cfg.planner, parts: [{ type: 'text', text: ATTR_PROMPT }, person] })
const attrs = parseJsonLoose(outputText(a.json))
trace.push({ role: 'Model A · Gemini 4 appearance mapping', model: cfg.planner, latencyMs: a.latencyMs })
console.log('attributes', JSON.stringify(attrs))

// ---- image model: stylised concept ----
const hair = attrs.hair || {}
const GEN_PROMPT = `Create ONE full-body 3D character render in EXACTLY the art style of the STYLE REFERENCE image: cozy minimal soft-clay collectible figure —
slightly oversized rounded head with simplified geometry, tiny dot eyes, very subtle nose and small mouth, small rounded ears, slim elongated body and legs,
softly rounded hands and shoes, premium matte clay-like surfaces with subtle fabric texture, muted warm-neutral colours, gentle ambient light, soft shadow.
Character identity (stylised, NOT a realistic face): ${hair.length || 'long'} ${hair.texture || 'straight'} ${hair.color || 'brown'} hair${hair.parting ? `, ${hair.parting} parting` : ''}${hair.fringe ? ', with a fringe' : ', no fringe'};
${attrs.skin_tone_swatch || 'light'} skin tone; ${attrs.glasses ? 'round glasses; ' : ''}${(attrs.visible_accessories || []).length ? `accessories: ${attrs.visible_accessories.join(', ')}; ` : ''}${attrs.build || 'slim'} build.
Outfit (use the GARMENT reference images for colour, pattern and silhouette, translated into the clay style; keep the gingham check visible): ${outfit.label}.
Pose and framing for 3D reconstruction: standing upright, facing the camera squarely, neutral A-pose with arms angled about 25 degrees away from the body and clear space between arms and torso,
empty open hands, feet hip-width apart, whole figure from the top of the head to the soles of the shoes visible with margin, orthographic-looking eye-level camera.
Plain seamless warm off-white background, no props, no cup, no tablet, no hat unless listed, no text, no logo, no ground clutter.`
const parts = [{ type: 'text', text: GEN_PROMPT }, { type: 'text', text: 'STYLE REFERENCE:' }, style, ...garments.flatMap((g, i) => [{ type: 'text', text: `GARMENT reference ${i + 1}:` }, g])]
const g = await interact({ model: cfg.image, parts, responseFormat: { type: 'image', aspect_ratio: '9:16', image_size: '2K' }, timeoutMs: 240000 })
const concept = outputImage(g.json)
if (!concept) throw new Error('image model returned no image: ' + outputText(g.json).slice(0, 200))
const file = path.join(outDir, `concept.${concept.mime === 'image/png' ? 'png' : 'jpg'}`)
await fs.writeFile(file, Buffer.from(concept.data, 'base64'))
trace.push({ role: 'Image generator (Gemini 3.1 Flash Image lineage — not Gemini 4)', model: cfg.image, latencyMs: g.latencyMs })
console.log('concept', file)

// ---- Model B: independent check against style reference + garments ----
const QA_PROMPT = `Independent QA of a generated stylised character. IMAGE 1 = STYLE REFERENCE. IMAGES 2..${1 + garments.length} = GARMENT references. LAST IMAGE = GENERATED character.
Check by looking at pixels: (1) style match to the reference (head/body proportions, dot eyes, clay material, palette); (2) reconstruction readiness: full body incl. shoes visible, A-pose with arms separated from torso, plain background, no props;
(3) garment fidelity: colours, gingham pattern, neckline, trouser flare. Return ONLY JSON {"verdict":"pass|review|fail","style":{"verdict":"","issues":[]},"pose":{"verdict":"","issues":[]},"garments":{"verdict":"","issues":[]},"ready_for_3d":true,"fix_instructions":[]}`
const q = await interact({ model: cfg.qa, parts: [{ type: 'text', text: QA_PROMPT }, style, ...garments, { type: 'image', mime: concept.mime, data: concept.data }] })
const qa = parseJsonLoose(outputText(q.json))
trace.push({ role: 'Model B · Gemini 4 concept QA', model: cfg.qa, latencyMs: q.latencyMs })
await fs.writeFile(path.join(outDir, 'trace.json'), JSON.stringify({ outfitId, attrs, prompt: GEN_PROMPT, file, qa, trace }, null, 2))
console.log(JSON.stringify({ qa, trace }, null, 2))
