// Model role configuration. Element 119 requires two DIFFERENT Gemini 4 models with distinct jobs.
export function modelConfig() {
  return {
    planner: process.env.GEMINI4_PLANNER_MODEL || '',   // Model A: image understanding + edit plan
    qa: process.env.GEMINI4_QA_MODEL || '',             // Model B: independent visual QA
    image: process.env.IMAGE_MODEL || 'gemini-nano-banana-2.1', // image generator (NOT a Gemini 4 model)
    imageProvider: process.env.IMAGE_PROVIDER || 'gemini',      // gemini | mock
  }
}

export function validateModelConfig(cfg = modelConfig()) {
  const errors = []
  for (const role of ['planner', 'qa']) {
    if (!cfg[role]) errors.push(`GEMINI4_${role.toUpperCase()}_MODEL is not set`)
    else if (!/^gemini-4-/.test(cfg[role])) errors.push(`${role} model "${cfg[role]}" is not a Gemini 4 model ID`)
  }
  if (cfg.planner && cfg.planner === cfg.qa) errors.push('planner and QA must be two different Gemini 4 models')
  return errors
}

/** Human-readable label that never upgrades a model's generation. */
export function generationLabel(modelId) {
  if (/^gemini-4-/.test(modelId)) return 'Gemini 4'
  if (/nano-banana-2\.1/.test(modelId)) return 'Nano Banana 2.1 (Gemini 3.1 Flash Image lineage)'
  if (/^gemini-3/.test(modelId)) return 'Gemini 3.x'
  if (modelId.startsWith('mock')) return 'local mock (no model)'
  return 'unverified'
}
