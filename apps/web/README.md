# B: style onboarding and trip setup

Work branch: `product-integrations`. The merged A service is in `services/ai/`.

## Run locally

Use Node.js 22.9 or newer. B needs no Node package dependencies. The live A+B mode also needs A’s Python environment.

```sh
npm run dev
```

Open http://127.0.0.1:3000. Upload outfit inspiration photos for automatic analysis, or add personal tags without photos. The initial screen shows compact removable style labels. Rich style directions stay saved for outfit reference; optional **Edit style details** reveals the editor. Continue to trip setup, then the wardrobe and daily looks. `npm run dev` uses mock outfits unless both `AI_BASE_URL` and `AI_SERVICE_TOKEN` are configured.

## Automatic photo labels with Gemini

Copy `.env.example` to `.env` and set `GEMINI_API_KEY` on the server. `GEMINI_MODEL` defaults to `gemini-4-hydrogen`; choose a supported image-understanding model available to your project. Restart `npm run dev`. These settings are independent of A's service and mock outfits. Without a key, manual tags and saved profiles still work. Never paste a key into browser code or commit `.env`.

Users may add up to three JPG/PNG/WebP images, at most 2 MB each. The browser previews and decodes files locally (up to 16 megapixels). Adding or removing photos automatically sends the remaining nonempty set to B's `POST /api/style-inspiration`, then to Google Gemini as inline image parts. The server validates count, size, base64, and file signatures. No arbitrary remote image URLs are fetched. See [image input](https://ai.google.dev/gemini-api/docs/image-understanding) and [structured output](https://ai.google.dev/gemini-api/docs/structured-output). The photo request has a 55-second server timeout and a 60-second browser timeout.

Gemini returns a summary and up to three directions, each with a name, description, strength, colors, silhouettes, styling patterns, key pieces, and supplied photo references. B assigns direction IDs, validates the structure and reference IDs, and derives flat compatibility fields. Empty results explain when no style was found and leave existing preferences intact. Invalid, blocked, or failed results are errors, never fabricated suggestions. Tests inject provider results.

## Manual tags and nested editing

Personal tags are optional, case-insensitively deduplicated, and limited to 20 labels of 100 characters each. They work without AI. Each direction supports editing its name, description, and up to eight labels per detail category, or removing the direction entirely. Directions and `userTags` are the source of truth; `styleTags`, `colors`, `aesthetics`, `silhouettes`, and `stylingPatterns` are derived again after edits. Users need at least one direction or personal tag to continue. The analysis summary is descriptive reference text and is not regenerated when a user edits details.

Photo changes never clear manual tags. After any nested edit or removal, a fresh analysis is staged for review: users choose **Keep my edits** or **Replace styles with new analysis**. Replacement keeps the latest manual tags, avoidances, and user notes. Continuing while a new analysis is pending uses the current profile. Invalid uploads and failed requests leave edits intact; stale responses are discarded. Removing all photos keeps the profile so it can still be used or edited.

Drafts are saved under `travel-stylist.style-draft.v1`; confirmation stores the complete profile under the existing `travel-stylist.confirmed-profile.v1`. Both use this tab's session storage. Older tag-only profiles remain usable. Original images are never written to disk, storage, or logs; `visualReferenceIds` record provenance only and cannot retrieve original photos. Outfit requests carry the detailed profile and `media: []`.

Browser request: `{requestId, inputRevision, tags, photos: [{id, mimeType, data}]}` with plain base64 data. Response: `{requestId, inputRevision, styleTags, summary, suggestedProfile}`. `suggestedProfile` follows the proposed nested structure discussed in PR #2, with separate `summary`, `directions`, and `userTags`; A's nested planner support remains a coordination task. Requests accept 9 MB for images, 128 KB for complete outfit context, and 16 KB for other endpoints. Credentials stay on the server.

## Run A and B together

Set `GEMINI_API_KEY` in the root `.env`. Then, from the repository root:

```sh
python3 -m venv services/ai/.venv
services/ai/.venv/bin/python -m pip install -r services/ai/requirements.txt
npm run dev:full
```

