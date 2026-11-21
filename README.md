# Travel AI Stylist

**Plan the trip. Style the looks. Preview the vibe.**

Travel AI Stylist is a multimodal travel-outfit planner built for the **Gemini 4 Hackathon — Element 119**. It learns a user's fashion preferences from style tags, inspiration photos, and short videos; recommends outfits for each day of a trip using destination, attractions, weather, and a demo wardrobe; and lets users preview looks on a rotatable 3D avatar, through virtual try-on, and in AI-generated destination scenes. If something is missing, users can discover products and proceed toward checkout through Shopify's commerce tools.

## Demo journey

1. **Create a style profile** — Select aesthetic tags and/or upload outfit inspiration images or short videos. Gemini identifies recurring aesthetics, colors, silhouettes, layering, and styling patterns. Review and edit the result.
2. **Plan a trip** — Enter destination and travel dates; choose attractions. The app retrieves weather forecasts where available (otherwise marks weather unavailable). Optional text, image, or video inspiration adds context.
3. **Get daily looks** — Gemini combines trip context, the style profile, raw visual references, and a preloaded synthetic wardrobe to suggest outfits and identify missing essentials.
4. **Preview** — Rotate and animate a 3D avatar, generate an approximate virtual try-on, or create an inspirational destination photo.
5. **Shop missing pieces** — Find relevant products, add items to a cart, and start an available, user-confirmed checkout flow.

## Hackathon focus

The central question is **whether Gemini can translate messy real-world fashion images, videos, and audio into personalized, practical outfit choices**. Raw visual references remain available to multimodal reasoning and visual generation; structured metadata alone is not the entire experience. We will document genuine successes, failures, and mitigations rather than relying only on scripted examples.

## MVP scope

**In scope:** image/video + tag-based style onboarding; editable style profile; destination, dates, attractions, and weather; synthetic wardrobe; daily outfit generation; 3D avatar; image-based virtual try-on; destination scene generation; Shopify product discovery, cart, and checkout integration where supported.

**Later:** live user wardrobe upload, social account connections, iterative restyling, optimized packing lists, and a full evaluation dashboard. A lightweight real-input failure analysis remains part of the hackathon story.

## Repository structure

```text
apps/
  web/                   # App UI, onboarding, itinerary, outfit and commerce screens
services/
  ai/                    # Gemini multimodal analysis, outfit planning, image generation
packages/
  contracts/             # Shared request/response schemas and example payloads
  3d-viewer/             # Reusable avatar component, assets and animations
data/
  demo-wardrobe/         # Synthetic garment metadata and permitted demo images
docs/
  product/               # User journey, feature scope and UX decisions
  ai/                    # AI experiments, prompts, model choices and evaluation
  integrations/          # Weather, attractions, Shopify, 3D integration notes
```

The directories describe intended ownership, **not a commitment to any framework**. Start small; add subfolders only as modules become real.

## Team workstreams

| Workstream | Primary owner | Deliverables |
| --- | --- | --- |
| **A — AI & multimodal** | Gemini engineer | Style analysis from tags/images/video; outfit planning; missing-item descriptors; virtual try-on and destination images; real-input tests |
| **B — Product & integrations** | App engineer | Web flow and uploads; destination/weather/attractions; demo wardrobe; Shop.dev product/cart/checkout; app integration |
| **C — 3D** | 3D engineer | Rotatable avatar, prepared garment assets, look switching, animations, reusable viewer component |

We coordinate via shared contracts instead of importing each other's implementation internals.

## Integration boundaries

- **App → AI:** `StyleAnalysisRequest`, `OutfitPlanRequest`, `PreviewRequest`.
- **AI → App:** `StyleProfile`, `DailyOutfit[]`, `GeneratedPreview`.
- **App → 3D:** `outfitId`, `garmentAssetIds`, optional `animation`.
- **App → Shopify:** structured `missingItems` descriptors and user-selected product variants.
- **Data:** stable `WardrobeItem.id`, `imageUrl`, category, color, style tags, and optional `avatarAssetId` mapping.

See [shared contracts](packages/contracts/README.md). Keep media stored securely and pass **references to files**, not base64 blobs, through internal interfaces when possible. For model calls, retrieve the relevant original images/frames/videos as needed.

## Getting started

The current B flow supports inspiration photos and optional manual tags. Photos are analyzed automatically through server-side Gemini. The screen shows compact style labels; richer direction details are saved for styling and can be edited through an optional disclosure. The full confirmed profile stays in this browser session, and reanalysis preserves manual tags and lets users review replacements for edited styles. Continue to trip setup to select a destination and dates, edit attraction suggestions, and confirm the trip. Weather is saved in the background for styling. The next page lets you select wardrobe items and generate daily outfits. Live mode uses A's photo wardrobe and Gemini service; demo mode uses labeled mock outfits. Missing items connect to real Shop product search through **Shop this piece**. With Node.js 22.9+, run `npm run dev` and open http://127.0.0.1:3000. No dependency installation is required. Run `npm test` for integration checks.

Run `npm run dev:full` after installing A's Python requirements to start A and B together with the root Gemini key. See [setup](apps/web/README.md#run-a-and-b-together). Photo analysis uses B's Gemini adapter; real outfit generation uses A, with a compatibility bridge for nested style details. Product search, variant selection, a session shopping bag, and merchant checkout review are available. Final payment opens the merchant’s secure checkout. Video, raw-style-photo handoff, 3D, embedded payment, and order tracking remain outside this runnable flow. See the [A/B API agreement](docs/integrations/ai-app-api.md) for request/response fields.

1. Agree on the data contracts and sample payloads in `packages/contracts/`.
2. B builds the app with mock `StyleProfile` and `DailyOutfit` responses.
3. A develops Gemini workflows against those samples and exposes stable API responses.
4. C builds the viewer against sample `garmentAssetIds`.
5. Integrate the first complete flow before polishing secondary features.

**Credentials:** keep secrets in local `.env` files or server-side secret storage; commit only `.env.example`. Do not expose Gemini or commerce credentials in browser bundles. **Media:** use only photos/videos you own or have permission to analyze; avoid committing personal selfies or unlicensed social content.

## Docs

- [AI workstream](docs/ai/README.md)
- [Shared integration contracts](packages/contracts/README.md)
- [Product scope](docs/product/README.md)
- [External integrations](docs/integrations/README.md)

## Status

Hackathon MVP in development. Feature availability depends on the supported Gemini 4 endpoints, 3D assets, and Shopify checkout capabilities verified during integration.
