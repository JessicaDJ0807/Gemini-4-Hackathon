# AI service vs. the A/B contract

How the implemented AI service relates to [docs/integrations/ai-app-api.md](../integrations/ai-app-api.md) (B's proposed agreement). Nothing in `packages/contracts/` or B's doc was changed.

## Matches the contract

- `POST /v1/outfit-plans` request/response field names, `requestId`/`inputRevision` echo, error body and status codes.
- Garment ids always exist in the supplied wardrobe (unknown ids are removed and reported in `warnings`).
- Attraction ids are only kept when the attraction is scheduled on that outfit's date; unscheduled places are never assigned.
- Weather is never invented: `unavailable` or missing days produce a warning and the outfit says it isn't weather-verified.
- `MissingItem` has `id`, `description`, `searchQuery`, `priority`, `reason`; no merchants, prices or product ids.
- Trip limited to 1–7 days; end before start → 400.

## Differences to agree on with B

1. **Outfit count.** Follows the contract's 1–2 outfits per trip day. Without `outfitCount`, the service aims for 3 outfits (the product brief) within that range: 1-day trip → 2, 2–3 days → 3, longer trips → one per day. B can still send `outfitCount`; a value that puts more than 2 on a day adds a warning.
2. **Additive fields** (optional; B can ignore them): `Outfit.name`, `itemsByCategory`, `occasions`, `styleConnections`; `MissingItem.category/color/silhouette/material/styleDescriptors`; response `shoppingGaps`, `model`; request `preferences`, `outfitCount`.
3. **Extra endpoints** not in the contract: `POST /v1/shopping-gaps`, `POST /v1/outfit-previews`, and static images under `/media/generated/`. The contract lists previews and product search as out of scope; they're available for the demo.
4. **Lenient request fields.** For demo robustness, `Destination` coordinates/timezone, `WardrobeItem.imageUrl/color` and `Attraction.source` are optional here (required in the contract).
5. **Wardrobe photos and inspiration media are both used.** Outfit planning downloads each wardrobe `imageUrl` (same `MEDIA_ALLOWED_HOSTS` rule, ≤10 MB, JPEG/PNG/WebP) and sends it to Gemini with its id. The request's `media` (contract `MediaRef`s, images and videos, max 10) is downloaded the same way as style analysis and sent as "what the user is aiming for", never as owned items. When `styleProfile.visualReferenceIds` is non-empty, only media listed there is used (the contract says `media` must equal the retained references). Unlike style analysis, a media problem (bad type/host, failed download) is a warning, not an error: planning continues without that item. Each outfit lists the `inspirationReferenceIds` it drew from (validated against what Gemini saw); the response lists `inspirationMediaUsed`.
6. **Weather from B, attached per outfit.** B fetches weather for the destination and dates (contract `WeatherDay`). The service gives Gemini each outfit's own day of weather and never fills in values. Additive: `kind: "climate"` for seasonal estimates beyond forecast coverage (as [integrations](../integrations/README.md) asks: "clearly labeled climate estimates"), and optional `conditions`, `windKph`, `humidityPct`. Cleanup before planning: records outside the trip or duplicated are ignored; forecast/climate with no values, or missing days, become `unavailable`; values on an `unavailable` day, min > max, and rain outside 0–100 are dropped. Each is a warning. After planning, a rainy (≥50%) or cold (max ≤12 °C) day with no outer layer adds a warning. Each outfit reports `weatherKind`.
7. **Two `StyleProfile` shapes.** `packages/contracts/` uses `aesthetics/colors/silhouettes/stylingPatterns/avoidances/visualReferenceIds`; B's doc requires `styleTags/colors/avoidances/visualReferenceIds`. The service accepts both (all fields optional, at least one positive preference required). The team should settle on one. **Proposal:** [StyleProfile with style directions](proposals/style-profile-directions.md).
8. **`POST /v1/style-analysis`** is implemented to the contract (request, `suggestedProfile`, `observations`, `warnings`, error codes). Differences:
   - Extra response fields `styleDirections` and `model`; `suggestedProfile` also fills the optional `aesthetics/silhouettes/stylingPatterns/notes`.
   - `suggestedProfile.avoidances` is **only** the user's own list. The model's suggested dislikes are dropped (Experiment 02 showed it invents them).
   - Video `observations` don't include `timestampSeconds` yet (the field is optional).
   - Media hosts: set `MEDIA_ALLOWED_HOSTS`; when unset any http(s) host is accepted (dev only). Max 10 items, 20 MB per image, 100 MB per video. `contentVersion` and `expiresAt` are accepted but not checked.
   - Synchronous and slow with media (~35–50 s on `gemini-4-neon`); the contract's timeouts must allow for this.
9. **B's validators (`packages/contracts/*.mjs`, merged in PR #4).** Checked with B's own JavaScript: `/v1/style-analysis` output passes `validNestedProfile` and `validProfile`, and `/v1/outfit-plans` output passes `validateOutfitResponse`. To match them, `suggestedProfile` now has `summary` (AI description, ≤500 chars), `userTags` (the user's tags), and at most 3 `directions` (one dominant, ≤3 media refs and ≤8 labels per list). Its flat fields are derived exactly like B's `buildStyleProfile()`. `notes` now holds only the user's own notes. B sends attractions without dates, so outfits return empty `attractionIds`, as B's validator requires. `kind: "climate"` weather is accepted by A but not sent by B.
