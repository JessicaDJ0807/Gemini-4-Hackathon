# A and B API specification

Status: B saves a full editable style profile with nested directions and manual tags, aligned with the proposal in PR #2. Uploaded inspiration photos are analyzed through B's Gemini adapter. Live outfit generation is connected to A; native nested-profile adoption remains pending, with B passing grouped style details through A's existing `preferences` field.

## Ownership and flow

**A owns:** daily outfit generation and the agreed A-hosted AI interfaces. B currently provides a Gemini photo-to-profile adapter for onboarding.

**B owns:** user input, uploads, location resolution, weather, attraction suggestions, user confirmation, wardrobe data, and displaying the result.

The user enters a location and start/end dates. B resolves the location and suggests 3–5 popular attractions for the **whole trip** from a curated or provider-backed candidate pool. Users can remove suggestions and add custom places. Places belong to the whole trip; users do not assign per-place dates. Only confirmed places are sent to A. The edited selection may contain fewer than three or more than five places. A custom place needs a name; coordinates and an image are optional.

The two A-hosted endpoints below remain available as integration contracts; the current UI skips A's style-analysis endpoint and uses the browser-facing photo adapter described below. C/3D, generated previews, product search, checkout, and asynchronous job APIs are outside this agreement.

## Shared conventions

- Requests and responses use JSON. B calls A server-to-server over HTTPS in deployment; local development may use HTTP.
- Configure A's base URL and service credential outside this document. Use `Authorization: Bearer <service-token>`; keep the token server-side.
- B creates `requestId` and `inputRevision`; A echoes both unchanged. B increments the revision when any input changes and accepts a response only if both values still match its active request.
- IDs are opaque strings. Dates are real `YYYY-MM-DD` calendar dates in the destination timezone. Example timestamps/dates below are fixture values.
- Required arrays may be empty where explicitly allowed. Missing data is not represented by an invented value.
- Success is HTTP 200 with the final result. This first contract uses synchronous responses; timeouts and payload-size limits must be agreed before deployment.

## Shared data objects

| Object | Required fields | Optional fields / rules |
| --- | --- | --- |
| `StyleProfile` | `styleTags: string[]`, `colors: string[]`, `avoidances: string[]`, `visualReferenceIds: string[]` | B requires at least one style direction or manual tag. Optional extension fields: `summary`, `directions`, `userTags`, `aesthetics`, `silhouettes`, `stylingPatterns`. Flat fields are derived from the edited nested profile. B's native handoff requires A's implementation in PR #5. |
| `MediaRef` | `id: string`, `contentVersion: string`, `kind: "image" or "video"`, `mimeType: string`, `readUrl: string`, `expiresAt: timestamp` | B supplies an authorized HTTPS URL usable by A through the processing deadline. JPEG/PNG/WebP images and MP4/WebM video are proposed formats, subject to A's actual decoder support. |
| `Destination` | `id: string`, `name: string`, `countryCode: string`, `latitude: number`, `longitude: number`, `timezone: string` | B resolves these; the user only enters the location. |
| `Attraction` | `id: string`, `name: string`, `source: "curated", "provider", or "user"`, `activityTags: string[]` | `notes: string`, `coordinates: {latitude, longitude}`. B scopes all records to the selected destination. No per-place date is sent. |
| `WeatherDay` | `date`, `kind: "forecast" or "unavailable"`, `minTempC`, `maxTempC`, `precipitationProbabilityPct` | Measurements are numbers or null; unavailable requires all three to be null. Forecast requires `sourceUrl` and `fetchedAt`. Rain probability is 0–100. |
| `WardrobeItem` | `id: string`, `name: string`, `imageUrl: string`, `category`, `color: string`, `styleTags: string[]` | Category is top, bottom, dress, outerwear, shoes, or accessory. B provides real permitted image references for live AI execution. |
| `MissingItem` | `id`, `description`, `searchQuery`, `priority: "essential" or "optional"`, `reason` | A describes a need; no invented merchant, price, stock, or product ID. |

### Current B onboarding: manual tags and saved style details

No preset tags or analysis-submit button are shown. Users can enter personal tags directly, or upload 1–3 JPG/PNG/WebP inspiration photos up to 2 MB each. B's `POST /api/style-inspiration` accepts `{requestId, inputRevision, tags, photos: [{id, mimeType, data}]}`; `data` is base64 and IDs identify individual photos. B calls Gemini server-side and returns `{requestId, inputRevision, styleTags, summary, suggestedProfile}`. Server/browser photo timeouts are 55/60 seconds.

