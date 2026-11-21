// Types for shared/tryon/contract.js. These are the Roamfit-owned, versioned try-on contracts (tryon-preview.v1).

export type GarmentCategory = 'top' | 'bottom' | 'dress' | 'outerwear' | 'shoes' | 'accessory'
export type GarmentSource = 'wardrobe' | 'shopify' | 'upload'
export type Money = { amount: string; currencyCode: string }

export type TryOnGarment = {
  id: string                    // stable: team WardrobeItem.id, or `shopify:<variantGid>`, or `upload:<mediaId>`
  category: GarmentCategory
  name: string
  imageUrl: string              // media reference; '' only when the source record had no image (see imageStatus)
  source: GarmentSource
  productId?: string
  variantId?: string
  productUrl?: string
  selectedSize?: string
  color?: string
  avatarAssetId?: string
  // Roamfit additions (all optional)
  imageStatus?: 'ok' | 'missing' | 'unsupported-format'
  merchant?: string
  price?: Money
  styleTags?: string[]
  origin?: { kind: 'team-wardrobe' | 'roamfit-fixture' | 'shopify' | 'upload'; ref?: string }
}

export type SelectedLook = {
  garmentIds: string[]
  sourceOutfitId?: string
  /** Roamfit addition: two tops are allowed only when layering is intentional (e.g. loaded from a recommended look). */
  allowTopLayering?: boolean
}

export type AvatarMode = 'stylized' | 'realistic'

export type TryOnPreviewRequestV1 = {
  contractVersion?: 'tryon-preview.v1'
  requestId: string
  inputRevision: number
  avatar: {
    mode: AvatarMode
    creationMethod?: 'text' | 'photo'
    description?: string
    personMediaId?: string
    approvedCharacterMediaId?: string
  }
  selectedLook: SelectedLook
  garments: TryOnGarment[]
  background: { id: string; destinationId: string; imageUrl: string }
  previewMode: 'photo' | 'turnaround'
  /** Roamfit addition: explicit user consent for live provider calls. Never a credential. */
  authorization?: { sendToGemini?: boolean; costAcknowledged?: boolean }
}

export type PreviewJobState =
  | 'queued' | 'generating-image' | 'awaiting-approval' | 'generating-views' | 'generating-video'
  | 'extracting-frames' | 'validating' | 'ready' | 'failed'

export type PreviewProvenance = 'generated-live' | 'cache' | 'approved-asset' | 'fixture'

export type TryOnPreviewJobV1 = {
  jobId: string
  requestId: string
  inputRevision: number
  status: PreviewJobState
  previewImageUrl?: string
  turnaroundManifestUrl?: string
  error?: { code: string; message: string; retryable: boolean }
  // Roamfit additions
  lookKey?: string
  fingerprint?: string
  provider?: string
  provenance?: PreviewProvenance
  provenanceNote?: string
  step?: string
  createdAt?: string
  updatedAt?: string
}

export type TurnaroundManifestV1 = {
  manifestVersion: 'turnaround.v1'
  fingerprint: string
  method: 'video' | 'views' | 'still'
  frames: string[]
  frameCount: number
  /** Only verified viewpoints are listed. `origin` = 'generated' or a disclosure such as 'mirrored from left profile'. */
  views?: { label: string; angle: number; origin: string }[]
  coverageDegrees: number | null
  verifiedFullRotation: boolean
  neutralBackground: boolean
  previewImageUrl?: string
  provenance: PreviewProvenance
  provenanceNote: string
  generatedAt?: string
  limitations: string[]
}

export declare const CONTRACT_VERSION: 'tryon-preview.v1'
export declare const GARMENT_CATEGORIES: GarmentCategory[]
export declare const GARMENT_SOURCES: GarmentSource[]
export declare const CATEGORY_LIMITS: Record<GarmentCategory, number>
export declare const LAYERED_TOP_LIMIT: number
export declare const PREVIEW_JOB_STATES: PreviewJobState[]
export declare const TERMINAL_JOB_STATES: PreviewJobState[]
export declare const GENERATION_PARAMS_VERSION: string

export type ValidationError = { code: string; path: string; message: string }
export declare function isMediaReference(url: unknown): boolean
export declare function findSecrets(value: unknown, path?: string, out?: string[]): string[]
export declare function compositionConflicts(garments: Pick<TryOnGarment, 'category'>[], opts?: { allowTopLayering?: boolean }): string[]
export declare function validatePreviewRequest(req: unknown): { ok: boolean; errors: ValidationError[] }
export declare function hash53(str: string, seed?: number): string
export declare function lookIdentity(req: TryOnPreviewRequestV1): unknown
export declare function previewLookKey(req: TryOnPreviewRequestV1): string
export declare function previewFingerprint(req: TryOnPreviewRequestV1, providerVersion: string): string
