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

1. **Outfit count.** The product brief wants 3 recommendations; the contract says 1–2 outfits per trip day. The service spreads `outfitCount` (default 3) across days, one per day before any day gets two. A 3-day trip satisfies both. A 1-day trip with the default gives 3 outfits on one day and a warning. B can send `outfitCount` to control this.
2. **Additive fields** (optional; B can ignore them): `Outfit.name`, `itemsByCategory`, `occasions`, `styleConnections`; `MissingItem.category/color/silhouette/material/styleDescriptors`; response `shoppingGaps`, `model`; request `preferences`, `outfitCount`.
3. **Extra endpoints** not in the contract: `POST /v1/shopping-gaps`, `POST /v1/outfit-previews`, and static images under `/media/generated/`. The contract lists previews and product search as out of scope; they're available for the demo.
4. **Lenient request fields.** For demo robustness, `Destination` coordinates/timezone, `WardrobeItem.imageUrl/color` and `Attraction.source` are optional here (required in the contract).
5. **Media not used yet.** `media` and wardrobe `imageUrl`s are accepted but outfit planning uses text metadata only; images aren't fetched.
6. **Two `StyleProfile` shapes.** `packages/contracts/` uses `aesthetics/colors/silhouettes/stylingPatterns/avoidances/visualReferenceIds`; B's doc requires `styleTags/colors/avoidances/visualReferenceIds`. The service accepts both (all fields optional, at least one positive preference required). The team should settle on one.
7. **`POST /v1/style-analysis`** is implemented to the contract (request, `suggestedProfile`, `observations`, `warnings`, error codes). Differences:
   - Extra response fields `styleDirections` and `model`; `suggestedProfile` also fills the optional `aesthetics/silhouettes/stylingPatterns/notes`.
   - `suggestedProfile.avoidances` is **only** the user's own list. The model's suggested dislikes are dropped (Experiment 02 showed it invents them).
   - Video `observations` don't include `timestampSeconds` yet (the field is optional).
   - Media hosts: set `MEDIA_ALLOWED_HOSTS`; when unset any http(s) host is accepted (dev only). Max 10 items, 20 MB per image, 100 MB per video. `contentVersion` and `expiresAt` are accepted but not checked.
   - Synchronous and slow with media (~35–50 s on `gemini-4-neon`); the contract's timeouts must allow for this.
