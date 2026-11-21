# Handoff: Roamfit try-on module

Roamfit now consumes your outfit plans and wardrobe instead of its own outfits. It shows them as **Pieces** and **Looks**, and turns a selected look into a personalized preview on a real destination photo. Details are in [INTEGRATION.md](INTEGRATION.md).

## Contract additions

None of these change your schemas. They live in Roamfit's own versioned contract, `tryon-preview.v1`.

- **`TryOnGarment`** wraps a `WardrobeItem` or a chosen Shopify variant. Wardrobe IDs are kept as-is. Shopify garments use the ID `shopify:<variantGid>`.
- **`SelectedLook`** adds `allowTopLayering`, so a look like your `look-01` (tee under sweater) loads intact.
- **`TryOnPreviewRequestV1`, `TryOnPreviewJobV1` and `TurnaroundManifestV1`** carry the preview request, the async job and the frames. The job state list adds `generating-views`.

## Fields Roamfit consumes

- **`WardrobeItem`**: `id`, `name`, `category`, `imageUrl`, and optionally `color`, `styleTags`, `avatarAssetId`.
- **`DailyOutfit`**: `id`, `date`, `wardrobeItemIds`, `rationale`, `missingItems`, and optionally `stylingTips`, `name`, `occasions`.
- **`MissingItem` and `shoppingGaps`**: used only as Shopify search needs.
- **`trip.destination`**: `id` and `name`, used to pick background photos.

## APIs Roamfit needs from the team

- **Wardrobe and plan data.** Use the response of your existing `POST /v1/outfit-plans` plus the wardrobe you sent. No new endpoint is needed.
- **Readable raster garment images.** Roamfit's server must be able to read each `imageUrl` as JPEG, PNG or WebP over https, on a host listed in `TRYON_MEDIA_ALLOWED_HOSTS`. B's demo SVGs display but cannot be previewed.
- **Shopify Storefront access.** Either share the store domain and token for Roamfit's server, or send Storefront product nodes that include `variants` with ids, options and images.

## APIs Roamfit exposes

| Method and path | Use |
| --- | --- |
| `POST /api/v1/tryon-previews` | Start a preview. Returns a job |
| `GET /api/v1/tryon-previews/:jobId` | Poll the job |
| `GET /api/v1/tryon-previews/:jobId/manifest` | Frames for the viewer |
| `POST /api/v1/tryon-previews/:jobId/approve` | Continue a live turnaround |
| `GET /api/v1/tryon/capabilities` | What is enabled |
| `GET /api/v1/commerce/products?q=` | Shopify search |

Your `POST /v1/outfit-previews` is unchanged. It remains the anonymous lookbook image, which is a different product from personalized try-on.

## Example

```json
POST /api/v1/tryon-previews
{ "requestId": "rf-demo-0007", "inputRevision": 7,
  "avatar": { "mode": "realistic", "personMediaId": "demo-person-v1" },
  "selectedLook": { "garmentIds": ["wd-01", "wd-06"], "sourceOutfitId": "look-02" },
  "garments": [ { "id": "wd-01", "category": "top", "name": "White basic T-shirt", "imageUrl": "/fixtures/team-wardrobe/wd-01.jpg", "source": "wardrobe" },
                { "id": "wd-06", "category": "bottom", "name": "Blue denim jeans", "imageUrl": "/fixtures/team-wardrobe/wd-06.jpg", "source": "wardrobe" } ],
  "background": { "id": "bg-kyoto-ninenzaka-morning-v1", "destinationId": "kyoto", "imageUrl": "/backgrounds/kyoto-ninenzaka-morning.jpg" },
  "previewMode": "turnaround" }
→ 202 { "jobId": "job_…", "requestId": "rf-demo-0007", "inputRevision": 7, "status": "queued", "provenance": "fixture", … }
→ GET … { "status": "ready", "turnaroundManifestUrl": "/api/v1/tryon-previews/job_…/manifest", … }
```

Errors use your body shape: `{ requestId, inputRevision, error: { code, message, retryable } }`.

## What is verified

- **Verified with fixtures:** your recorded Kyoto plan loads, looks resolve, and previews return. Changing destination sends zero requests. Stale responses are ignored.
- **Not verified live:** Gemini personalized generation through this API, Shopify search, and the proxy to your AI service. No credentials were configured, and paid calls were deliberately not made.

## Decisions needed

1. **Media hosting.** Where garment images live in deployment, and which host goes into `TRYON_MEDIA_ALLOWED_HOSTS`.
2. **Shopify ownership.** Whether B shares Storefront credentials with Roamfit's server, or B searches and passes product nodes to Roamfit.
3. **Embedding.** How the app embeds Roamfit: an iframe or route, or a React component, given that `apps/web` is plain ES modules today.
4. **Destinations.** Background photos exist only for Montréal and Kyoto. NYC, Paris and Tokyo need approved street-level photos with ground placement.
5. **Video turnaround.** Whether paid video turnaround is in scope for the demo. The default is a 4-view set, with the mirrored side disclosed.
6. **Montréal photo licence.** The source and licence of this existing asset were not recorded.
