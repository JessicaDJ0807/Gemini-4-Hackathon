// FIXTURES ONLY. Loads the team's recorded outfit-plan example (copied unchanged) plus a small Roamfit wardrobe fixture.
// Nothing here is presented as a live AI or Shopify result; every look card built from it carries isFixture = true.
import teamPlan from './team-outfit-plan.fixture.json'
import type { TeamDailyOutfit, TeamOutfitPlanRequest, TeamOutfitPlanResponse, TeamWardrobeItem } from '../teamContracts'

export const TEAM_FIXTURE_SOURCE: string = teamPlan._fixture.source
export const teamPlanRequest = teamPlan.request as unknown as TeamOutfitPlanRequest
export const teamPlanResponse = teamPlan.response as unknown as TeamOutfitPlanResponse

/** The team example points at its local test server; serve the same files (copied to public/) from this app. */
export const rewriteTeamFixtureUrl = (url: string) => url.replace(/^https?:\/\/(127\.0\.0\.1|localhost):8799\/wardrobe\/images\//, '/fixtures/team-wardrobe/')

/**
 * Roamfit's own three garments (cropped from the project's test photo, served by the whitelisted /media route).
 * Shaped as team WardrobeItems so they go through the same adapter. IDs are prefixed rf- to avoid collisions.
 */
export const roamfitWardrobe: TeamWardrobeItem[] = [
  { id: 'rf-tee-ivory', name: 'Ivory square-neck tee', category: 'top', color: 'ivory', styleTags: ['minimal'], imageUrl: '/media/garment_white_squareneck_tee.png' },
  { id: 'rf-trousers-gingham', name: 'Gingham flared trousers', category: 'bottom', color: 'black and ecru', styleTags: ['classic'], imageUrl: '/media/garment_gingham_flare_trousers.png' },
  { id: 'rf-cardigan-black', name: 'Black cropped cardigan', category: 'outerwear', color: 'black', styleTags: ['classic'], imageUrl: '/media/garment_black_cropped_cardigan.png' },
]

/** A DailyOutfit-shaped FIXTURE so the full flow can end at a real previously generated asset. Not an AI recommendation. */
export const roamfitFixtureOutfits: TeamDailyOutfit[] = [{
  id: 'rf-fixture-stroll', date: '2026-12-03', attractionIds: [], wardrobeItemIds: ['rf-tee-ivory', 'rf-trousers-gingham'], missingItems: [],
  name: 'Roamfit demo: Old Town Stroll',
  rationale: 'Roamfit fixture, not an AI recommendation. This tee and trouser pair has a previously generated 4-view turnaround for the demo photo, so it exercises the cache path end to end.',
  stylingTips: ['Fixture data for integration testing.'],
}]
