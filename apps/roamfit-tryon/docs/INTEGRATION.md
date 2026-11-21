# Roamfit × Travel AI Stylist: try-on integration

Roamfit is the personalized try-on module for the team app ([JessicaDJ0807/Gemini-4-Hackathon](https://github.com/JessicaDJ0807/Gemini-4-Hackathon)). It consumes the team's wardrobe, outfit recommendations and Shopify products. It does not recommend outfits itself.

Open `http://localhost:5173/#/tryon` after `npm run dev`. Without extra configuration the studio loads the team's recorded outfit plan as clearly labelled fixtures.

## Status

| Area | State |
| --- | --- |
| Team contract adapter, selection state, conflict policy | Implemented, unit tested against the team's real recorded example |
| Pieces / Looks / Shop sidebar, avatar modes, destination photos, turnaround viewer | Implemented, driven end to end in Chrome against fixtures |
| Preview job API, cache, approved assets, fixtures | Implemented, HTTP tested |
| Live personalized generation | Implemented behind `TRYON_LIVE_ENABLED=1` plus per-request consent. **Not exercised in this change.** It reuses the existing `generateSource` and 4-view pipeline, which earlier spikes ran live |
| Shopify search | Implemented. **Not verified live**: no Storefront credentials were configured. Returns `503 SHOPIFY_NOT_CONFIGURED` instead of demo products |
| Team AI proxy | Implemented behind `TEAM_AI_BASE_URL`. **Not verified live** |
| Turntable video | Not exposed through this API. It stays in the existing studio behind explicit cost authorisation |

Fixture success does not prove that live Gemini, Shopify or video generation works.

## What Roamfit reads from the team

Sources read on 2026-11-21: `main@260f716` (AI service, `docs/integrations/ai-app-api.md`, `packages/contracts/README.md`) and `product-integrations@095a465` (B's validators and demo wardrobe). Mirror types are in `src/integration/teamContracts.ts`.

| Team object | Fields Roamfit uses | Notes |
| --- | --- | --- |
| `WardrobeItem` | `id`, `name`, `category`, `imageUrl`, `color`, `styleTags`, `avatarAssetId` | `imageUrl` must be a JPEG, PNG or WebP that Roamfit's server may read. B's demo SVGs are shown but flagged as not previewable |
| `DailyOutfit` | `id`, `date`, `wardrobeItemIds`, `rationale`, `missingItems`, `attractionIds`, `stylingTips` | Extensions used when present: `name`, `occasions`. `itemsByCategory` is not needed because categories come from the wardrobe |
| `MissingItem` / `shoppingGaps` | `id`, `description`, `searchQuery`, `priority`, `category` | Treated as shopping needs. They become Shopify searches, never garments |
| `TripContext.destination` | `id`, `name` | Matched to Roamfit background photos. An unmatched city shows "no approved background photo" |

Original team fields are never changed. Unknown `wardrobeItemIds` are shown as **Unavailable** and are never replaced.

## Roamfit-owned contract: `tryon-preview.v1`

Defined once in `shared/tryon/contract.js` with types in `contract.d.ts`. The browser and the server import the same file.

- **`TryOnGarment`**: as proposed, plus optional `imageStatus`, `merchant`, `price`, `styleTags` and `origin`. Wardrobe IDs are kept verbatim. Shopify garments use `shopify:<variantGid>` so one product in two sizes stays two distinct garments.
- **`SelectedLook`**: `garmentIds`, `sourceOutfitId`, plus optional `allowTopLayering`.
- **`TryOnPreviewRequestV1`**: as proposed, plus optional `contractVersion` and `authorization: { sendToGemini, costAcknowledged }`. That field records user consent and is never a credential.
- **`TryOnPreviewJobV1`**: as proposed, plus `lookKey`, `fingerprint`, `provider`, `provenance`, `provenanceNote` and `step`. The state list adds `generating-views`, because the 4-view turnaround is made of stills, not video.
- **`TurnaroundManifestV1`**: frames, verified views with their origin, `coverageDegrees`, `verifiedFullRotation`, provenance and limitations. Mirrored views are disclosed. A view set is never called 360°.

### Validation

`validatePreviewRequest` rejects the following cases. The server additionally checks that media is authorised and readable.

- An empty look, duplicate IDs, or a selected ID missing from `garments[]`.
- A garment without an image, with inline data, or with an SVG.
- A Shopify garment without `productId` or `variantId`.
- Real Me without `personMediaId`.
- My Little Self without a description of at least 3 characters or a photo.
- Anything that looks like an API key or bearer token, and any inline base64.
- Category conflicts.

### Conflict policy

The policy is deterministic: the latest tap wins.

- **Dress versus top or bottom:** adding a dress removes tops and bottoms. Adding a top or bottom removes the dress.
- **Bottom, dress, outerwear, shoes:** one each. A new pick replaces the old one.
- **Top:** one, or two when **Layer tops** is on. Loading a recommended look that layers tops turns it on automatically.
- **Accessories:** up to 3. A fourth is refused rather than removing something.

Every removal shows a notice naming what was replaced. Selecting never starts generation; only **Generate preview** does.

## Caching and cost control

`lookKey` hashes the avatar mode and method, the person media ID, the normalized Little Self description, the sorted garment IDs with variant IDs, the layering flag, the preview mode and the generation-parameter version. `fingerprint` adds the provider and model version.

**The background is excluded.** Characters are generated on a neutral backdrop and composited over the destination photo in the browser. Changing Montréal to Kyoto, or switching photos, sends no request.

The server picks a provider in this order:

1. **Approved asset.** A previously generated asset whose real inputs match exactly. Today that is the demo photo with the Roamfit tee and gingham trousers, in both modes. It is labelled "Previously generated…".
2. **Live.** Only when `TRYON_LIVE_ENABLED=1`, `GEMINI_API_KEY` is set, two different Gemini 4 models are configured, and the request has `authorization.sendToGemini: true`. It checks the fingerprint cache first and never retries. The turnaround pauses at `awaiting-approval` so the user can reject a wrong still before paying for side and back views.
3. **Mock.** A stored sample, labelled **FIXTURE: not your outfit**, with a note that the selected garments were not rendered.

fal.ai, Meshy, Tripo, other 3D providers and video models are never called by this API.

## Media authorisation

Shared contracts carry references only. The server accepts these locations and refuses everything else with `403 MEDIA_FORBIDDEN`:

- `/media/<whitelisted garment crop>`
- `/fixtures/team-wardrobe/wd-NN.jpg`
- `/backgrounds/*.jpg`
- `https://` hosts listed in `TRYON_MEDIA_ALLOWED_HOSTS`, which defaults to `cdn.shopify.com`

Person photos must be upload IDs from `POST /api/studio/upload` or the bundled `demo-person-v1`. Remote images are fetched only during live generation, with a 10 MB cap and byte-sniffing.

## APIs Roamfit exposes

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/tryon/capabilities` | Contract version, live status with reasons, allowed media hosts |
| `POST /api/v1/tryon-previews` | Submit a request. Returns `202` with a job, or `200` when already ready. Resubmitting the same `requestId` and `inputRevision` is idempotent |
| `GET /api/v1/tryon-previews/:jobId` | Poll the job |
| `POST /api/v1/tryon-previews/:jobId/approve` | Continue a live turnaround after the user approves the still |
| `GET /api/v1/tryon-previews/:jobId/manifest` | `TurnaroundManifestV1` for the viewer |
| `GET /api/v1/commerce/products?q=&gapId=` | Shopify Storefront search returning raw nodes, normalized by `src/integration/shopifyAdapter.ts` |
| `POST /api/v1/team/outfit-plans` | Optional server-side proxy to the team's `/v1/outfit-plans`. The token never reaches the browser |

Errors use the team's body shape: `{ requestId, inputRevision, error: { code, message, retryable, details? } }`.

The team's `POST /v1/outfit-previews` is untouched. It makes an anonymous lookbook image and is not a personalized try-on.

### Example (captured from the running server)

```json
POST /api/v1/tryon-previews
{
  "contractVersion": "tryon-preview.v1", "requestId": "rf-demo-0007", "inputRevision": 7,
  "avatar": { "mode": "stylized", "creationMethod": "photo", "personMediaId": "demo-person-v1", "description": "short black hair, small gold hoop earrings" },
  "selectedLook": { "garmentIds": ["wd-01","wd-03","wd-05","wd-06","wd-09","wd-10"], "sourceOutfitId": "look-01", "allowTopLayering": true },
  "garments": [ { "id": "wd-01", "category": "top", "name": "White basic T-shirt", "imageUrl": "/fixtures/team-wardrobe/wd-01.jpg", "source": "wardrobe", "color": "white" } ],
  "background": { "id": "bg-kyoto-ninenzaka-morning-v1", "destinationId": "kyoto", "imageUrl": "/backgrounds/kyoto-ninenzaka-morning.jpg" },
  "previewMode": "turnaround"
}
```

`garments` is shortened above; the real request listed all six.

```json
202 → later GET /api/v1/tryon-previews/job_…
{ "jobId": "job_…", "requestId": "rf-demo-0007", "inputRevision": 7, "status": "ready",
  "previewImageUrl": "/generated/demo__little-self__stroll/source.jpg",
  "turnaroundManifestUrl": "/api/v1/tryon-previews/job_…/manifest",
  "lookKey": "lk_05ff61c2944537", "fingerprint": "fp_17188ff5f42c5a", "provider": "mock", "provenance": "fixture",
  "provenanceNote": "Live generation unavailable (TRYON_LIVE_ENABLED is not 1), so a FIXTURE was returned." }
```

```json
400 (Real Me without a photo, garment without an image)
{ "requestId": "rf-demo-0008", "inputRevision": 8,
  "error": { "code": "PERSON_PHOTO_REQUIRED", "message": "Real Me needs an authorised full-body person photo (personMediaId)", "retryable": false,
    "details": [ { "code": "PERSON_PHOTO_REQUIRED", "path": "$.avatar.personMediaId" }, { "code": "GARMENT_IMAGE_MISSING", "path": "$.garments[0].imageUrl" } ] } }
```

## Embedding

`TryOnStudio` in `src/tryon/TryOnStudio.tsx` accepts `data: { wardrobe, outfitPlan, destination, resolveImageUrl, isFixture, sourceLabel }`. Without `data` it loads fixtures. The team app's framework is not decided yet, so the stable boundary is the HTTP API plus these props, not a shared bundle.

## Tests

Run `npm test`. The suite has 45 tests: 17 pre-existing, 18 in `src/integration/integration.test.ts` and 10 in `server/preview/routes.test.js`. No test makes a paid call.

| User story | Covered by |
| --- | --- |
| 1–3 select a top; pants and cardigan; deselect | `user stories 1, 2, 3`, conflict policy |
| 4 recommended look | `4.` (real team `look-01`, layered tops) |
| 5 Shopify garment | `5.`, `5b.` (Storefront-shaped fixture on an `example` domain) |
| 6 Little Self to Real Me | `6.` |
| 7 Montréal to Kyoto | `7.` (client), `7.` (server, same fingerprint) |
| 8 generate | server `8.` (async states to ready, manifest) |
| 9–10 revisit and change | `9/10.` client keys; server approved asset and cache hit |
| 11 missing image | `11.` client and server |
| 12 API error | server `12.` (structured retryable failure), client `12/13.` |
| 13 outdated response | `12/13.` (late result stored for revisit, never shown as current) |

The browser flow was also driven in headless Chrome: fixture look, approved asset, mouse and touch drag, Front/Side/Back presets, Kyoto with zero new requests, Real Me, team look as fixture, a dress tap replacing top and bottom, Shopify unconfigured, and postcard export with the credit line.