The proposed nested profile discussed in PR #2 is implemented on B's side:

- `summary`: AI-generated description (up to 500 characters), separate from optional user `notes`.
- `directions`: up to three groups, each with stable-within-profile `id`, `name`, `description`, `strength` (`dominant`, `secondary`, `minor`), `source` (`media`, `tags`, `both`), `colors`, `silhouettes`, `stylingPatterns`, `keyPieces`, and `visualReferenceIds`. At most one dominant group. Up to eight labels per detail category.
- `userTags`: up to 20 user-entered labels; preserved independently of generated styles. Labels are limited to 100 characters and deduplicated case-insensitively.
- `styleTags`: union of manual tags and direction names. `aesthetics`: direction names. Flat `colors`, `silhouettes`, `stylingPatterns`, and `visualReferenceIds`: unions of their per-direction values. Nested edits are authoritative; removed labels cannot reappear from stale flat fields.

The main UI shows compact style labels; details are saved for outfit reference and editable under an optional disclosure. New analysis after nested edits is staged for explicit replacement or dismissal, preserving manual tags either way. Empty/failed results retain current preferences. Confirmation saves the full profile and passes it into outfit requests. Manual-only profiles work without Gemini, and older tag-only saves still load.

Original photos remain transient. Saved photo IDs are provenance, not downloadable `MediaRef`s; outfit `media` stays empty. Until A accepts nested fields natively, B passes their JSON through the existing `preferences` field alongside the derived flat profile. The A-hosted style-analysis adapter below remains separate from B's direct Gemini photo flow. See [B setup](../../apps/web/README.md#automatic-photo-labels-with-gemini).

## 1 Style analysis

`POST /v1/style-analysis`

**Request:** `requestId`, `inputRevision`, `tags`, `avoidances`, `media` are required. `notes` is optional. Tags or notes can be used without media; the request must contain at least one nonempty tag, note, or media input. Avoidances alone do not establish a positive style direction.

```json
{
  "requestId": "style-001",
  "inputRevision": 1,
  "tags": ["minimal", "classic"],
  "avoidances": ["high heels"],
  "notes": "Comfortable outfits for walking.",
  "media": []
}
```

**Response:** `requestId`, `inputRevision`, `suggestedProfile`, `observations`, and `warnings` are required. An observation has `mediaId` and `detail`, with optional `timestampSeconds` for video. Observations can be empty for tags-only input. Media IDs must refer to supplied sources and video timestamps must lie within the clip.

```json
{
  "requestId": "style-001",
  "inputRevision": 1,
  "suggestedProfile": {
    "styleTags": ["minimal", "classic"],
    "colors": ["cream", "navy", "black"],
    "avoidances": ["high heels"],
    "visualReferenceIds": []
  },
  "observations": [],
  "warnings": []
}
```

B lets the user accept or edit suggestions before committing the profile. A preserves explicit avoidances. Suggestions from uncertain visual cues remain editable; inferred fabric, fit, or weather resistance are not verified facts.

## 2 Daily outfit generation

`POST /v1/outfit-plans`

**Request:** `requestId`, `inputRevision`, `styleProfile`, `trip`, `wardrobeVersion`, `wardrobe`, and `media` are required. B’s live adapter additionally sends `outfitCount` equal to the trip-day count, `useWardrobeImages: true`, and `preferences` containing confirmed nested style details. Wardrobe URLs are canonical, absolute URLs reachable by A. Live server/browser timeouts are 120/130 seconds. B rejects missing-day plans rather than inventing replacements.

`trip` contains `destination`, `startDate`, `endDate`, `attractions`, and `weather`, plus optional `notes`. Attractions are full confirmed place records, not just IDs or the unaccepted suggestion list. The current UI sends `media: []` and the complete user-confirmed nested style profile. `visualReferenceIds` may retain photo provenance IDs; they cannot retrieve the original images. Raw inspiration photos are not handed to A.

This shortened one-day example uses synthetic garment URLs on a reserved example domain. The URLs are not live assets.

