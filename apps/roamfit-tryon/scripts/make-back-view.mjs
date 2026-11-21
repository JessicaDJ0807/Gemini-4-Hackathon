// CLI: node --env-file=.env scripts/make-back-view.mjs --key=demo__little-self__stroll
import { makeBackView } from '../server/avatar3d/backView.js'
const key = (process.argv.find(a => a.startsWith('--key=')) || '--key=demo__little-self__stroll').slice(6)
console.log(JSON.stringify(await makeBackView(key), null, 2))