Stop any existing app on port 3000 first. This starts A on loopback port 8001 and B on port 3000, waits for A's health check, and shares an in-memory service token between them. Both processes use the existing root Gemini key; no additional key copy or manual token is needed. Ctrl+C stops both. Override `PORT`, `AI_PORT`, or `OUTFIT_MODEL` if needed. `OUTFIT_MODEL` defaults to the configured `GEMINI_MODEL`, then `gemini-4-hydrogen`.

Live mode reuses A's 37 checked-in JPEG wardrobe photos and canonical `wd-*` IDs. B serves them under `/wardrobe-photos/` and sends absolute URLs based on `PUBLIC_APP_URL` (defaults to its loopback URL). A's default allowed media hosts in this launcher are `127.0.0.1,localhost`. For a separately deployed A service, configure `AI_BASE_URL`, `AI_SERVICE_TOKEN`, and a `PUBLIC_APP_URL` that A can reach; allow B's media hostname in A's `MEDIA_ALLOWED_HOSTS`. Never derive these image URLs from browser input or the request Host header.

B forwards the saved style, trip, weather, and selected canonical wardrobe to A's `/v1/outfit-plans`, with `outfitCount` set to the number of trip days and `useWardrobeImages: true`. The server/browser timeouts are 120/130 seconds. B validates complete date coverage and selected IDs, accepts longer prose warnings/tips, and preserves A's missing items for shopping. Failed or invalid AI results never become mock outfits.

**Nested-style compatibility:** A's current profile model declares the flat fields but not `directions`. B still sends the complete profile, and also supplies the confirmed direction groups, manual tags, and summary through A's existing `preferences` field. The adapter explicitly prioritizes edited details. This bridge can be removed once A's native nested-profile support lands. No A source code is changed by the bridge. Original style photos remain transient; only wardrobe photos are fetched by A.

Photo onboarding continues to use B's direct Gemini adapter. The earlier `POST /api/style-analysis` → A's `POST /v1/style-analysis` adapter remains available separately; native A photo onboarding is not switched on by this integration.

The server binds to loopback only. Public deployment still requires authentication, quotas/rate limits, HTTPS, and a deployment-specific origin policy.

## Trip setup

After confirming a style profile, choose **Next: plan my trip**. Search for a city, select the intended country/region, and choose 1–7 inclusive destination-local dates. B suggests five distinct places total for the trip; places belong to the trip as a whole. Remove any, add named custom places, and confirm. There are no per-place visit dates. Zero places and more than five edited places are allowed. Confirmation saves a `trip` object in session storage under `travel-stylist.confirmed-trip.v1` with the fields expected by `/v1/outfit-plans`.

