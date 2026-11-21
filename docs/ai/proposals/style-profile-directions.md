# Proposal: StyleProfile with style directions

**From:** A (AI) · **For:** B (app) · **Status:** proposal, not yet in the contract · **Updated:** 2026-11-21

## Summary

Make `StyleProfile` a set of **style directions**, for example "Minimalist tailoring" (dominant) and "Romantic cottagecore" (minor). Each direction holds its own colors, silhouettes, styling patterns and reference photos. Today's flat fields stay and are filled automatically, so nothing B has built breaks.

## User journey (decided)

The user does **not** review or confirm the profile in the app. Their inspiration media and tags are enough:

```
1. User picks tags + uploads inspiration      →  POST /v1/style-analysis
2. B passes suggestedProfile through as is    →  POST /v1/outfit-plans
3. Outfits, previews, shopping as today
```

So directions are **data the AI uses**, not an editing screen. B may show them read-only ("We read your style as: Minimalist tailoring, with a touch of Romantic"), or not at all.

## Why

Both current shapes (`packages/contracts/` and `docs/integrations/ai-app-api.md`) are flat lists. A flat list loses:

1. **Which traits belong together.** Someone who likes minimal tailoring and one floral dress ends up with `colors: [black, camel, multicolor floral]`. Outfit planning can't tell the floral print doesn't go with the black blazer.
2. **How strong each preference is.** One outlier photo weighs the same as three consistent ones.

This matters more without a review step, because nobody corrects the profile before planning. Evidence: [Experiment 02](../experiments/experiment_02.md) found the dominant style correctly in 16/16 runs and kept outliers as separate minor styles, but the flat profile throws that split away.

## How directions are used

| Strength | Meaning | In outfit planning |
| --- | --- | --- |
| `dominant` | The main style; most of the inspiration | Leads most outfits |
| `secondary` | A real second style with solid support | Can lead an outfit when it suits the day's activities or weather |
| `minor` | A small preference, often a single photo. **Not** a dislike | Only a light accent (one color, accessory or detail) inside an outfit led by a stronger direction |

Each outfit follows **one** direction and says which one in `directionId`. Key pieces from two directions aren't mixed in one outfit.

## Example (real data, shortened)

From one end-to-end run: 3 minimal inspiration photos + 1 floral dress, tag "minimal", avoidance "high heels", then a 3-day Kyoto trip with 10 wardrobe photos. Lists are trimmed for readability.

### 1. B → A: `POST /v1/style-analysis`

```json
{
  "requestId": "style-demo-001",
  "inputRevision": 1,
  "tags": ["minimal"],
  "avoidances": ["high heels"],
  "notes": "Comfortable outfits for walking.",
  "media": [
    {"id": "min-01", "kind": "image", "mimeType": "image/jpeg", "readUrl": "https://media.example/min-01.jpg", "contentVersion": "1", "expiresAt": "2026-11-22T00:00:00Z"},
    {"id": "min-03", "kind": "image", "mimeType": "image/jpeg", "readUrl": "https://media.example/min-03.jpg", "contentVersion": "1", "expiresAt": "2026-11-22T00:00:00Z"},
    {"id": "min-05", "kind": "image", "mimeType": "image/jpeg", "readUrl": "https://media.example/min-05.jpg", "contentVersion": "1", "expiresAt": "2026-11-22T00:00:00Z"},
    {"id": "rom-02", "kind": "image", "mimeType": "image/jpeg", "readUrl": "https://media.example/rom-02.jpg", "contentVersion": "1", "expiresAt": "2026-11-22T00:00:00Z"}
  ]
}
```

### 2. A → B: `suggestedProfile` in the response

```jsonc
{
  "requestId": "style-demo-001",
  "inputRevision": 1,
  "suggestedProfile": {
    // NEW: one entry per style, strongest first
    "directions": [
      {
        "id": "dir-01",
        "name": "Minimalist Tailoring",
        "strength": "dominant",
        "description": "Clean, neutral-toned outfits built around relaxed blazers worn open with high-waisted tailored trousers or straight-leg denim.",
        "colors": ["camel", "white", "black", "light blue"],
        "silhouettes": ["relaxed blazer", "high-waisted tailored trousers", "high-waisted straight-leg jeans"],
        "stylingPatterns": ["open blazer layering", "neutral white base layers", "minimal accessories"],
        "keyPieces": ["camel oversized blazer", "black relaxed blazer", "light-wash straight-leg jeans"],
        "visualReferenceIds": ["min-01", "min-03", "min-05"],
        "source": "both"            // seen in the photos AND matches the user's "minimal" tag
      },
      {
        "id": "dir-02",
        "name": "Romantic Cottagecore",
        "strength": "minor",        // one photo: a small real preference, not a dislike
        "description": "Soft, vintage-inspired dressing with ditsy floral prints, puff sleeves and bow accessories.",
        "colors": ["white", "dark red", "multicolor floral"],
        "silhouettes": ["puff-sleeve dress with smocked bodice"],
        "stylingPatterns": ["floral print paired with statement hair bow"],
        "keyPieces": ["white ditsy floral puff-sleeve dress", "dark red ribbon hair bow"],
        "visualReferenceIds": ["rom-02"],
        "source": "media"
      }
    ],

    // EXISTING fields, unchanged meaning
    "avoidances": ["high heels"],                         // the user's own, never inferred
    "visualReferenceIds": ["min-01", "min-03", "min-05", "rom-02"],
    "notes": "The style centers on minimalist tailoring built around relaxed blazers ... A minor romantic cottagecore direction also appears through a ditsy floral puff-sleeve dress.",

    // EXISTING flat fields, now derived from the directions + the user's tags
    "styleTags": ["minimal", "Minimalist Tailoring", "smart casual", "romantic", "cottagecore"],
    "colors": ["camel", "white", "black", "light blue", "dark red", "multicolor floral"],
    "aesthetics": ["minimalist", "smart casual", "romantic", "cottagecore"],
    "silhouettes": ["relaxed blazer", "high-waisted tailored trousers", "puff-sleeve dress"],
    "stylingPatterns": ["open blazer layering", "minimal accessories", "floral print paired with statement hair bow"]
  },
  "observations": [
    {"mediaId": "min-01", "detail": "oversized blazer; cropped bandeau top; high-waisted straight-leg jeans ..."}
  ],
  "warnings": []
}
```

