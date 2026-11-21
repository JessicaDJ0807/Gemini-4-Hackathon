# A and B API specification

Status: proposed agreement for the first A/B integration. These endpoint paths are proposals, not running services. This document is the entire proposed change; no implementation or README edits are included.

## Ownership and flow

**A owns:** style analysis and daily outfit generation.

**B owns:** user input, uploads, location resolution, weather, attraction suggestions, user confirmation, wardrobe data, and displaying the result.

The user enters a location and start/end dates. B resolves the location and suggests 3–5 popular attractions for the **whole trip** from a curated or provider-backed candidate pool. Users can remove suggestions, add custom places, and assign places to dates. Only confirmed places are sent to A. The edited selection may contain fewer than three or more than five places. A custom place needs a name; coordinates and an image are optional.

The first integration has two A-hosted endpoints. C/3D, generated previews, product search, checkout, and asynchronous job APIs are outside this agreement.

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
| `StyleProfile` | `styleTags: string[]`, `colors: string[]`, `avoidances: string[]`, `visualReferenceIds: string[]` | `notes: string`; `aesthetics`, `silhouettes`, `stylingPatterns` as string arrays. At least one affirmative preference must be confirmed before outfit planning. |
| `MediaRef` | `id: string`, `contentVersion: string`, `kind: "image" or "video"`, `mimeType: string`, `readUrl: string`, `expiresAt: timestamp` | B supplies an authorized HTTPS URL usable by A through the processing deadline. JPEG/PNG/WebP images and MP4/WebM video are proposed formats, subject to A's actual decoder support. |
| `Destination` | `id: string`, `name: string`, `countryCode: string`, `latitude: number`, `longitude: number`, `timezone: string` | B resolves these; the user only enters the location. |
| `Attraction` | `id: string`, `name: string`, `source: "curated", "provider", or "user"`, `activityTags: string[]` | `date: ISODate`, `notes: string`, `coordinates: {latitude, longitude}`. B scopes all records to the selected destination. No date means selected but unscheduled. |
| `WeatherDay` | `date`, `kind: "forecast" or "unavailable"`, `minTempC`, `maxTempC`, `precipitationProbabilityPct` | Measurements are numbers or null; unavailable requires all three to be null. Forecast requires `sourceUrl` and `fetchedAt`. Rain probability is 0–100. |
| `WardrobeItem` | `id: string`, `name: string`, `imageUrl: string`, `category`, `color: string`, `styleTags: string[]` | Category is top, bottom, dress, outerwear, shoes, or accessory. B provides real permitted image references for live AI execution. |
| `MissingItem` | `id`, `description`, `searchQuery`, `priority: "essential" or "optional"`, `reason` | A describes a need; no invented merchant, price, stock, or product ID. |

B retains original images/videos and gives A usable references; extracted tags alone do not replace the original media. B authorizes sources before constructing requests. A reads only the agreed media hosts/transport and does not treat arbitrary browser-submitted URLs as trusted. Signed URLs and service credentials must not enter logs.

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

**Request:** `requestId`, `inputRevision`, `styleProfile`, `trip`, `wardrobeVersion`, `wardrobe`, and `media` are required.

`trip` contains `destination`, `startDate`, `endDate`, `attractions`, and `weather`, plus optional `notes`. Attractions are full confirmed place records, not just IDs or the unaccepted suggestion list. The media array contains exactly the original reference IDs retained in the confirmed profile, with current content versions; it may be empty.

This shortened one-day example uses synthetic garment URLs on a reserved example domain. The URLs are not live assets.

```json
{
  "requestId": "outfits-001",
  "inputRevision": 2,
  "styleProfile": {
    "styleTags": ["minimal"],
    "colors": ["cream", "black"],
    "avoidances": ["high heels"],
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
        "date": "2026-11-24", "notes": "Exact venue to be confirmed."
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
      "attractionIds": ["custom-bookstore"],
      "wardrobeItemIds": ["top-01", "bottom-01", "shoes-01"],
      "rationale": "A neutral outfit with flat shoes follows your style and walking preferences. Check actual weather before deciding on an outer layer.",
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
- Referenced attractions must be confirmed and assigned to that outfit's date. Unscheduled places do not become assumed daily visits. Days without attractions remain valid.
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
