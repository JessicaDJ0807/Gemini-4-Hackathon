// Gemini4Planner — Model A. Looks at person, garment and scene images and returns a structured edit plan.
// The plan's fields are compiled into the generator prompt (see compileGenerationPrompt), so it materially drives generation.
import { z } from 'zod'
import { interact, outputText, parseJsonLoose } from './geminiClient.js'

const str = z.string().default('')
const list = z.array(z.string()).default([])

export const PlanSchema = z.object({
  person: z.object({
    identity_features_to_preserve: list, // face shape, hair colour/length/part, skin tone, build
    pose: str,
    framing: str,                        // e.g. full body head-to-feet, front facing
    current_outfit: str,
    uncertain: list,
  }),
  garment: z.object({
    category: str,                       // top | bottom | outerwear | dress | ...
    body_region: str,
    colors: list,
    pattern: str,
    neckline: str,
    sleeves: str,
    length: str,
    fit_silhouette: str,
    closures: str,
    logos_or_text: str,
    details_to_preserve: list,
    uncertain: list,                     // e.g. back view, fabric weight
  }),
  outfit_conflicts: list,                // what happens to the person's other clothing
  scene: z.object({
    camera_height: str,
    perspective: str,
    horizon_y_frac: z.number().min(0).max(1).nullable().default(null),
    ground_surface: str,
    light_direction: str,
    color_temperature: str,
    shadow_character: str,
    placement: z.object({
      x_frac: z.number().min(0).max(1).nullable().default(null),
      feet_y_frac: z.number().min(0).max(1).nullable().default(null),
      person_height_frac: z.number().min(0).max(2).nullable().default(null),
      rationale: str,
    }),
    uncertain: list,
  }),
  avoid: list,
})

const PROMPT = `You are the planning model in a virtual try-on pipeline. You receive three images, in this order:
IMAGE 1 = the PERSON (keep their identity), IMAGE 2 = ONE GARMENT product photo, IMAGE 3 = the destination SCENE photo.
Look carefully at the pixels. Do not invent facts you cannot see; list them under "uncertain".
Return ONLY a JSON object with exactly this shape:
{
 "person": {"identity_features_to_preserve": [..specific visible traits..], "pose": "", "framing": "", "current_outfit": "", "uncertain": []},
 "garment": {"category": "", "body_region": "", "colors": [], "pattern": "", "neckline": "", "sleeves": "", "length": "", "fit_silhouette": "", "closures": "", "logos_or_text": "", "details_to_preserve": [], "uncertain": []},
 "outfit_conflicts": ["how the new garment interacts with what the person already wears, and the most neutral resolution"],
 "scene": {"camera_height": "", "perspective": "", "horizon_y_frac": 0.0, "ground_surface": "", "light_direction": "", "color_temperature": "", "shadow_character": "",
   "placement": {"x_frac": 0.0, "feet_y_frac": 0.0, "person_height_frac": 0.0, "rationale": "where a standing adult would plausibly stand, with feet on visible ground, scaled to nearby doors/people"},
   "uncertain": []},
 "avoid": ["specific failure modes to avoid for THIS input set"]
}
Fractions are of image width/height measured from top-left of IMAGE 3. person_height_frac = standing person height / scene image height at that spot.`

export async function planTryOn({ model, person, garment, scene }) {
  const parts = [
    { type: 'text', text: PROMPT },
    { type: 'image', mime: person.mime, data: person.data },
    { type: 'image', mime: garment.mime, data: garment.data },
    { type: 'image', mime: scene.mime, data: scene.data },
  ]
  const r = await interact({ model, parts })
  const raw = outputText(r.json)
  const plan = PlanSchema.parse(parseJsonLoose(raw))
  return { plan, call: { role: 'Model A · Gemini 4 planner', provider: 'gemini', model, servedModel: r.servedModel, latencyMs: r.latencyMs, requestId: r.requestId, usage: r.usage } }
}

const pct = v => (v == null ? 'unknown' : `${Math.round(v * 100)}%`)

/** Turns the plan into concrete generator instructions. stage: garment | scene | integrated */
export function compileGenerationPrompt(plan, stage, corrections = []) {
  const p = plan.person, g = plan.garment, s = plan.scene
  const identity = `Keep the person's identity exactly: ${p.identity_features_to_preserve.join('; ') || 'face, hair, skin tone and build'}. Keep the pose (${p.pose || 'as in the photo'}).`
  const garmentSpec = [
    `Dress the person in the garment from the garment reference image: a ${g.colors.join('/')} ${g.category}`,
    g.pattern && `pattern: ${g.pattern}`, g.neckline && `neckline: ${g.neckline}`, g.sleeves && `sleeves: ${g.sleeves}`,
    g.length && `length: ${g.length}`, g.fit_silhouette && `silhouette: ${g.fit_silhouette}`, g.closures && `closures: ${g.closures}`,
    g.logos_or_text && `logos/text: ${g.logos_or_text}`,
  ].filter(Boolean).join('; ') + `. Preserve exactly: ${g.details_to_preserve.join('; ')}.` +
    (plan.outfit_conflicts.length ? ` Rest of outfit: ${plan.outfit_conflicts.join(' ')}` : '')
  const sceneSpec = `Place the full-body person into the destination scene image, keeping the scene's buildings, street and sky unchanged. ` +
    `Stand them at about ${pct(s.placement.x_frac)} from the left with feet at ${pct(s.placement.feet_y_frac)} of image height on the ${s.ground_surface || 'ground'}, ` +
    `body height about ${pct(s.placement.person_height_frac)} of the frame. Match camera: ${s.camera_height}; ${s.perspective}. ` +
    `Match light: ${s.light_direction}, ${s.color_temperature}; cast a ${s.shadow_character} contact shadow consistent with that light so the feet are grounded.`
  const avoid = `Avoid: ${[...plan.avoid, 'changing the face', 'redrawing or simplifying the garment pattern', 'floating feet', 'adding text or watermarks'].join('; ')}.`
  const fix = corrections.length ? `\nCORRECTIONS from visual QA of the previous attempt — apply all: ${corrections.join(' | ')}` : ''
  const body = {
    garment: `${identity}\n${garmentSpec}\nKeep the original plain background and framing.`,
    scene: `${identity}\nKeep the person's current outfit unchanged.\n${sceneSpec}`,
    integrated: `${identity}\n${garmentSpec}\n${sceneSpec}`,
  }[stage]
  return `Photorealistic image edit.\n${body}\n${avoid}${fix}`
}
