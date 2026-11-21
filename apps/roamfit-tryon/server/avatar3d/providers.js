// Image-to-3D provider adapters (fal.ai queue API). Each returns a textured GLB.
// Unseen sides of any result are model-inferred. Requires FAL_KEY; never called from the browser.
import fs from 'node:fs/promises'

export const PROVIDERS = {
  'tripo-h3.1': {
    label: 'Tripo H3.1 (fal.ai)', endpoint: 'tripo3d/h3.1/image-to-3d', supports: ['front'],
    body: img => ({ image_url: img, texture: true, pbr: true, texture_quality: 'detailed', geometry_quality: 'detailed', orientation: 'align_image' }),
    glbUrl: r => r.model_urls?.glb?.url || r.model_mesh?.url,
  },
  'hunyuan-3.1-pro': {
    label: 'Hunyuan3D 3.1 Pro (fal.ai)', endpoint: 'fal-ai/hunyuan-3d/v3.1/pro/image-to-3d', supports: ['front', 'back', 'left', 'right'],
    body: (img, views = {}) => ({ input_image_url: img, generate_type: 'Normal', enable_pbr: true, face_count: 300000,
      ...(views.back && { back_image_url: views.back }), ...(views.left && { left_image_url: views.left }), ...(views.right && { right_image_url: views.right }) }),
    glbUrl: r => r.model_glb?.url || r.model_urls?.glb?.url,
  },
  'trellis-2': {
    label: 'TRELLIS.2 (fal.ai)', endpoint: 'fal-ai/trellis-2', supports: ['front'],
    body: img => ({ image_url: img, resolution: '1024', texture_size: '2048', decimation_target: 120000 }),
    glbUrl: r => r.model_glb?.url,
  },
}

export const hasFalKey = () => Boolean(process.env.FAL_KEY)

const dataUri = async file => { const b = await fs.readFile(file); return `data:${b[0] === 0xff ? 'image/jpeg' : 'image/png'};base64,${b.toString('base64')}` }

/** Runs one image-to-3D job. onStatus(string) is called while polling. Returns { glb: Buffer, meta }. */
export async function imageTo3D({ providerId, imageFile, viewFiles = {}, onStatus = () => {} }) {
  const p = PROVIDERS[providerId]
  if (!p) throw new Error(`unknown 3D provider ${providerId}`)
  if (!hasFalKey()) throw Object.assign(new Error('FAL_KEY not configured — 3D generation unavailable'), { code: 'NO_KEY' })
  const headers = {
    Authorization: `Key ${process.env.FAL_KEY}`, 'Content-Type': 'application/json',
    'X-Fal-Store-IO': '0', 'X-Fal-Object-Lifecycle-Preference': JSON.stringify({ expiration_duration_seconds: 3600 }),
  }
  const views = Object.fromEntries(await Promise.all(Object.entries(viewFiles).map(async ([k, f]) => [k, await dataUri(f)])))
  const t0 = Date.now()
  const sub = await fetch(`https://queue.fal.run/${p.endpoint}`, { method: 'POST', headers, body: JSON.stringify(p.body(await dataUri(imageFile), views)) })
  const s = await sub.json().catch(() => ({}))
  if (!sub.ok) throw new Error(`fal submit ${sub.status}: ${JSON.stringify(s.detail || s).slice(0, 300)}`)
  let st
  for (let i = 0; i < 400; i++) { // ≤ ~20 min
    await new Promise(r => setTimeout(r, 3000))
    st = await (await fetch(s.status_url, { headers })).json()
    onStatus(st.status)
    if (st.status === 'COMPLETED' || st.error) break
  }
  if (st?.status !== 'COMPLETED') throw new Error(`fal job did not complete: ${JSON.stringify(st?.error || st?.status).slice(0, 300)}`)
  const result = await (await fetch(s.response_url, { headers })).json()
  const url = p.glbUrl(result)
  if (!url) throw new Error(`no GLB in result: ${JSON.stringify(result).slice(0, 300)}`)
  const glb = Buffer.from(await (await fetch(url)).arrayBuffer())
  if (glb.toString('ascii', 0, 4) !== 'glTF') throw new Error('downloaded file is not a binary glTF (GLB)')
  return { glb, meta: { provider: 'fal.ai', model: p.endpoint, label: p.label, requestId: s.request_id, latencyMs: Date.now() - t0, inferenceSec: st.metrics?.inference_time ?? null, bytes: glb.length } }
}
