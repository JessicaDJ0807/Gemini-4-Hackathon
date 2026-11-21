import type { ProductRecommendation, TryOnRequest, TryOnResult } from './types'

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body = await response.json()
  if (!response.ok) throw new Error(body.error || 'Request failed')
  return body
}

export const getProducts = (outfitId: string, destinationId: string) =>
  json<{products: ProductRecommendation[]; mode: 'live'|'demo'}>(`/api/products?outfitId=${outfitId}&destinationId=${destinationId}`)

export const createTryOn = (request: TryOnRequest) =>
  json<TryOnResult>('/api/try-on', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(request) })
