# AI Service

Gemini-powered style analysis, outfit planning, shopping-gap detection and outfit previews. See [AI workstream docs](../../docs/ai/README.md), [model choices](../../docs/ai/models.md) and the [A/B API agreement](../../docs/integrations/ai-app-api.md).

## Setup

```bash
cd services/ai
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then paste your Gemini API key into .env
```

## Run the API

```bash
uvicorn src.api.app:app --port 8001 --reload
# interactive docs: http://localhost:8001/docs
```

If `AI_SERVICE_TOKEN` is set in `.env`, every call needs `Authorization: Bearer <token>`. Unset = no auth (local dev).

Set `MEDIA_ALLOWED_HOSTS` (comma-separated) to the hosts B's media URLs use; unset = any http(s) host (local dev only).

| Endpoint | Python entry point | What it does | Typical time |
| --- | --- | --- | --- |
| `POST /v1/style-analysis` | `src.style_analysis.service.analyze_style(req)` | Tags + notes + images/videos (B's `readUrl`s) → `suggestedProfile` (with style `directions`, passed straight to outfit planning), per-media `observations`. Avoidances only from the user | ~12 s tags only, ~35–50 s with media |
| `POST /v1/outfit-plans` | `src.outfit_planning.planner.generate_outfits(req)` | Style profile + inspiration `media` + wardrobe (incl. photos from `imageUrl`) + trip with per-day weather → outfits (default 3, spread over the trip days) with missing items and `shoppingGaps` | ~20–30 s, ~35 s with 4 inspiration images |
| `POST /v1/shopping-gaps` | `src.outfit_planning.shopping.identify_shopping_gaps(outfits, wardrobe)` | Outfits → deduplicated shop searches. No model call. Already included in the outfit-plans response | instant |
| `POST /v1/outfit-previews` | `src.preview_generation.visualize.visualize_outfit(req)` | One outfit → generated image (`mode: "outfit"` studio, or `"destination"` scene). Gemini 4 writes the image prompt; a Gemini image model draws it. Image served at the returned `imageRef` | ~14 s |
| `GET /health` | | Liveness | |

Examples (real outputs from the demo run):
- Style analysis: [request](examples/style_analysis_request.json) / [response](examples/style_analysis_response.json) (URLs point at a local test server: `cd tests/fixtures/media && python3 -m http.server 8799`)
- Request: [examples/outfit_plan_request.json](examples/outfit_plan_request.json) (3-day Kyoto trip, 13 text-only wardrobe items)
- With wardrobe photos: [request](examples/outfit_plan_request_wardrobe_images.json) / [response](examples/outfit_plan_response_wardrobe_images.json) (10 items from `tests/fixtures/wardrobe/`; serve them with `cd tests/fixtures && python3 -m http.server 8799`)
- Response: [examples/outfit_plan_response.json](examples/outfit_plan_response.json)
- With inspiration media + forecast/climate weather: [request](examples/outfit_plan_request_inspiration.json) / [response](examples/outfit_plan_response_inspiration.json) (serve with `cd tests/fixtures && python3 -m http.server 8799`; images come from the local-only fixture pack)
- Preview response: [examples/outfit_preview_response.json](examples/outfit_preview_response.json)

```bash
curl -X POST localhost:8001/v1/outfit-plans -H 'content-type: application/json' \
  -d @examples/outfit_plan_request.json

# preview: send one outfit from the plan response + the wardrobe
curl -X POST localhost:8001/v1/outfit-previews -H 'content-type: application/json' \
  -d '{"outfit": <one outfit>, "wardrobe": [...], "destinationName": "Kyoto", "mode": "destination"}'
```

Errors use the contract's body `{requestId, inputRevision, error: {code, message, retryable}}`: 400 `INVALID_REQUEST`/`MEDIA_UNREADABLE`, 401 `UNAUTHORIZED`, 403 `MEDIA_FORBIDDEN`, 413 `PAYLOAD_TOO_LARGE`, 415 `UNSUPPORTED_MEDIA`, 502 `INVALID_UPSTREAM`, 503 `AI_UNAVAILABLE`. Preview failures never error: they return `status: "unavailable"` so the outfit flow continues.

### Response fields beyond the A/B contract

All additive and optional; see [docs/ai/contract-notes.md](../../docs/ai/contract-notes.md).

- Outfit: `name`, `itemsByCategory` (each piece has `owned: true/false`), `occasions`, `styleConnections`, `inspirationReferenceIds` (inspiration media that shaped it), `weatherKind` (the weather it was planned for)
- WeatherDay: `kind: "climate"` (seasonal estimate for dates beyond the forecast), optional `conditions`, `windKph`, `humidityPct`
- MissingItem: `category`, `color`, `silhouette`, `material`, `styleDescriptors`
- Response: `shoppingGaps` (input for the Shopify integration), `model`
- StyleProfile: `directions` (dominant/secondary/minor, each with its own colors, silhouettes, styling patterns, key pieces and media ids; see [proposal](../../docs/ai/proposals/style-profile-directions.md))
- Outfit: `directionId` (the direction that leads it; minor directions only add accents)
- Style analysis response: `styleDirections` (duplicate of `suggestedProfile.directions`, kept for now), `model`
- Request: `preferences` (free text), `outfitCount` (default 3), `useWardrobeImages` (default true), `useInspirationMedia` (default true)
- Response: `wardrobeImagesUsed` (ids whose photo Gemini saw), `inspirationMediaUsed`

## Viewing a plan

```bash
python tools/view_plan.py examples/outfit_plan_request_inspiration.json \
    examples/outfit_plan_response_inspiration.json --open
```

Renders one HTML page per plan (in `generated/plan_views/`, gitignored): wardrobe photos per outfit, missing items, that day's weather, which inspiration media each outfit cited, warnings and shopping gaps. Local fixture URLs are mapped to `tests/fixtures/`, so the fixture server doesn't need to be running.

## Tests

```bash
python tests/smoke_test.py            # 30 offline checks + 8 checks on one live Gemini call
python tests/smoke_test.py --offline  # no API calls
```

## Experiments

```bash
python hello_gemini.py --list-models                    # models your key can use
python -m src.style_analysis.extract --runs 2           # Experiment 01
python -m src.style_analysis.experiment_02 --runs 2     # Experiment 02
```
