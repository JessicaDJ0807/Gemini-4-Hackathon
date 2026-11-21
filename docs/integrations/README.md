# External Integrations

## Weather and attractions (Person B)

B uses Open-Meteo through `POST /api/weather` for destination-local daily forecasts. Dates outside forecast coverage and missing measurements remain explicitly unavailable; no climate estimates are substituted. See [app setup](../../apps/web/README.md#daily-weather). Attractions and scheduling data should be validated before using in model prompts.

## Shop.dev / Shopify (Person B)

A returns missing-item requirements and search strings. B now consumes those through **Shop this piece** and `POST /api/products/search`, calling Shop MCP's read-only catalog search. It displays up to five real product matches with photos, merchant, price/currency, shown variant, availability, and the original product link. No generated product listings or inferred missing items. [Implementation and limits](../../apps/web/README.md#shop-this-piece-real-product-search). Users can select a returned variant, add it to a session bag, and review a checkout per merchant. B creates the checkout through Shop MCP using signed search offers; payment is handed to the merchant’s secure page. Embedded payment and order tracking remain future work.

## 3D viewer (Person C, integrated by B)

Viewer should accept an outfit ID plus `garmentAssetIds`, and an optional animation; it should expose rotation and handle unsupported garments gracefully. Prepared assets are stylized approximations, not accurate 3D reconstructions from ordinary photos.

## AI endpoints (Person A, integrated by B)

Use versioned request/response schemas. Current B onboarding automatically analyzes uploaded photos through its server-side Gemini adapter. It saves editable nested style directions and separate manual tags, with derived flat fields for compatibility. Detailed analysis is hidden behind optional editing in the UI and included in outfit requests; original photos are transient. See [B setup](../../apps/web/README.md#automatic-photo-labels-with-gemini). Never expose secret API keys client-side.