```json
{
  "requestId": "outfits-001",
  "inputRevision": 2,
  "styleProfile": {
    "styleTags": ["minimal"],
    "colors": [],
    "avoidances": [],
    "visualReferenceIds": []
  },
  "trip": {
    "destination": {
      "id": "nyc", "name": "New York City", "countryCode": "US",
      "latitude": 40.7128, "longitude": -74.0060,
      "timezone": "America/New_York"
    },
    "startDate": "2026-11-24",
    "endDate": "2026-11-24",
    "attractions": [
      {
        "id": "custom-bookstore", "name": "My saved bookstore",
        "source": "user", "activityTags": ["indoor", "shopping"],
        "notes": "Exact venue to be confirmed."
      }
    ],
    "weather": [
      {
        "date": "2026-11-24", "kind": "unavailable",
        "minTempC": null, "maxTempC": null,
        "precipitationProbabilityPct": null
      }
    ]
  },
  "wardrobeVersion": "demo-1",
  "wardrobe": [
    {
      "id": "top-01", "name": "Cream sweater",
      "imageUrl": "https://assets.example/top-01.png",
      "category": "top", "color": "cream", "styleTags": ["minimal"]
    },
    {
      "id": "bottom-01", "name": "Black trousers",
      "imageUrl": "https://assets.example/bottom-01.png",
      "category": "bottom", "color": "black", "styleTags": ["minimal"]
    },
    {
      "id": "shoes-01", "name": "Flat walking shoes",
      "imageUrl": "https://assets.example/shoes-01.png",
      "category": "shoes", "color": "black", "styleTags": ["minimal"]
    }
  ],
  "media": []
}
```

**Response:** `requestId`, `inputRevision`, `outfits`, and `warnings` are required. Every outfit requires `id`, `date`, `attractionIds`, `wardrobeItemIds`, `rationale`, and `missingItems`. `stylingTips` is optional.

```json
{
  "requestId": "outfits-001",
  "inputRevision": 2,
  "outfits": [
    {
      "id": "look-01",
      "date": "2026-11-24",
      "attractionIds": [],
      "wardrobeItemIds": ["top-01", "bottom-01", "shoes-01"],
      "rationale": "A simple outfit follows your minimal style tags. Check actual weather before deciding on an outer layer.",
      "missingItems": [],
      "stylingTips": ["Adjust layers after checking the forecast."]
    }
  ],
  "warnings": ["Weather is unavailable; this is not a weather-verified outfit."]
}
```

### Output rules

- Initial planning limit: 1–7 inclusive trip days; end must not precede start.
- B supplies one weather record per day, including unknown days. A returns 1–2 outfits for every trip day.
- Outfit and missing-item IDs are unique within the response. Garment IDs must exist in the supplied wardrobe.
- Attractions provide trip-level context. `attractionIds` is empty in each daily outfit for this MVP; the response must not invent a daily visit schedule. Trips without attractions remain valid.
- A does not invent venue rules or weather conditions. Unknown values remain unknown.
- B validates IDs, date coverage, and request identity before displaying a result. An invalid or incomplete response is shown as an error, not silently repaired with fixture data.

## Errors

All failures use the same body; `requestId` and `inputRevision` echo parsed values when available, otherwise null.

```json
{
  "requestId": "outfits-001",
  "inputRevision": 2,
  "error": {
    "code": "AI_UNAVAILABLE",
    "message": "Outfit generation is temporarily unavailable.",
    "retryable": true
  }
}
```

| HTTP status | Use |
| --- | --- |
| 400 | Malformed JSON, invalid fields, dates, or references |
| 401 / 403 | Missing/invalid service authentication or unauthorized media |
| 413 / 415 | Payload too large or unsupported media format |
| 429 | Rate limit; include `Retry-After` when known |
| 502 / 503 | Invalid upstream result or unavailable AI provider |
| 504 | Upstream generation timeout |

B preserves user inputs on failure and offers retry only when appropriate. A timeout does not prove that upstream processing stopped; no background-job recovery or exactly-once retry guarantee is defined here.

## Items to confirm together before implementation

1. A's actual base URL and whether these two endpoint paths match its chosen service.
2. Media delivery: B-issued authorized read URLs as proposed, or an agreed multipart alternative.
3. Supported formats, maximum sizes/duration, processing timeouts, and request limits.
4. One real success and error example for each endpoint.

B can build the UI with the JSON examples while A implements the agreed responses. The examples establish the intended shape, not model accuracy or a running integration.
