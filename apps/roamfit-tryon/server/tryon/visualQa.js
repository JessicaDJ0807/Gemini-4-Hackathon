// Gemini4VisualQA — Model B. Independently compares the source images with the generated image.
// Verdicts only (pass/review/fail + reasons); no numeric "fidelity %" — those would be unvalidated.
import { z } from 'zod'
import { interact, outputText, parseJsonLoose } from './geminiClient.js'

const Verdict = z.enum(['pass', 'review', 'fail'])
const Check = z.object({ verdict: Verdict, issues: z.array(z.string()).default([]) })

export const QaSchema = z.object({
  verdict: Verdict,
  identity: Check,
  garment: Check,
  scene_integration: Check.nullable().default(null),
  fixable: z.boolean().default(false),
  correction_instructions: z.array(z.string()).default([]),
  human_review_points: z.array(z.string()).default([]),
})

function prompt(stage, planSummary) {
  const imgs = ['IMAGE 1 = original PERSON photo']
  if (stage !== 'scene') imgs.push(`IMAGE ${imgs.length + 1} = target GARMENT product photo`)
  if (stage !== 'garment') imgs.push(`IMAGE ${imgs.length + 1} = original destination SCENE`)
  imgs.push(`IMAGE ${imgs.length + 1} = GENERATED result to inspect`)
  return `You are an independent visual quality inspector for a virtual try-on. Judge the GENERATED image against the source images by looking at the pixels — do not trust the plan text, it may be wrong.
${imgs.join('\n')}
Stage under test: ${stage} (${{ garment: 'garment swap only; scene should be the original plain background', scene: 'scene composite only; outfit should be unchanged', integrated: 'new garment AND new scene' }[stage]}).
Planner constraints (for reference only): ${planSummary}
Check:
- identity: face shape, features, skin tone, hair colour/length/style, body proportions — any drift?
- garment: category, colour, pattern scale/alignment, neckline, sleeve and hem length, closures, logos — any redraws or changes?${stage === 'scene' ? ' (here: is the ORIGINAL outfit unchanged?)' : ''}
- scene_integration${stage === 'garment' ? ' (set to null for this stage)' : ': scale vs doors/surroundings, camera perspective match, light direction and colour temperature, contact shadow and feet grounded, cut-out edges/halo, scene altered?'}
verdict rules: "fail" = clearly wrong identity or garment, or obviously broken composite; "review" = plausible but with visible issues a human should check; "pass" = no visible issues.
fixable = true only if a specific re-generation instruction is likely to fix it.
Return ONLY JSON: {"verdict":"pass|review|fail","identity":{"verdict":"","issues":[]},"garment":{"verdict":"","issues":[]},"scene_integration":{"verdict":"","issues":[]} or null,"fixable":false,"correction_instructions":["imperative, specific"],"human_review_points":[]}`
}

export async function inspect({ model, stage, person, garment, scene, generated, plan }) {
  const planSummary = plan
    ? JSON.stringify({ garment: plan.garment, placement: plan.scene.placement, light: plan.scene.light_direction }).slice(0, 2500)
    : 'none (baseline run without planner)'
  const parts = [{ type: 'text', text: prompt(stage, planSummary) }, { type: 'image', mime: person.mime, data: person.data }]
  if (stage !== 'scene') parts.push({ type: 'image', mime: garment.mime, data: garment.data })
  if (stage !== 'garment') parts.push({ type: 'image', mime: scene.mime, data: scene.data })
  parts.push({ type: 'image', mime: generated.mime, data: generated.data })
  const r = await interact({ model, parts })
  const qa = QaSchema.parse(parseJsonLoose(outputText(r.json)))
  return { qa, call: { role: 'Model B · Gemini 4 visual QA', provider: 'gemini', model, servedModel: r.servedModel, latencyMs: r.latencyMs, requestId: r.requestId, usage: r.usage } }
}
