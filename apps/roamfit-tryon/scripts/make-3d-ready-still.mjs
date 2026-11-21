// Step 1 of the 3D path: turn an approved garment-swap still into a reconstruction-friendly photo
// (full body incl. feet, slight A-pose, plain backdrop, soft even light, eye-level camera), then Model B checks it.
// Sends images to Google Gemini API only.  node --env-file=.env scripts/make-3d-ready-still.mjs --image=<garment-swap still>
import fs from 'node:fs/promises'
import path from 'node:path'
import { intake } from '../server/tryon/assetIntake.js'
import { getImageProvider } from '../server/tryon/imageProvider.js'
import { inspect } from '../server/tryon/visualQa.js'
import { modelConfig, generationLabel } from '../server/tryon/models.js'

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true] }))
const D = '../assets/derived'
const load = async (role, p) => { const r = intake(role, await fs.readFile(p), p); if (!r.ok) throw new Error(r.errors.join('; ')); return r.image }
const still = await load('person', args.image || 'spike-results/runs/dd25fffe/attempt2.jpg')
const person = await load('person', `${D}/person_front.png`)
const garment = await load('garment', `${D}/${args.garment || 'garment_gingham_flare_trousers.png'}`)
const cfg = modelConfig()
const outDir = path.join('spike-results/3d', new Date().toISOString().replace(/[:.]/g, '-'))
await fs.mkdir(outDir, { recursive: true })

const PROMPT = `Photorealistic image edit for 3D reconstruction. Re-photograph the SAME person wearing the SAME outfit as a clean full-body reference shot:
- Identity: keep her face, hair colour/length/parting, skin tone and body proportions exactly as in the PERSON reference.
- Outfit: keep every garment exactly — the top with its blue/brown gradient print and black long sleeves, and the black-and-white gingham flared trousers matching the GARMENT reference (same check size, high waistband, front crease, flare, full length to the shoe). Keep the black chunky boots.
- Pose: standing straight, facing the camera squarely, weight on both feet, feet about hip-width apart and fully visible, arms held slightly away from the body (about 20 degrees) so there is clear space between arms and torso, hands relaxed and open, neutral expression, eyes open.
- Camera: eye level at mid-body height, long lens, no perspective distortion, whole body from top of head to soles of shoes in frame with a small margin.
- Background and light: plain seamless light-grey studio backdrop, soft even diffuse lighting from the front, no strong shadows, no rim light, no props, no text.`

const provider = getImageProvider('gemini')
const gen = await provider.generate({ model: cfg.image, prompt: PROMPT, refs: [['person', still], ['garment', garment]], aspectRatio: '9:16' })
const file = path.join(outDir, `ready_still.${gen.image.mime === 'image/png' ? 'png' : 'jpg'}`)
await fs.writeFile(file, Buffer.from(gen.image.data, 'base64'))
console.log(`generated ${file} (${gen.call.latencyMs}ms)`)

const { qa, call } = await inspect({ model: cfg.qa, stage: 'garment', person, garment, generated: gen.image, plan: null })
const trace = [gen.call, call].map(c => ({ ...c, generation: generationLabel(c.model) }))
await fs.writeFile(path.join(outDir, 'trace.json'), JSON.stringify({ source: args.image, prompt: PROMPT, file, qa, trace }, null, 2))
console.log(JSON.stringify({ qa, trace: trace.map(t => `${t.role} ${t.model} ${t.latencyMs}ms`) }, null, 2))
