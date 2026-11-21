// Phase 1/2 spike: attributable runs on the derived test assets.
//   node --env-file=.env scripts/run-tryon-spike.mjs                 → mock (no network)
//   node --env-file=.env scripts/run-tryon-spike.mjs --confirm-upload → LIVE: sends the 3 images to Google Gemini API
// Options: --garment=<file in assets/derived>  --only=baseline,garment,scene,integrated
import fs from 'node:fs/promises'
import path from 'node:path'
import { intake } from '../server/tryon/assetIntake.js'
import { runTryOn } from '../server/tryon/orchestrator.js'
import { modelConfig } from '../server/tryon/models.js'

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true] }))
const DERIVED = path.resolve('../assets/derived')
const files = { person: 'person_front.png', garment: args.garment || 'garment_gingham_flare_trousers.png', scene: 'bg_montreal.png' }
const live = Boolean(args['confirm-upload'])
if (!live) process.env.TRYON_MOCK = '1'

const inputs = {}
for (const [role, f] of Object.entries(files)) {
  const r = intake(role, await fs.readFile(path.join(DERIVED, f)), f)
  if (!r.ok) { console.error(r.errors.join('\n')); process.exit(1) }
  r.warnings.forEach(w => console.warn(`  ⚠ ${role}: ${w}`))
  inputs[role] = r.image
}
const cfg = modelConfig()
console.log(live
  ? `LIVE — sending ${Object.values(files).join(', ')} to Google Gemini API.\n  Model A planner=${cfg.planner}  Model B QA=${cfg.qa}  generator=${cfg.image}`
  : 'MOCK — nothing leaves this machine. Re-run with --confirm-upload for live calls.')

const plan = [
  ['baseline', 'integrated'],   // single generator call, no planner, no retry (control)
  ['pipeline', 'garment'],      // isolate garment swap
  ['pipeline', 'scene'],        // isolate scene composite
  ['pipeline', 'integrated'],   // full three-image run
].filter(([m, s]) => !args.only || args.only.split(',').includes(m === 'baseline' ? 'baseline' : s))

const summary = []
for (const [mode, stage] of plan) {
  process.stdout.write(`\n▶ ${mode}/${stage} … `)
  const run = await runTryOn({ mode, stage, inputs, inputNames: files, onUpdate: r => process.stdout.write(`${r.step} `) })
  const row = { runId: run.runId, mode, stage, status: run.status, verdict: run.final?.verdict, attempts: run.attempts.length, error: run.error?.message,
    calls: run.trace.map(t => `${t.role} → ${t.provider}:${t.model} ${t.latencyMs ?? '?'}ms`) }
  summary.push(row)
  console.log(`\n  ${run.status} · verdict=${row.verdict ?? '-'} · attempts=${row.attempts}${row.error ? ' · ERROR ' + row.error : ''}\n  ${row.calls.join('\n  ')}`)
}
await fs.writeFile(path.resolve('spike-results/runs/summary.json'), JSON.stringify({ live, files, at: new Date().toISOString(), summary }, null, 2))
console.log('\nRun folders: spike-results/runs/<runId>/ (run.json + attempt images). Summary: spike-results/runs/summary.json')
