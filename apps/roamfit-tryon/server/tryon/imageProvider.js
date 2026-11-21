// ImageTryOnProvider adapters. Each returns { image:{mime,data}, call } and labels its real provider/model.
import { interact, outputImage, outputText, ProviderError } from './geminiClient.js'

const REF_LABEL = { person: 'PERSON reference (keep identity)', garment: 'GARMENT reference (copy this exact garment)', scene: 'SCENE reference (destination background)' }

export const geminiImageProvider = {
  id: 'gemini',
  async generate({ model, prompt, refs, aspectRatio }) {
    const parts = [{ type: 'text', text: prompt }]
    for (const [role, img] of refs) {
      parts.push({ type: 'text', text: REF_LABEL[role] + ':' })
      parts.push({ type: 'image', mime: img.mime, data: img.data })
    }
    const r = await interact({ model, parts, responseFormat: { type: 'image', ...(aspectRatio && { aspect_ratio: aspectRatio }), image_size: '2K' } })
    const image = outputImage(r.json)
    if (!image) throw new ProviderError(`image model returned no image${outputText(r.json) ? `: ${outputText(r.json).slice(0, 200)}` : ''}`, { provider: 'gemini', model, latencyMs: r.latencyMs, requestId: r.requestId })
    return { image, call: { role: 'Image generator', provider: 'gemini', model, servedModel: r.servedModel, latencyMs: r.latencyMs, requestId: r.requestId, usage: r.usage } }
  },
}

// Mock: returns the person photo untouched so the pipeline/UI can be exercised offline. Always labelled mock.
export const mockImageProvider = {
  id: 'mock',
  async generate({ refs }) {
    const person = refs.find(([r]) => r === 'person')[1]
    return { image: { mime: person.mime, data: person.data }, call: { role: 'Image generator', provider: 'mock', model: 'mock-echo-person', latencyMs: 0, note: 'NOT a generated image' } }
  },
}

export function getImageProvider(id) {
  return { gemini: geminiImageProvider, mock: mockImageProvider }[id] || (() => { throw new Error(`unknown IMAGE_PROVIDER ${id}`) })()
}
