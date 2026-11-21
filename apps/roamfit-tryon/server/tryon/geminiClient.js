// Thin Gemini Interactions API client. Never logs keys or image bytes.
const API = 'https://generativelanguage.googleapis.com/v1beta'
const API_REVISION = '2026-05-20'

export class ProviderError extends Error {
  constructor(message, { status, provider, model, latencyMs, requestId } = {}) {
    super(message)
    Object.assign(this, { status, provider, model, latencyMs, requestId })
  }
}

export function hasGeminiKey() {
  return Boolean(process.env.GEMINI_API_KEY)
}

/** parts: [{type:'text',text}|{type:'image',mime,data(base64)}] */
export async function interact({ model, parts, responseFormat, extra, timeoutMs = 180_000 }) {
  if (!hasGeminiKey()) throw new ProviderError('GEMINI_API_KEY not configured', { provider: 'gemini', model })
  const input = parts.map(p => (p.type === 'image' ? { type: 'image', mime_type: p.mime, data: p.data } : p))
  const body = { model, input }
  if (responseFormat) body.response_format = responseFormat
  if (extra) Object.assign(body, extra)
  const started = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res, json
  try {
    res = await fetch(`${API}/interactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Api-Revision': API_REVISION },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    json = await res.json().catch(() => ({}))
  } catch (e) {
    throw new ProviderError(e.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : e.message, { provider: 'gemini', model, latencyMs: Date.now() - started })
  } finally {
    clearTimeout(timer)
  }
  const latencyMs = Date.now() - started
  const requestId = res.headers.get('x-request-id') || json.id || null
  if (!res.ok) {
    throw new ProviderError(json.error?.message || `HTTP ${res.status}`, { status: res.status, provider: 'gemini', model, latencyMs, requestId })
  }
  return {
    json,
    latencyMs,
    requestId,
    usage: json.usage || json.usage_metadata || null,
    // The model the server says it used, if it reports one — recorded alongside the requested ID.
    servedModel: json.model || json.model_version || null,
  }
}

function blocks(json) {
  return (json.steps || []).flatMap(s => s.content || s.output || [])
}

export function outputText(json) {
  if (typeof json.output_text === 'string') return json.output_text
  return blocks(json).filter(c => c.type === 'text').map(c => c.text).join('\n')
}

export function outputImage(json) {
  const img = json.output_image || blocks(json).find(c => c.type === 'image')
  if (!img) return null
  return { mime: img.mime_type || 'image/png', data: img.data }
}

export function outputVideo(json) {
  const v = json.output_video || blocks(json).find(c => c.type === 'video')
  if (!v) return null
  return { mime: v.mime_type || 'video/mp4', data: v.data, uri: v.uri }
}

export function parseJsonLoose(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(cleaned) } catch {}
  const first = cleaned.indexOf('{'), last = cleaned.lastIndexOf('}')
  if (first >= 0 && last > first) return JSON.parse(cleaned.slice(first, last + 1))
  throw new Error('model did not return JSON')
}
