// Mirror of the TEAM's contracts, read 2026-11-21 from JessicaDJ0807/Gemini-4-Hackathon:
//   main@260f716 services/ai/src/outfit_planning/models.py (implemented AI service)
//   main docs/integrations/ai-app-api.md (A/B agreement), packages/contracts/README.md (conceptual)
//   product-integrations@095a465 packages/contracts/outfit-plans.mjs (B's validator)
// Roamfit only READS these. Fields marked "extension" are the AI service's optional additions; never required here.

export type TeamCategory = 'top' | 'bottom' | 'dress' | 'outerwear' | 'shoes' | 'accessory'

export type TeamWardrobeItem = {
  id: string
  name: string
  /** Required by the A/B agreement and B's validator; optional in the AI service. */
  imageUrl?: string | null
  category: TeamCategory
  color?: string | null
  styleTags?: string[]
  /** packages/contracts/README.md: optional mapping to a prepared avatar/3D asset. */
  avatarAssetId?: string
}

export type TeamMissingItem = {
  id: string
  description: string
  searchQuery: string
  priority: 'essential' | 'optional'
  reason: string
  // extensions
  category?: TeamCategory | null
  color?: string | null
  silhouette?: string | null
  material?: string | null
  styleDescriptors?: string[]
}

export type TeamOutfitPiece = { id: string; name: string; owned: boolean }

export type TeamDailyOutfit = {
  id: string
  date: string
  attractionIds: string[]
  wardrobeItemIds: string[]
  rationale: string
  missingItems: TeamMissingItem[]
  stylingTips?: string[]
  // extensions
  name?: string | null
  itemsByCategory?: Partial<Record<TeamCategory, TeamOutfitPiece[]>>
  occasions?: string[]
  styleConnections?: string[]
}

export type TeamShoppingGap = {
  id: string
  searchQuery: string
  category?: TeamCategory | null
  color?: string | null
  silhouette?: string | null
  material?: string | null
  styleDescriptors?: string[]
  priority: 'essential' | 'optional'
  reason: string
  outfitIds: string[]
  missingItemIds: string[]
  similarOwnedItemIds?: string[]
}

export type TeamDestination = { id: string; name: string; countryCode?: string; latitude?: number; longitude?: number; timezone?: string }

export type TeamOutfitPlanResponse = {
  requestId: string
  inputRevision: number
  outfits: TeamDailyOutfit[]
  warnings: string[]
  // extensions
  shoppingGaps?: TeamShoppingGap[]
  model?: string | null
  wardrobeImagesUsed?: string[]
}

export type TeamOutfitPlanRequest = {
  requestId: string
  inputRevision: number
  trip: { destination: TeamDestination; startDate: string; endDate: string; [k: string]: unknown }
  wardrobeVersion: string
  wardrobe: TeamWardrobeItem[]
  [k: string]: unknown
}
