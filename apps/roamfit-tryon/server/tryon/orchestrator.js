// TryOnOrchestrator + RunTrace. Plan (Model A) → generate → QA (Model B) → at most one QA-driven retry → QA again.
// Writes images + run.json (no base64, no keys) to spike-results/runs/<runId>/.
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { modelConfig, validateModelConfig, generationLabel } from './models.js'
import { planTryOn, compileGenerationPrompt, PlanSchema } from './planner.js'
import { inspect } from './visualQa.js'
import { getImageProvider } from './imageProvider.js'
import { hasGeminiKey } from './geminiClient.js'

export const RUNS_DIR = path.resolve('spike-results/runs')
const ext = mime => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' })[mime] || 'bin'

const BASELINE_PROMPT = {
  garment: 'Make the person in the first image wear the garment shown in the second image. Photorealistic.',
  scene: 'Place the person from the first image into the scene from the second image. Photorealistic.',
  integrated: 'Make the person in the first image wear the garment in the second image and place them in the scene in the third image. Photorealistic.',
}

function refsFor(stage, { person, garment, scene }) {
  return [['person', person], ...(stage !== 'scene' ? [['garment', garment]] : []), ...(stage !== 'garment' ? [['scene', scene]] : [])]
}

function aspectFor(stage, { person, scene }) {
  const src = stage === 'garment' ? person : scene
  const r = src.width / src.height
  const options = [['9:16', 9 / 16], ['2:3', 2 / 3], ['3:4', 3 / 4], ['1:1', 1], ['4:3', 4 / 3], ['3:2', 3 / 2], ['16:9', 16 / 9], ['21:9', 21 / 9]]
  return options.reduce((best, o) => (Math.abs(o[1] - r) < Math.abs(best[1] - r) ? o : best))[0]
}

/**
 * mode: 'pipeline' (two Gemini 4 models + generator) | 'baseline' (one generator call, no plan; QA only as an evaluation)
 * stage: 'garment' | 'scene' | 'integrated'
 * onUpdate(run) called on every state change.
 */
export async function runTryOn({ mode = 'pipeline', stage = 'integrated', inputs, inputNames = {}, onUpdate = () => {}, runId = crypto.randomUUID().slice(0, 8), maxRetries = 1 }) {
  const cfg = modelConfig()
  const live = hasGeminiKey() && process.env.TRYON_MOCK !== '1'
  const dir = path.join(RUNS_DIR, runId)
  await fs.mkdir(dir, { recursive: true })
  const run = {
    runId, mode, stage, live, status: 'running', step: 'starting', startedAt: new Date().toISOString(),
    inputs: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, { name: inputNames[k] || k, mime: v.mime, width: v.width, height: v.height }])),
    plan: null, attempts: [], final: null, error: null, trace: [],
  }
  const save = async () => { await fs.writeFile(path.join(dir, 'run.json'), JSON.stringify(run, null, 2)); onUpdate(structuredClone(run)) }
  const record = call => run.trace.push({ ...call, generation: generationLabel(call.model) })
  const saveImage = async (name, img) => { const f = `${name}.${ext(img.mime)}`; await fs.writeFile(path.join(dir, f), Buffer.from(img.data, 'base64')); return f }

  try {
    if (live) {
      const errs = validateModelConfig(cfg)
      if (errs.length) throw new Error(`model config: ${errs.join('; ')}`)
    }
    const provider = getImageProvider(live ? cfg.imageProvider : 'mock')
    const qaModel = live ? cfg.qa : null

    if (mode === 'pipeline') {
      run.step = 'plan'; await save()
      if (live) {
        const { plan, call } = await planTryOn({ model: cfg.planner, ...inputs }); run.plan = plan; record(call)
      } else {
        run.plan = PlanSchema.parse(MOCK_PLAN); record({ role: 'Model A · Gemini 4 planner', provider: 'mock', model: 'mock-plan-fixture', latencyMs: 0 })
      }
    }

    let corrections = []
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const prompt = mode === 'pipeline' ? compileGenerationPrompt(run.plan, stage, corrections) : BASELINE_PROMPT[stage]
      run.step = attempt ? 'retry-generate' : 'generate'; await save()
      const gen = await provider.generate({ model: cfg.image, prompt, refs: refsFor(stage, inputs), aspectRatio: aspectFor(stage, inputs) })
      record(gen.call)
      const file = await saveImage(`attempt${attempt + 1}`, gen.image)
      const a = { attempt: attempt + 1, prompt, imageFile: file, qa: null }
      run.attempts.push(a)

      run.step = attempt ? 'retry-qa' : 'qa'; await save()
      if (live) {
        const { qa, call } = await inspect({ model: qaModel, stage, ...inputs, generated: gen.image, plan: run.plan }); a.qa = qa; record(call)
      } else {
        a.qa = { verdict: 'review', identity: { verdict: 'review', issues: [] }, garment: { verdict: 'review', issues: [] }, scene_integration: null, fixable: false, correction_instructions: [], human_review_points: ['MOCK RUN — no model inspected this image'] }
        record({ role: 'Model B · Gemini 4 visual QA', provider: 'mock', model: 'mock-qa-fixture', latencyMs: 0 })
      }
      // Baseline never retries: it is the single-call control.
      if (mode === 'baseline' || a.qa.verdict === 'pass' || !a.qa.fixable || !a.qa.correction_instructions.length) break
      corrections = a.qa.correction_instructions
    }
    const last = run.attempts.at(-1)
    run.final = { imageFile: last.imageFile, verdict: last.qa.verdict, attempts: run.attempts.length }
    run.status = 'done'; run.step = 'done'
  } catch (e) {
    run.status = 'error'
    run.error = { message: e.message, provider: e.provider, model: e.model, status: e.status, latencyMs: e.latencyMs, requestId: e.requestId, step: run.step }
    if (e.model) record({ role: `FAILED at ${run.step}`, provider: e.provider, model: e.model, latencyMs: e.latencyMs, requestId: e.requestId, error: e.message })
  }
  run.finishedAt = new Date().toISOString()
  await save()
  return run
}

const MOCK_PLAN = {
  person: { identity_features_to_preserve: ['(mock) face', 'hair', 'skin tone', 'build'], pose: 'standing front-facing', framing: 'full body', current_outfit: '', uncertain: [] },
  garment: { category: 'top', body_region: 'upper body', colors: ['white'], pattern: 'solid', neckline: 'square', sleeves: 'short', length: 'hip', fit_silhouette: 'fitted', closures: 'none', logos_or_text: 'inner label only', details_to_preserve: ['square neckline'], uncertain: ['back view'] },
  outfit_conflicts: [], avoid: [],
  scene: { camera_height: 'low', perspective: 'wide-angle', horizon_y_frac: 0.7, ground_surface: 'cobblestone', light_direction: 'sun from left', color_temperature: 'warm', shadow_character: 'hard', placement: { x_frac: 0.5, feet_y_frac: 0.92, person_height_frac: 0.6, rationale: 'mock' }, uncertain: [] },
}
