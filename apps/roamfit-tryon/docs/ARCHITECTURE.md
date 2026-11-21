# Roamfit — Hackathon MVP architecture

## Product boundary

Roamfit is a hybrid inspiration-to-commerce demo, not a sizing engine. Explore Mode uses a known preset avatar and two authored 3D looks. The AI path edits a user's photo into a destination editorial. Shopify products are shoppable recommendations and 2D visual references; their images are never treated as geometry or guaranteed to match the authored 3D garments.

## System

```text
React/Vite client
  ├─ ExploreScene (R3F): preset-v1 avatar + authored look registry + one scene
  ├─ TryOnStudio: local image preview, request, QA scores
  └─ ShopEdit: recommendations + product links
          │ /api
Express orchestration layer
  ├─ Gemini 4 Argon / styling planner → constrained edit plan
  ├─ Gemini image model / editor → destination portrait
  ├─ Gemini 4 Argon / visual QA → identity, garment, scene scores
  └─ Shopify Storefront GraphQL → product candidates
```

Secrets stay server-side. Every AI run returns a trace with role, configured model ID, and latency so judges can see that the model roles are substantive. The planner and QA judge are separate Gemini 4 calls with different inputs, prompts, and outputs. Public Gemini API documentation currently confirms `gemini-4-argon`; if hackathon credentials expose a second Gemini 4 endpoint, set `GEMINI_QA_MODEL` to it without changing code. The image-edit task uses `gemini-nano-banana-2.1` by default.

## Components

| Component | Responsibility | Failure behavior |
|---|---|---|
| `ExploreScene` | Orbitable travel set, preset avatar, deterministic outfit switch | Procedural local geometry keeps demo alive |
| `TryOnStudio` | Upload, progress, result and QA scores | Demo fixture without key; readable API error on failure |
| Planner | Turns selected trip, outfit and products into preservation constraints | Request fails; do not generate unconstrained image |
| Image editor | Produces the photorealistic composite | Request fails; original image stays local in UI |
| QA judge | Scores identity/garment/background and returns notes | Result marked unverified when parsing fails |
| Shopify adapter | Queries products and ranks trip relevance | Uses clearly labeled demo catalog when unconfigured |

## Data model

`Outfit` owns `asset.kind = authored-3d`, an optional reviewed `glbUrl`, colors, and `compatibleAvatar = preset-v1`. `ProductRecommendation` is deliberately separate and has no `glbUrl`. `TryOnResult` contains image, plan, QA and trace. This separation enforces the 2D-product/3D-asset boundary in code.

## API contracts

### `GET /api/products?outfitId=coastal-linen&destinationId=amalfi`

Returns `{ mode: "live" | "demo", products: ProductRecommendation[] }`. Live mode calls Storefront API `2026-10`, filters available products, then applies a deterministic MVP relevance ranker.

### `POST /api/try-on`

```json
{
  "personImage": "data:image/jpeg;base64,...",
  "outfitId": "coastal-linen",
  "destinationId": "amalfi",
  "productIds": ["gid://shopify/Product/..."]
}
```

Returns `{ imageUrl, mode, plan, qa, trace }`. Hard cap is 15 MB. For production, replace data URLs with signed object storage, add authentication, consent/retention controls, moderation, queues, and idempotency keys.

## GLB acceptance gate

Only add a garment after it passes: glTF/GLB 2.0; Y-up; meters; sensible bounding box; textures embedded or resolvable; no missing meshes; acceptable draw calls/texture sizes; compatible `preset-v1` rig or intentionally rigid attachment; no clipping in neutral and demo poses; confirmed license. A product photograph alone fails this gate.

## Risk-first spikes

1. **P0 identity/garment fidelity:** run 5 consented photos × both looks × two destinations. Blind-score identity and garment construction. Gate: median identity ≥ .80, garment ≥ .75, no severe failure. Capture latency and retry rate.
2. **P0 GLB compatibility:** validate one real avatar GLB and both authored outfit GLBs against the gate above, then test outfit swap on a mobile GPU. Gate: no console errors, < 5 MB compressed scene target, ≥ 30 FPS on target phone.
3. **P0 Shopify:** connect the hackathon shop.dev domain/token, query 20 products, verify images/prices/links, and confirm graceful empty/error states.
4. **P1 orchestration:** verify planner JSON, image output, QA JSON and trace. Treat model QA as a demo signal, not an objective biometric metric.

## Test plan

- Unit: product ranking, request validation, Gemini response parsing, asset-registry invariants.
- Contract: recorded successful/error responses for Gemini and Shopify; assert no secret reaches browser bundle.
- Visual: outfit toggle, orbit/zoom, mobile layout, uploaded preview and result states.
- Spike matrix: identity, body shape, skin tone, loose/tight garments, occlusion, lighting. Log failures, not only averages.
- Demo rehearsal: keys present/absent, throttling, 15 MB rejection, Shopify empty catalog, model timeout. Keep pre-generated consented output as a labeled fallback.

## Hackathon schedule (8 hours)

| Time | Deliverable / exit gate |
|---|---|
| 0:00–0:45 | Keys, live model IDs, Shopify token; three spike scripts return evidence |
| 0:45–2:00 | Identity/garment matrix; pick one destination/look pair only if thresholds pass |
| 2:00–3:15 | Real reviewed GLBs integrated; swap is stable on phone |
| 3:15–4:00 | Live Shopify cards and links |
| 4:00–5:30 | Planner → image → QA orchestration with visible trace |
| 5:30–6:30 | UI polish, loading/error/fallback states, responsive pass |
| 6:30–7:15 | Tests, performance, privacy copy, pre-generated fallback |
| 7:15–8:00 | Rehearse a 90-second story and record backup demo |

Cut order when behind: Tokyo scene → second photorealistic look → live product ranking sophistication. Never cut the honest 2D/3D boundary, model trace, or fallback.

## Demo story

“Most try-on tools stop at a blank room and a garment image. Roamfit begins with the trip: explore the feeling in 3D, see yourself in a destination moment, and buy a real-world edit. The magic is the closed loop—Gemini plans and verifies, image AI visualizes, Shopify converts—while authored 3D assets keep the experience believable.”