### 3. B → A: `POST /v1/outfit-plans`

B copies `suggestedProfile` into `styleProfile` **unchanged**, and sends the same inspiration media in `media`:

```jsonc
{
  "requestId": "outfits-demo-001",
  "inputRevision": 1,
  "styleProfile": { /* exactly the suggestedProfile from step 2, including directions */ },
  "trip": { "destination": {"id": "kyoto", "name": "Kyoto"}, "startDate": "2026-12-03", "endDate": "2026-12-05", "attractions": [ ... ], "weather": [ ... ] },
  "wardrobeVersion": "hackathon-wardrobe-fixtures-v1",
  "wardrobe": [ {"id": "wd-04", "name": "Beige tailored blazer", "category": "outerwear", "color": "beige", "imageUrl": "https://media.example/wd-04.jpg"}, ... ],
  "media": [ /* the same 4 inspiration MediaRefs */ ]
}
```

### 4. A → B: each outfit names its direction

```jsonc
{
  "outfits": [
    {
      "id": "look-02",
      "date": "2026-12-04",
      "directionId": "dir-01",                                   // NEW: led by Minimalist Tailoring
      "name": "Tailored Beige Blazer Smart-Casual",
      "wardrobeItemIds": ["wd-01", "wd-02", "wd-04", "wd-06", "wd-09", "wd-10"],
      "rationale": "For a mostly dry 4 to 12 C forecast, the structured beige blazer over the crisp white button-up and tee goes from Nishiki Market to an evening kaiseki dinner.",
      "styleConnections": [
        "Open relaxed beige blazer over a crisp white base borrowed from min-01 and min-05",
        "Low-heel walkable leather boots respecting the no high heels avoidance"
      ],
      "inspirationReferenceIds": ["min-01", "min-05"],
      "missingItems": []
    }
  ]
}
```

In this run all 3 outfits were led by `dir-01`, and the minor romantic direction didn't take over any day.

## Field rules

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| `directions` | `StyleDirection[]` | No (new) | Strongest first; at most one `dominant`. Empty for tags-only input without a clear style |
| `direction.id` | string | Yes | `dir-01`, `dir-02`, … unique within the profile |
| `direction.strength` | `"dominant" \| "secondary" \| "minor"` | Yes | `minor` is a small preference, never a dislike |
| `direction.source` | `"media" \| "tags" \| "both"` | Yes | Where the direction came from |
| `direction.visualReferenceIds` | string[] | Yes | Only ids of supplied media |
| `direction.colors`, `silhouettes`, `stylingPatterns`, `keyPieces` | string[] | Yes (may be empty) | Traits seen in that direction's own media |
| `avoidances` | string[] | Yes | **User-stated only**; apply to every direction |
| Flat fields (`styleTags`, `colors`, `aesthetics`, `silhouettes`, `stylingPatterns`) | string[] | As today | Derived: union of all directions plus the user's tags, deduplicated |
| `outfit.directionId` | string | No (new) | Must be a direction id from the request's profile; otherwise removed |

## Compatibility

- **Additive only.** No field is removed or renamed. A client that ignores `directions` gets the same flat profile as today.
- If `/v1/outfit-plans` receives a profile **without** `directions` (an old client, or a hand-built profile), it plans from the flat fields as it does today and leaves `directionId` empty.
- The response field `styleDirections` (already returned by `/v1/style-analysis`) stays for now; it duplicates `suggestedProfile.directions` and can be removed once B uses the new field.

## Contract changes this needs

Two sentences in `docs/integrations/ai-app-api.md` assume a confirmation step:

| Current text | Proposed |
| --- | --- |
| "At least one affirmative preference must be confirmed before outfit planning." | "The profile must contain at least one positive preference (a tag, a direction, or a note)." |
| "B lets the user accept or edit suggestions before committing the profile." | "B passes `suggestedProfile` to outfit planning unchanged. Showing it to the user is optional." |

## Status on the AI side

Already implemented on the `ai-multimodal` branch (all fields optional, so it works with or without this proposal): style analysis fills `suggestedProfile.directions`, outfit planning weights directions by strength and returns `directionId`, and invalid ids are removed.

## Questions for B

1. Will the app show the directions read-only (for example on the results screen), or not at all?
2. Is `outfit.directionId` useful to display ("Today's look: Minimalist Tailoring")?
3. OK to remove the duplicate `styleDirections` response field once you've switched?
