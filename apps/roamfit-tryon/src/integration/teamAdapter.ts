// A. Shared contract adapter: team WardrobeItem / DailyOutfit → Roamfit TryOnGarment / LookCard.
// Never invents a garment: unknown IDs become explicit `unavailable` entries; MissingItems stay *needs*, not products.
import { GARMENT_CATEGORIES, type GarmentCategory, type TryOnGarment } from '../../shared/tryon/contract.js'
import type { TeamDailyOutfit, TeamMissingItem, TeamOutfitPlanResponse, TeamWardrobeItem } from './teamContracts'

export type AdapterIssue = { itemId: string; code: 'INVALID_CATEGORY' | 'IMAGE_MISSING' | 'IMAGE_UNSUPPORTED' | 'DUPLICATE_ID' | 'MISSING_ID'; message: string }

export type GarmentIndex = Map<string, TryOnGarment>

export type LookCard = {
  id: string
  name: string
  date: string
  occasions: string[]
  attractionIds: string[]
  rationale: string
  stylingTips: string[]
  /** Resolved, de-duplicated garment IDs in recommendation order. */
  garmentIds: string[]
  /** Recommended IDs that are not in the known wardrobe. Shown as unavailable, never replaced. */
  unavailableIds: string[]
  /** Shopping needs from the planner (descriptions, not products). */
  missingItems: TeamMissingItem[]
  /** True when the look intentionally layers two tops (e.g. tee under sweater). */
  layeredTops: boolean
  isFixture: boolean
}

export type AdapterOptions = {
  /** Rewrites a team imageUrl to a URL this app can load (e.g. fixture host → /fixtures/...). Identity by default. */
  resolveImageUrl?: (url: string, item: TeamWardrobeItem) => string
  origin?: 'team-wardrobe' | 'roamfit-fixture'
}

const RASTER = /\.(jpe?g|png|webp)(\?|#|$)/i

export function wardrobeItemToGarment(item: TeamWardrobeItem, opts: AdapterOptions = {}): { garment: TryOnGarment | null; issues: AdapterIssue[] } {
  const issues: AdapterIssue[] = []
  if (!GARMENT_CATEGORIES.includes(item.category as GarmentCategory)) {
    issues.push({ itemId: item.id, code: 'INVALID_CATEGORY', message: `${item.name || item.id}: unsupported category "${item.category}"` })
    return { garment: null, issues }
  }
  const raw = typeof item.imageUrl === 'string' ? item.imageUrl.trim() : ''
  let imageStatus: TryOnGarment['imageStatus'] = 'ok'
  if (!raw) { imageStatus = 'missing'; issues.push({ itemId: item.id, code: 'IMAGE_MISSING', message: `${item.name}: no image in the wardrobe record` }) }
  else if (/\.svg(\?|#|$)/i.test(raw)) { imageStatus = 'unsupported-format'; issues.push({ itemId: item.id, code: 'IMAGE_UNSUPPORTED', message: `${item.name}: SVG illustration can be shown but not sent to the image model` }) }
  else if (!RASTER.test(raw) && !/^https?:/i.test(raw)) { /* extensionless remote URLs are allowed; the server sniffs bytes */ }
  const imageUrl = raw ? (opts.resolveImageUrl ? opts.resolveImageUrl(raw, item) : raw) : ''
  return {
    garment: {
      id: item.id,
      category: item.category as GarmentCategory,
      name: item.name,
      imageUrl,
      source: 'wardrobe',
      color: item.color ?? undefined,
      avatarAssetId: item.avatarAssetId,
      styleTags: item.styleTags,
      imageStatus,
      origin: { kind: opts.origin ?? 'team-wardrobe', ref: item.id },
    },
    issues,
  }
}

/** Builds the id → garment index. First record wins on duplicate IDs (team contract requires unique IDs). */
export function buildGarmentIndex(wardrobe: TeamWardrobeItem[], opts: AdapterOptions = {}, extra: TryOnGarment[] = []): { index: GarmentIndex; issues: AdapterIssue[] } {
  const index: GarmentIndex = new Map()
  const issues: AdapterIssue[] = []
  for (const item of wardrobe) {
    if (index.has(item.id)) { issues.push({ itemId: item.id, code: 'DUPLICATE_ID', message: `Duplicate wardrobe id ${item.id}; kept the first record` }); continue }
    const r = wardrobeItemToGarment(item, opts)
    issues.push(...r.issues)
    if (r.garment) index.set(r.garment.id, r.garment)
  }
  for (const g of extra) if (!index.has(g.id)) index.set(g.id, g)
  return { index, issues }
}

/** Resolve one DailyOutfit against the known wardrobe. */
export function resolveDailyOutfit(outfit: TeamDailyOutfit, index: GarmentIndex, { isFixture = false } = {}): LookCard {
  const seen = new Set<string>()
  const garmentIds: string[] = [], unavailableIds: string[] = []
  for (const id of outfit.wardrobeItemIds ?? []) {
    if (seen.has(id)) continue
    seen.add(id)
    if (index.has(id)) garmentIds.push(id); else unavailableIds.push(id)
  }
  const tops = garmentIds.filter(id => index.get(id)!.category === 'top').length
  return {
    id: outfit.id,
    name: outfit.name?.trim() || `Look for ${outfit.date}`,
    date: outfit.date,
    occasions: outfit.occasions ?? [],
    attractionIds: outfit.attractionIds ?? [],
    rationale: outfit.rationale,
    stylingTips: outfit.stylingTips ?? [],
    garmentIds,
    unavailableIds,
    missingItems: outfit.missingItems ?? [],
    layeredTops: tops > 1,
    isFixture,
  }
}

export function adaptOutfitPlan(response: TeamOutfitPlanResponse, wardrobe: TeamWardrobeItem[], opts: AdapterOptions & { isFixture?: boolean } = {}) {
  const { index, issues } = buildGarmentIndex(wardrobe, opts)
  const looks = response.outfits.map(o => resolveDailyOutfit(o, index, { isFixture: !!opts.isFixture }))
  for (const l of looks) for (const id of l.unavailableIds) issues.push({ itemId: id, code: 'MISSING_ID', message: `${l.name} references ${id}, which is not in the wardrobe` })
  return { index, looks, issues, warnings: response.warnings ?? [], shoppingGaps: response.shoppingGaps ?? [], requestId: response.requestId, inputRevision: response.inputRevision }
}