The initial curated catalog covers New York City, Paris, and Tokyo, drawing from official tourism guides linked in `data/attractions/catalog.mjs`. Five suggestions are sampled from six highlights per city; they are not a live popularity ranking or a date-specific availability check. These cities resolve locally. Other city searches use the [Open-Meteo geocoding API](https://open-meteo.com/en/docs/geocoding-api), backed by GeoNames; select a returned city to avoid ambiguity. Use city and country (for example, `Paris, US`) when needed. Cities without a curated catalog support custom places and open days. Search terms for these cities are sent to Open-Meteo; credentials are not needed for this development integration.

Changing a destination clears its place list. Changing trip dates retains the entire place list; every edit clears trip confirmation. Invalid dates block place editing and confirmation. The saved trip restores on reload. Confirmation fetches daily weather; unavailable days retain null measurements. Confirmation saves the trip and opens `/wardrobe`; weather stays behind the scenes for outfit generation. The page generates real outfits in live mode, or explicitly labeled mock outfits in demo mode. Custom places are user-supplied names scoped to the chosen destination, not verified venues.

Trip tests cover real dates/DST/leap years, the seven-day limit, unique suggestions, custom places, removal of legacy per-place dates, unknown weather, location-provider failures, and HTTP endpoints. Public provider use and hosting limits should be reviewed before deployment.


## Google Places suggestions

Set `GOOGLE_MAPS_API_KEY` in the root `.env`, enable **Places API (New)** and billing in its Google Cloud project, and restart `npm run dev`. Restrict the key to Places API and the server's IP where available; it is used only on B's server. No key means manual place entry still works, with an unavailable-suggestions message. Live Google results have not been verified without a configured key.

Typing two or more characters in **Add your own place** triggers a debounced lookup. B calls [Autocomplete (New)](https://developers.google.com/maps/documentation/places/web-service/place-autocomplete) with a 25 km circle around the selected destination and the destination's country. This is a vicinity restriction, not an exact city boundary. For Paris, `Cartier` may return Fondation Cartier and other nearby matches; Google's current data determines results and ordering. We do not hard-code or promise a particular result.

Selecting a suggestion calls [Place Details (New)](https://developers.google.com/maps/documentation/places/web-service/place-details) with the same session token, then adds the resolved place name, address, ID, and coordinates to the trip. Manual names remain an alternative. Session tokens rotate after selection or destination changes; stale responses are discarded. Both endpoints return errors without substituting fabricated Google results.

Google results show attribution. Per [Google's storage guidance](https://developers.google.com/maps/documentation/places/web-service/policies), only Google place IDs are saved in session storage; names, addresses, coordinates, and attributions are fetched again on reload. Other places retain the existing session-saving behavior. Fetching fresh details requires a working Google integration; a failed restore leaves the saved references intact. Public deployment still needs the application's terms/privacy disclosures and request quotas.


## Daily weather

Confirming a trip calls B's `POST /api/weather` with its resolved destination and date range. B uses the [Open-Meteo Forecast API](https://open-meteo.com/en/docs), requests Celsius and the destination timezone, and maps daily minimum/maximum temperature plus maximum precipitation probability into the agreed `WeatherDay` objects. This development integration requires no API key. Precipitation probability includes rain and snow; the UI labels it accordingly.

The requested forecast window is today through the next 15 days in the destination timezone. Past dates and dates beyond that window remain `unavailable`; partial coverage keeps available days. There are no climate estimates or invented values. Missing individual measurements remain null. Invalid provider data, rate limits, and timeouts return explicit warnings and allow trip confirmation with unavailable weather.

The confirmed trip saves one weather record per day, including forecast `sourceUrl` and `fetchedAt`. Confirming or reconfirming the trip fetches weather before navigating to `/wardrobe`. Weather is used as model context and is not displayed as forecast cards or outfit temperature lines. The wardrobe page validates and restores saved weather, including on reload. **Edit trip** restores the editable trip without redirecting; reconfirm to refresh weather. Editing inputs cancels a pending confirmation. Failed weather fetches retain explicit unavailable readings. Forecasts are for the city; per-place dates are not collected.

Tests cover dates at the forecast boundary, destination timezones, partial/missing readings, units, source metadata, validation, provider failures, HTTP routing, and trip serialization. A live Paris request was verified during development; forecasts remain time-dependent.


## Demo wardrobe and daily outfits

After confirming a trip, a separate `/wardrobe` page shows 37 sample wardrobe photos (A's fixtures in `services/ai/tests/fixtures/wardrobe`) in both live and demo mode. The trip page uses a compact selected-place list with removal controls, a selection count, and inline custom-place entry. All are initially included; uncheck any unsuitable items and choose **Generate my outfits**. The UI sends the confirmed style profile, trip-level places, daily weather, selected canonical wardrobe records/version, and `media: []` to B's `POST /api/outfit-plans`. B forwards to A (or the labeled local mock) at `POST /v1/outfit-plans` and validates the result before displaying it.

The mock returns one look per day and rotates selected tops, bottoms, and shoes. It adds selected outerwear below a forecast low of 12 °C and a scarf below 5 °C. Missing categories become missing-item descriptors; precipitation probability of at least 50% adds an optional umbrella descriptor. Unknown weather is never treated as zero. These are deterministic demo rules, not Gemini reasoning: free-text preferences and avoidances are passed through but not interpreted. Users should uncheck unsuitable items. No item is represented as a purchasable product or verified for weather protection.

Wardrobe choices and trip edits invalidate old outfit results; pending results are discarded if their request identity or input revision is stale. Output validation checks date coverage, garment IDs, unique outfit/gap IDs, and required fields. Attractions stay at trip level, with empty daily `attractionIds`. Results stay in page memory and can be regenerated after reload. Entering `/wardrobe` without a confirmed style returns to onboarding; missing or invalid trips show a link back to trip setup. Browser back/forward restores fresh state to avoid outdated outfits. Inputs remain available after request errors.

The catalogs and image provenance are documented in [demo wardrobe](../../data/demo-wardrobe/README.md). Both modes serve A's photo fixtures and display source credits; the legacy SVG catalog is only used by unit tests. No synthetic fallback is used for failed upstream responses.


## Place thumbnails

Every curated spot has one local landmark photograph. The 18 photos are mapped by stable place ID, with author/license/source-file links in `data/attractions/photos.json` and the expandable **Photo credits** list. See [photo sources](../../data/attractions/photos/README.md). No external image requests are needed while browsing the trip.

Custom places (including Google-resolved places without a bundled image) offer a **+ Photo** picker, accepting one JPG/PNG/WebP up to 2 MB. These previews stay in page memory, are discarded on navigation/reload, and are never added to trip storage or sent to Gemini/outfit endpoints. A removed place releases its photo preview. Source photographs are displayed as cover-cropped thumbnails; photos are visual context only, not validation of opening hours or venue details.


## Shop this piece: real product search

Each outfit's existing `missingItems` is rendered with **Shop this piece**. B uses A's `id`, `description`, `reason`, `priority`, and `searchQuery` directly; shopping does not generate missing items or infer additional garment requirements. In local demo mode, the existing mock outfit response exercises the same component. Product search itself is live, not mocked.

Clicking sends `{requestId, inputRevision, missingItem: {id, searchQuery}}` to `POST /api/products/search`. B calls the read-only `search_catalog` tool at `https://mcp.shop.com/` and returns up to five normalized products with `id`, `variantId`, `title`, `merchant`, `url`, `imageUrl`, `price: {amount, currency}`, `available`, and `options`. The response echoes the request identity, `missingItemId`, `query`, and provider `warnings`. No Shop API key or shopper sign-in is required for this anonymous search. See [Shop HTTP quickstart](https://shop.dev/docs/quickstart) and [catalog search](https://shop.dev/docs/search).

Search runs only on a user's click. It does not send style photos, profile data, the trip destination, or a guessed delivery address. There is no size, budget, or gender filter in this first slice. Returned currency is displayed explicitly using its minor-unit precision. Cards identify the shown variant and its availability; users check other options in the merchant store. Original product URLs, including attribution parameters, are preserved. Only public HTTPS product links are accepted; images load directly from `cdn.shopify.com` with a fallback if missing or broken.

Loading, empty results, provider warnings, rate limits, timeout, and retry are handled without fabricated listings. Closing a panel or changing the outfit selection cancels browser requests and discards stale results. Reopening makes a fresh search; results are not persisted. Tests inject Shop responses and cover request isolation, currency handling, URL validation, partial/invalid data, errors, and stale identity. The browser was checked first with mock outfit missing items and then with A's real Gemini output and live Shop results.

### Shopping bag and checkout

Results include available returned `variants`, each with the exact seller `shop` and a short-lived signed `offerToken`. The user explicitly selects an option, adds it to an in-app bag, and can change quantities or remove it. Only variants returned by Shop are offered; other sizes can be explored through the store link. The bag is stored in session storage and grouped by merchant. Estimates are kept separate by currency.

**Review checkout** posts `{requestId: UUID, items: [{offerToken, quantity}]}` to `POST /api/checkout`. The server verifies the signed offers and calls Shop MCP `create_checkout` with exact merchant and variant IDs. One checkout covers one merchant. Repeated requests for an unchanged bag reuse the same UUID idempotency key, including after a timeout. Search and adding to the local bag do not create merchant checkouts.

The app displays returned line items, totals, messages, and legal links. **Continue to secure payment** opens the unchanged merchant `continue_url` in a new tab. This is an in-app bag and checkout review with hosted payment, not embedded card collection. No `complete_checkout` call, automatic purchase, payment credentials, or order-success claim is implemented. Checkout URLs stay in memory and are excluded from logs and session storage. No Shop API key is needed for anonymous checkout creation. [Official checkout guide](https://shop.dev/docs/checkout).

Offers expire after 30 minutes or a server restart; search again to refresh them. A final live payment and merchant-specific shipping/tax behavior require user testing. OAuth, embedded Shop Pay, order tracking, and synchronized merchant cart editing remain separate work.

### Simplified wardrobe UI

Photo tiles show wardrobe selections. After generation the wardrobe collapses, dates switch between daily looks, and styling explanations stay under **Styling notes**. A **Bag** button opens a keyboard-accessible modal drawer. Product prices and variants remain visible; no payment is attempted until the shopper continues to the merchant.
