// Asset lookup. Shareable assets (garment cut-outs, style reference) ship in ./assets. Private files (the demo person
// photo) stay OUTSIDE the repo in ROAMFIT_PRIVATE_ASSETS_DIR (default ../assets) and are optional.
import fs from 'node:fs'
import path from 'node:path'

const roots = () => [path.resolve('assets'), path.resolve(process.env.ROAMFIT_PRIVATE_ASSETS_DIR || '../assets')]
export const assetPath = rel => roots().map(r => path.join(r, rel)).find(f => fs.existsSync(f)) ?? path.join(roots()[0], rel)
export const DEMO_PERSON_REL = 'derived/person_front.png'
export const hasDemoPerson = () => roots().some(r => fs.existsSync(path.join(r, DEMO_PERSON_REL)))
