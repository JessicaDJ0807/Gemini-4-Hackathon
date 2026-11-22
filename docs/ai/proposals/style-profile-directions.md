# Proposal: StyleProfile with style directions

**From:** A (AI) · **For:** B (app) · **Status:** proposal, not yet in the contract · **Date:** 2026-11-21

## Summary

Make `StyleProfile` a set of **style directions** (for example "Minimalist tailoring", dominant, and "Romantic cottagecore", minor). Each direction holds its own colors, silhouettes and styling patterns. Keep today's flat fields, filled automatically, so nothing B has built breaks.

## Problem

Today's profile is one flat list per attribute, in two slightly different shapes:

- `packages/contracts/`: `aesthetics`, `colors`, `silhouettes`, `stylingPatterns`, `avoidances`, `visualReferenceIds`
- `docs/integrations/ai-app-api.md`: `styleTags`, `colors`, `avoidances`, `visualReferenceIds`

A flat list describes the attributes of things, not a person's taste. It loses three things the product needs:

1. **Which traits belong together.** Someone who likes minimal tailoring *and* romantic dresses becomes `colors: [black, camel, pink floral]`, `silhouettes: [oversized blazer, puff sleeve]`. Outfit planning can't tell a puff sleeve doesn't go with the black blazer.
2. **How strong each preference is.** One outlier photo weighs the same as four consistent ones.
3. **Where a trait came from.** Whether it's a user-chosen tag or something seen in the photos.

Evidence: in [Experiment 01](../experiments/01-style-extraction-images.md), 8 mixed photos flattened into 11 aesthetics in one list. In [Experiment 02](../experiments/experiment_02.md), Gemini correctly separated the main and minor styles (16/16 runs), but the flat profile discards that split.

## Proposed shape

```jsonc
{
  // --- new ---
  "summary": "Minimal relaxed tailoring, with an occasional romantic floral piece.",
  "directions": [
    {
      "id": "dir-01",
      "name": "Minimalist tailoring",
      "strength": "dominant",
      "description": "Structured blazers and wide-leg trousers in a neutral palette.",
      "colors": ["camel", "black", "white"],
      "silhouettes": ["oversized blazer", "wide-leg trousers"],
      "stylingPatterns": ["tonal layering", "blazer over plain tee"],
      "keyPieces": ["blazer", "tailored trousers"],
      "visualReferenceIds": ["media-01", "media-03", "media-05"],
      "source": "media"
    },
    {
      "id": "dir-02",
      "name": "Romantic cottagecore",
      "strength": "minor",
      "description": "Floral midi dresses with puff sleeves and ribbons.",
      "colors": ["pink floral", "cream"],
      "silhouettes": ["puff sleeve", "midi dress"],
      "stylingPatterns": ["ribbon accents"],
      "keyPieces": ["floral dress"],
      "visualReferenceIds": ["media-02"],
      "source": "media"
    }
  ],
  "userTags": ["minimal"],

  // --- existing, unchanged meaning ---
  "avoidances": ["high heels"],
  "notes": "Comfortable outfits for walking.",
  "visualReferenceIds": ["media-01", "media-02", "media-03", "media-05"],

  // --- existing flat fields, derived from directions + userTags ---
  "styleTags": ["minimal", "Minimalist tailoring", "Romantic cottagecore"],
  "colors": ["camel", "black", "white", "pink floral", "cream"],
  "aesthetics": ["Minimalist tailoring", "Romantic cottagecore"],
  "silhouettes": ["oversized blazer", "wide-leg trousers", "puff sleeve", "midi dress"],
  "stylingPatterns": ["tonal layering", "blazer over plain tee", "ribbon accents"]
}
```

### Field rules

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| `directions` | `StyleDirection[]` | No (new) | Ordered strongest first. At most one `dominant`. May be empty for a tags-only profile |
| `direction.id` | string | Yes | Stable within the profile, so the user's edits and outfits can refer to it |
| `direction.strength` | `"dominant" \| "secondary" \| "minor"` | Yes | `minor` means a real but small preference, **not** a dislike |
| `direction.source` | `"media" \| "tags" \| "both"` | Yes | Where the direction came from |
| `direction.visualReferenceIds` | string[] | Yes | Only ids of supplied media; empty when `source` is `tags` |
| `direction.colors`, `silhouettes`, `stylingPatterns`, `keyPieces` | string[] | Yes (may be empty) | Plain, searchable words |
| `summary` | string | No (new) | 2–3 sentences, describes rather than advises |
| `userTags` | string[] | No (new) | Exactly what the user selected; never changed by A |
| `avoidances` | string[] | Yes | **User-stated only**, apply to all directions. A never infers dislikes (Experiment 02 showed it invents them) |
| Flat fields (`styleTags`, `colors`, `aesthetics`, `silhouettes`, `stylingPatterns`) | string[] | As today | Derived: the union of all directions plus `userTags`, deduplicated, strongest direction first |

## How it fits each endpoint

- **`POST /v1/style-analysis`:** `suggestedProfile` includes `directions`, `summary` and `userTags`, and the flat fields are still filled. (Today this information is in a separate `styleDirections` field; it would move inside the profile.)
- **User editing (B):** the user can rename or delete a direction, change its strength, or edit its lists. B sends the edited profile as is.
- **`POST /v1/outfit-plans`:** A builds each outfit mainly from one direction (mostly the dominant one, occasionally a secondary or minor one when it suits the day) and returns an optional `directionId` on each outfit. If a profile arrives **without** `directions`, A treats the flat fields as one direction, so old clients keep working.
- **Shopping gaps:** missing items take colors and silhouettes from the outfit's direction, so search queries match that style.

## Compatibility

- **Additive only.** No existing field is removed or renamed. Clients that ignore `directions` get the same flat profile as today.
- **Flat fields are output-only conveniences.** If B edits both a direction and a flat field, `directions` wins. B should edit directions once its UI supports them.
- The two existing shapes merge: `styleTags` (B's doc) and `aesthetics/silhouettes/stylingPatterns` (`packages/contracts/`) are both kept as derived fields.

## UI suggestion (B's call)

Show one card per direction, with its name, a strength badge, thumbnails of its reference photos, and editable chips for colors, silhouettes and patterns. Show avoidances once, at profile level. Until the cards exist, B can keep showing the flat `styleTags` and `colors`.

## Rollout

1. B and A agree on this doc; A updates `packages/contracts/` and the A/B API doc in one PR.
2. A ships it in `/v1/style-analysis` and `/v1/outfit-plans`, keeping the flat fields (about 1 hour of A-side work; the extraction already produces directions).
3. B adopts direction cards when ready; no deadline because nothing breaks.

## Questions for B

1. Is a nested structure workable in the profile-editing UI, or should directions be read-only at first?
2. Should users be able to *add* a direction by hand (`source: "tags"`), or only edit what the AI suggested?
3. Is `outfit.directionId` useful to display ("Today's look: Minimalist tailoring")?
4. Any limit on how many directions to show? A can cap it, for example at 3.
