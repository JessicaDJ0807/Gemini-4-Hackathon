// Avatar asset cache: one folder per (profile, mode, outfit). Holds the 2D source (concept / try-on still), any GLBs
// per provider, and meta.json with real provenance. Destination changes never touch this cache.
import fs from 'node:fs/promises'
import path from 'node:path'

export const CACHE_DIR = path.resolve('spike-results/avatar-cache')
export const keyOf = ({ profile = 'demo', mode, outfitId }) => `${profile}__${mode}__${outfitId}`.replace(/[^a-zA-Z0-9_.-]/g, '-')

export async function readEntry(key) {
  try { return JSON.parse(await fs.readFile(path.join(CACHE_DIR, key, 'meta.json'), 'utf8')) } catch { return null }
}
export async function writeEntry(key, meta) {
  await fs.mkdir(path.join(CACHE_DIR, key), { recursive: true })
  await fs.writeFile(path.join(CACHE_DIR, key, 'meta.json'), JSON.stringify(meta, null, 2))
  return meta
}
export async function listEntries() {
  await fs.mkdir(CACHE_DIR, { recursive: true })
  const dirs = await fs.readdir(CACHE_DIR)
  return (await Promise.all(dirs.map(readEntry))).filter(Boolean)
}
export const fileUrl = (key, file) => `/generated/${encodeURIComponent(key)}/${encodeURIComponent(file)}`
