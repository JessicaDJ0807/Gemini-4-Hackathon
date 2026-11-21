// Preview cache index: fingerprint → generated avatar-cache entry. The fingerprint excludes the destination background
// (see shared/tryon/contract.js lookIdentity) and includes the provider/model version that produced the asset.
import fs from 'node:fs/promises'
import path from 'node:path'

export function createPreviewCache(dir = path.resolve('spike-results/preview-cache')) {
  const file = path.join(dir, 'index.json')
  let mem = null
  const load = async () => { if (mem) return mem; try { mem = JSON.parse(await fs.readFile(file, 'utf8')) } catch { mem = {} } return mem }
  return {
    async get(fingerprint) { return (await load())[fingerprint] ?? null },
    async put(fingerprint, entry) {
      const m = await load(); m[fingerprint] = { ...entry, fingerprint, cachedAt: new Date().toISOString() }
      await fs.mkdir(dir, { recursive: true }); await fs.writeFile(file, JSON.stringify(m, null, 2))
      return m[fingerprint]
    },
    async all() { return Object.values(await load()) },
  }
}
