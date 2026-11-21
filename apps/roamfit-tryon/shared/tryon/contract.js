// Roamfit try-on preview contract (v1). Plain ESM so the browser (via Vite) and the Node server share ONE implementation.
// Types live in contract.d.ts. Nothing here calls a model, fetches media or reads secrets.

export const CONTRACT_VERSION = 'tryon-preview.v1'
export const GARMENT_CATEGORIES = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory']
export const GARMENT_SOURCES = ['wardrobe', 'shopify', 'upload']

// Conflict rules (see docs/INTEGRATION.md#conflict-policy). One per slot except layered tops and accessories.
export const CATEGORY_LIMITS = { top: 1, bottom: 1, dress: 1, outerwear: 1, shoes: 1, accessory: 3 }
export const LAYERED_TOP_LIMIT = 2

// `generating-views` is a documented Roamfit addition: the 4-view turnaround is made of still images, not a video.
export const PREVIEW_JOB_STATES = ['queued', 'generating-image', 'awaiting-approval', 'generating-views', 'generating-video', 'extracting-frames', 'validating', 'ready', 'failed']
export const TERMINAL_JOB_STATES = ['ready', 'failed']

// Bumped whenever generation parameters change in a way that should invalidate old previews.
export const GENERATION_PARAMS_VERSION = 'neutral-bg.a-pose.4view.v1'

const isText = v => typeof v === 'string' && v.trim().length > 0

/** Media references must be references, never inline bytes. Same-origin paths or http(s) URLs only. */
export function isMediaReference(url) {
  if (!isText(url)) return false
  if (/^data:/i.test(url) || /^blob:/i.test(url)) return false
  if (url.startsWith('/') && !url.startsWith('//')) return true
  try { const u = new URL(url); return u.protocol === 'https:' || u.protocol === 'http:' } catch { return false }
}

// Secret detection: a request must never carry a raw provider key or bearer token.
const SECRET_KEY_NAMES = /^(api[-_]?key|apikey|x-goog-api-key|authorization|access[-_]?token|secret|client[-_]?secret|storefront[-_]?token|fal[-_]?key|password)$/i
const SECRET_VALUE_PATTERNS = [/AIza[0-9A-Za-z_-]{30,}/, /\bshp(at|ss|ca|pa)_[0-9a-f]{16,}/i, /\bsk-[A-Za-z0-9_-]{20,}/, /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/]

/** Returns JSON paths that look like secrets. */
export function findSecrets(value, path = '$', out = []) {
  if (typeof value === 'string') { if (SECRET_VALUE_PATTERNS.some(p => p.test(value))) out.push(path) }
  else if (Array.isArray(value)) value.forEach((v, i) => findSecrets(v, `${path}[${i}]`, out))
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY_NAMES.test(k) && ((typeof v === 'string' && v !== '') || typeof v === 'number')) out.push(`${path}.${k}`)
    findSecrets(v, `${path}.${k}`, out)
  }
  return out
}

/**
 * Category-level composition check for a set of garments.
 * Policy: a dress excludes top and bottom; one bottom/dress/outerwear/shoes; one top, or two when layering is intentional; up to 3 accessories.
 * Returns human-readable conflict strings (empty = valid).
 */
export function compositionConflicts(garments, { allowTopLayering = false } = {}) {
  const count = {}
  for (const g of garments) count[g.category] = (count[g.category] || 0) + 1
  const out = []
  if (count.dress && (count.top || count.bottom)) out.push('A dress cannot be combined with a separate top or bottom')
  for (const [cat, limit] of Object.entries(CATEGORY_LIMITS)) {
    const max = cat === 'top' && allowTopLayering ? LAYERED_TOP_LIMIT : limit
    if ((count[cat] || 0) > max) out.push(`Too many ${cat} items: ${count[cat]} selected, at most ${max}`)
  }
  return out
}

/**
 * Validate a TryOnPreviewRequestV1. Pure and synchronous: checks shape, references and policy.
 * Server-side reachability/authorisation of media is checked separately (server/preview/media.js).
 * @returns {{ ok: boolean, errors: { code: string, path: string, message: string }[] }}
 */
