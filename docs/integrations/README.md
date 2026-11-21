# External Integrations

## Weather and attractions (Person B)

Retrieve weather for destination and dates; use clearly labeled climate estimates when dates exceed forecast coverage. Attractions and scheduling data should be validated before using in model prompts.

## Shop.dev / Shopify (Person B)

AI returns missing-item *requirements* and search strings, not fabricated purchasable listings. Commerce resolves actual inventory, prices, variants, carts, and checkout. Confirm merchant-specific checkout limitations and require explicit user action to purchase.

## 3D viewer (Person C, integrated by B)

Viewer should accept an outfit ID plus `garmentAssetIds`, and an optional animation; it should expose rotation and handle unsupported garments gracefully. Prepared assets are stylized approximations, not accurate 3D reconstructions from ordinary photos.

## AI endpoints (Person A, integrated by B)

Use versioned request/response schemas. Keep raw uploads and generated media references accessible to authorized server-side model calls. Never expose secret API keys client-side.
