# External Integrations

## Weather and attractions (Person B)

B uses Open-Meteo through `POST /api/weather` for destination-local daily forecasts. Dates outside forecast coverage and missing measurements remain explicitly unavailable; no climate estimates are substituted. See [app setup](../../apps/web/README.md#daily-weather). Attractions and scheduling data should be validated before using in model prompts.

## Shop.dev / Shopify (Person B)

AI returns missing-item *requirements* and search strings, not fabricated purchasable listings. Commerce resolves actual inventory, prices, variants, carts, and checkout. Confirm merchant-specific checkout limitations and require explicit user action to purchase.

## 3D viewer (Person C, integrated by B)

Viewer should accept an outfit ID plus `garmentAssetIds`, and an optional animation; it should expose rotation and handle unsupported garments gracefully. Prepared assets are stylized approximations, not accurate 3D reconstructions from ordinary photos.

## AI endpoints (Person A, integrated by B)

Use versioned request/response schemas. Current B onboarding automatically analyzes uploaded photos through its server-side Gemini adapter. It saves editable nested style directions and separate manual tags, with derived flat fields for compatibility. Detailed analysis is hidden behind optional editing in the UI and included in outfit requests; original photos are transient. See [B setup](../../apps/web/README.md#automatic-photo-labels-with-gemini). Never expose secret API keys client-side.