export function validatePreviewRequest(req) {
  const errors = []
  const err = (code, path, message) => errors.push({ code, path, message })
  if (!req || typeof req !== 'object') return { ok: false, errors: [{ code: 'INVALID_REQUEST', path: '$', message: 'Request body must be an object' }] }

  if (!isText(req.requestId) || req.requestId.length > 128) err('INVALID_REQUEST', '$.requestId', 'requestId must be a non-empty string (max 128 chars)')
  if (!Number.isSafeInteger(req.inputRevision) || req.inputRevision < 0) err('INVALID_REQUEST', '$.inputRevision', 'inputRevision must be a non-negative integer')
  if (req.contractVersion !== undefined && req.contractVersion !== CONTRACT_VERSION) err('UNSUPPORTED_VERSION', '$.contractVersion', `Only ${CONTRACT_VERSION} is supported`)

  const a = req.avatar
  if (!a || !['stylized', 'realistic'].includes(a.mode)) err('INVALID_REQUEST', '$.avatar.mode', 'avatar.mode must be "stylized" or "realistic"')
  else if (a.mode === 'realistic') {
    if (!isText(a.personMediaId)) err('PERSON_PHOTO_REQUIRED', '$.avatar.personMediaId', 'Real Me needs an authorised full-body person photo (personMediaId)')
  } else {
    const method = a.creationMethod ?? (a.personMediaId ? 'photo' : 'text')
    if (!['text', 'photo'].includes(method)) err('INVALID_REQUEST', '$.avatar.creationMethod', 'creationMethod must be "text" or "photo"')
    else if (method === 'text' && !(isText(a.description) && a.description.trim().length >= 3)) err('AVATAR_INPUT_REQUIRED', '$.avatar.description', 'My Little Self from text needs a description (at least 3 characters)')
    else if (method === 'photo' && !isText(a.personMediaId)) err('AVATAR_INPUT_REQUIRED', '$.avatar.personMediaId', 'My Little Self from a photo needs personMediaId')
  }
  if (a && a.description !== undefined && typeof a.description === 'string' && a.description.length > 500) err('INVALID_REQUEST', '$.avatar.description', 'description is limited to 500 characters')

  const ids = req.selectedLook?.garmentIds
  const garments = Array.isArray(req.garments) ? req.garments : null
  if (!Array.isArray(ids) || ids.length === 0) err('EMPTY_LOOK', '$.selectedLook.garmentIds', 'Select at least one garment')
  else if (new Set(ids).size !== ids.length) err('DUPLICATE_GARMENT', '$.selectedLook.garmentIds', 'garmentIds must be unique')
  if (!garments) err('INVALID_REQUEST', '$.garments', 'garments must be an array')

  if (garments && Array.isArray(ids)) {
    const byId = new Map()
    garments.forEach((g, i) => {
      const p = `$.garments[${i}]`
      if (!g || !isText(g.id)) { err('INVALID_REQUEST', `${p}.id`, 'garment id is required'); return }
      if (byId.has(g.id)) err('DUPLICATE_GARMENT', `${p}.id`, `garment ${g.id} appears twice`)
      byId.set(g.id, g)
      if (!GARMENT_CATEGORIES.includes(g.category)) err('INVALID_REQUEST', `${p}.category`, `garment ${g.id} has an unsupported category`)
      if (!GARMENT_SOURCES.includes(g.source)) err('INVALID_REQUEST', `${p}.source`, `garment ${g.id} has an unsupported source`)
      if (!isText(g.imageUrl)) err('GARMENT_IMAGE_MISSING', `${p}.imageUrl`, `${g.name || g.id} has no image, so it cannot be previewed`)
      else if (!isMediaReference(g.imageUrl)) err('GARMENT_IMAGE_INVALID', `${p}.imageUrl`, `${g.name || g.id} must use a media URL, not inline data`)
      else if (/\.svg(\?|#|$)/i.test(g.imageUrl)) err('GARMENT_IMAGE_UNSUPPORTED', `${p}.imageUrl`, `${g.name || g.id} is an SVG illustration; the image model needs a JPEG, PNG or WebP photo`)
      if (g.imageStatus && g.imageStatus !== 'ok') err(g.imageStatus === 'missing' ? 'GARMENT_IMAGE_MISSING' : 'GARMENT_IMAGE_UNSUPPORTED', `${p}.imageStatus`, `${g.name || g.id}: image ${g.imageStatus}`)
      if (g.source === 'shopify') {
        if (!isText(g.productId)) err('SHOPIFY_REFERENCE_MISSING', `${p}.productId`, `${g.name || g.id} is a Shopify item without its product ID`)
        if (!isText(g.variantId)) err('SHOPIFY_VARIANT_REQUIRED', `${p}.variantId`, `${g.name || g.id}: choose a concrete product variant first`)
      }
    })
    ids.forEach((id, i) => { if (!byId.has(id)) err('UNKNOWN_GARMENT', `$.selectedLook.garmentIds[${i}]`, `Selected garment ${id} is not in garments[]`) })
    for (const id of byId.keys()) if (!ids.includes(id)) err('UNSELECTED_GARMENT', '$.garments', `garments[] contains ${id}, which is not selected`)
    for (const c of compositionConflicts(garments, { allowTopLayering: !!req.selectedLook?.allowTopLayering })) err('LOOK_CONFLICT', '$.selectedLook', c)
  }

  const b = req.background
  if (!b || !isText(b.id) || !isText(b.destinationId)) err('INVALID_REQUEST', '$.background', 'background.id and background.destinationId are required')
  else if (!isMediaReference(b.imageUrl)) err('INVALID_REQUEST', '$.background.imageUrl', 'background.imageUrl must be a media URL')

  if (!['photo', 'turnaround'].includes(req.previewMode)) err('INVALID_REQUEST', '$.previewMode', 'previewMode must be "photo" or "turnaround"')

  for (const p of findSecrets(req)) err('SECRET_IN_REQUEST', p, 'Requests must not contain API keys or tokens; credentials stay on the server')
  for (const [p, v] of walkStrings(req)) if (/^data:[^,]*;base64,/i.test(v)) err('INLINE_MEDIA', p, 'Use media references, not inline base64, in the shared contract')

  return { ok: errors.length === 0, errors }
}

function* walkStrings(v, path = '$') {
  if (typeof v === 'string') yield [path, v]
  else if (Array.isArray(v)) for (let i = 0; i < v.length; i++) yield* walkStrings(v[i], `${path}[${i}]`)
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) yield* walkStrings(x, `${path}.${k}`)
}

// ---------- cache identity ----------

/** cyrb53: small, stable, synchronous string hash (not cryptographic; cache keys only). */
export function hash53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677) }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

