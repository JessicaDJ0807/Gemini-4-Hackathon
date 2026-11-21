export type OutfitId = 'coastal-linen' | 'city-night'
export type DestinationId = 'amalfi' | 'tokyo'

export interface Outfit {
  id: OutfitId
  name: string
  note: string
  colors: { top: string; bottom: string; accent: string }
  asset: { kind: 'authored-3d'; glbUrl?: string; compatibleAvatar: 'preset-v1' }
}

export interface ProductRecommendation {
  id: string
  title: string
  handle: string
  imageUrl?: string
  price: string
  currency: string
  reason: string
  productUrl?: string
}

export interface TryOnRequest {
  personImage: string
  outfitId: OutfitId
  destinationId: DestinationId
  productIds?: string[]
}

export interface TryOnResult {
  imageUrl: string
  mode: 'live' | 'demo'
  plan: { stylingIntent: string; preserve: string[]; avoid: string[] }
  qa: { pass: boolean; identity: number; garment: number; background: number; notes: string[] }
  trace: { role: string; model: string; latencyMs: number }[]
}
