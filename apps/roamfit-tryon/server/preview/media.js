// Media authorisation for the try-on preview service. Shared contracts carry REFERENCES; only this module turns an
// authorised reference into bytes for a model call. Unknown hosts and paths are refused, never fetched.
import fs from 'node:fs/promises'
import path from 'node:path'
import { intake } from '../tryon/assetIntake.js'
import { UPLOADS } from '../avatar3d/sources.js'

import { assetPath } from '../assetPaths.js'
const PUBLIC = path.resolve('public')
// Same whitelist as server/avatar3d/routes.js /media route (garment crops only; the person photo is never served).
const MEDIA = { 'garment_white_squareneck_tee.png': 'derived', 'garment_gingham_flare_trousers.png': 'derived', 'garment_black_cropped_cardigan.png': 'derived' }
const LOCAL_PREFIXES = [
  { prefix: '/media/', resolve: f => (MEDIA[f] ? assetPath(`${MEDIA[f]}/${f}`) : null) },
  { prefix: '/fixtures/team-wardrobe/', resolve: f => (/^wd-\d{2}\.jpg$/.test(f) ? path.join(PUBLIC, 'fixtures/team-wardrobe', f) : null) },
  { prefix: '/backgrounds/', resolve: f => (/^[a-z0-9-]+\.jpg$/.test(f) ? path.join(PUBLIC, 'backgrounds', f) : null) },
]
export const DEMO_PERSON_ID = 'demo-person-v1'
const MAX_REMOTE_BYTES = 10 * 1024 * 1024

export const allowedHosts = () => (process.env.TRYON_MEDIA_ALLOWED_HOSTS ?? 'cdn.shopify.com').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

/** Classify a media reference without reading it. */
export function classifyReference(url) {
  if (typeof url !== 'string' || !url) return { ok: false, code: 'GARMENT_IMAGE_MISSING', reason: 'no image reference' }
  if (url.startsWith('/') && !url.startsWith('//')) {
    const clean = url.split(/[?#]/)[0]
    const rule = LOCAL_PREFIXES.find(r => clean.startsWith(r.prefix))
    const file = rule && rule.resolve(decodeURIComponent(clean.slice(rule.prefix.length)))
    return file ? { ok: true, kind: 'local', file } : { ok: false, code: 'MEDIA_FORBIDDEN', reason: `path ${clean} is not an authorised media location` }
  }
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return { ok: false, code: 'MEDIA_FORBIDDEN', reason: 'remote media must use https' }
    if (!allowedHosts().includes(u.hostname.toLowerCase())) return { ok: false, code: 'MEDIA_FORBIDDEN', reason: `host ${u.hostname} is not in TRYON_MEDIA_ALLOWED_HOSTS` }
    return { ok: true, kind: 'remote', url: u.toString() }
  } catch { return { ok: false, code: 'GARMENT_IMAGE_INVALID', reason: 'not a valid URL' } }
}

/** Submit-time check: authorised + (for local files) readable. Remote files are only fetched by live generation. */
export async function checkGarmentReferences(garments) {
  const problems = []
  for (const g of garments) {
    const c = classifyReference(g.imageUrl)
    if (!c.ok) { problems.push({ code: c.code, path: `garment ${g.id}`, message: `${g.name || g.id}: ${c.reason}` }); continue }
    if (c.kind === 'local') { try { await fs.access(c.file) } catch { problems.push({ code: 'MEDIA_UNREADABLE', path: `garment ${g.id}`, message: `${g.name || g.id}: image file is not readable` }) } }
  }
  return problems
}

export function personFile(personMediaId) {
  if (personMediaId === DEMO_PERSON_ID) return assetPath('derived/person_front.png')
  if (typeof personMediaId === 'string' && /^person-[a-f0-9]{12}\.(png|jpg|webp)$/.test(personMediaId)) return path.join(UPLOADS, personMediaId)
  return null
}

export async function checkPerson(avatar) {
  const needs = avatar.mode === 'realistic' || (avatar.creationMethod ?? (avatar.personMediaId ? 'photo' : 'text')) === 'photo'
  if (!needs) return []
  const f = personFile(avatar.personMediaId)
  if (!f) return [{ code: 'MEDIA_FORBIDDEN', path: '$.avatar.personMediaId', message: 'personMediaId must be an id returned by the Roamfit upload endpoint' }]
  try { await fs.access(f); return [] } catch { return [{ code: 'MEDIA_UNREADABLE', path: '$.avatar.personMediaId', message: 'The person photo is no longer available; upload it again' }] }
}

/** Live generation only: read + sniff an authorised garment image into a model part. */
export async function loadGarmentPart(g) {
  const c = classifyReference(g.imageUrl)
  if (!c.ok) throw Object.assign(new Error(`${g.name}: ${c.reason}`), { code: c.code })
  let buf
  if (c.kind === 'local') buf = await fs.readFile(c.file)
  else {
    const r = await fetch(c.url, { redirect: 'error', signal: AbortSignal.timeout(20_000) })
    if (!r.ok) throw Object.assign(new Error(`${g.name}: image fetch failed (HTTP ${r.status})`), { code: 'MEDIA_UNREADABLE' })
    if (Number(r.headers.get('content-length') || 0) > MAX_REMOTE_BYTES) throw Object.assign(new Error(`${g.name}: image larger than 10 MB`), { code: 'PAYLOAD_TOO_LARGE' })
    buf = Buffer.from(await r.arrayBuffer())
    if (buf.length > MAX_REMOTE_BYTES) throw Object.assign(new Error(`${g.name}: image larger than 10 MB`), { code: 'PAYLOAD_TOO_LARGE' })
  }
  const chk = intake('garment', buf, g.name)
  if (!chk.ok) throw Object.assign(new Error(chk.errors.join('; ')), { code: 'UNSUPPORTED_MEDIA' })
  return { type: 'image', mime: chk.image.mime, data: chk.image.data }
}