const normDescription = d => (typeof d === 'string' ? d.trim().replace(/\s+/g, ' ').toLowerCase() : '')

/**
 * The generation-relevant identity of a request. The BACKGROUND IS DELIBERATELY EXCLUDED: characters are generated on a
 * neutral backdrop and the destination photo is applied only at composition time, so changing it is free and instant.
 */
export function lookIdentity(req) {
  const a = req.avatar || {}
  const method = a.mode === 'realistic' ? 'photo' : (a.creationMethod ?? (a.personMediaId ? 'photo' : 'text'))
  const byId = new Map((req.garments || []).map(g => [g.id, g]))
  const garments = [...(req.selectedLook?.garmentIds || [])].sort().map(id => {
    const g = byId.get(id) || {}
    return [id, g.variantId || null]
  })
  return {
    avatar: {
      mode: a.mode || null,
      method,
      // Person photos are content-addressed upload IDs, so the ID is also the image version.
      personMediaId: method === 'photo' ? a.personMediaId || null : null,
      approvedCharacterMediaId: a.approvedCharacterMediaId || null,
      // Real Me generation does not use free-text notes (server/avatar3d/sources.js), so they must not split the cache.
      description: a.mode === 'realistic' ? '' : normDescription(a.description),
    },
    garments,
    allowTopLayering: !!req.selectedLook?.allowTopLayering,
    previewMode: req.previewMode || null,
    params: GENERATION_PARAMS_VERSION,
  }
}

/** Client-side key: identifies "this look on this avatar". Provider-independent. */
export function previewLookKey(req) { return `lk_${hash53(JSON.stringify(lookIdentity(req)))}` }

/** Server-side cache key: lookKey + the provider/model version that actually produced the asset. */
export function previewFingerprint(req, providerVersion) { return `fp_${hash53(JSON.stringify({ look: lookIdentity(req), providerVersion: String(providerVersion) }))}` }
