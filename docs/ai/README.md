# AI & Multimodal Workstream

Owner: **Person A**. This document tracks AI responsibilities independently of the overall [project README](../../README.md).

## Goals

1. **Style understanding:** Infer editable aesthetic preferences from selected tags and raw inspiration images/videos (including useful speech/audio cues).
2. **Outfit reasoning:** Select actual items from the synthetic wardrobe for each day using the style persona, relevant visual references, attractions, and weather.
3. **Missing-piece identification:** Describe requirements in terms the commerce module can search; do not generate fictitious purchasable products.
4. **Visual generation:** Create (a) approximate personalized try-on images and (b) aspirational destination look previews, on demand.
5. **Element 119 evidence:** Keep a few real-input successes, failures, and mitigations; compare media-rich and metadata-only reasoning where feasible.

## AI pipeline

```text
Style tags + uploaded images/videos (+ audio)
     ↓
Multimodal analysis → editable StyleProfile + visualReferenceIds
     ↓
TripContext + WardrobeItem[] + selected original media
     ↓
Daily outfit reasoning → DailyOutfit[] + missingItems
     ↓                          ↓
Preview generation          Commerce search by Person B
(user/garment/destination      (uses missing-item descriptors)
references)
```

**Principle:** retain uploaded visuals alongside extracted structured attributes. For video, store the clip plus any relevant timestamped frames. Never treat a model's guessed fabric, waterproofness, or fit as verified fact.

## Proposed files within `services/ai/`

```text
services/ai/
  README.md
  src/
    style_analysis/         # Tags + photo/video understanding
    outfit_planning/        # Multimodal candidate looks and constraints
    preview_generation/     # Try-on and destination scene requests
    clients/                # Gemini and other API adapters
    api/                    # Public request/response endpoints
  prompts/                  # Versioned prompts, not hidden inline strings
  tests/
    fixtures/               # Permissioned example input metadata
    cases/                  # Non-scripted checks and regression cases
```

Choose concrete language/framework later. This is a **logical module layout**, not a requirement to create every empty folder now.

## Expected I/O

- `StyleAnalysisRequest`: `{ tags, imageRefs, videoRefs, optionalUserNotes }`
- `StyleProfile`: `{ aesthetics, colors, silhouettes, stylingPatterns, avoidances, visualReferenceIds }`
- `OutfitPlanRequest`: `{ styleProfile, wardrobeItems, tripContext, selectedVisualReferenceIds }`
- `DailyOutfit`: `{ date, attractionIds, wardrobeItemIds, missingItems, rationale }`
- `PreviewRequest`: `{ outfitId, garmentImageRefs, userPhotoRef?, attractionRef?, sceneContext }`
- `GeneratedPreview`: `{ type, imageRef, sourceOutfitId, limitations? }`

See [`packages/contracts/`](../../packages/contracts/README.md) for the source of truth. Keep APIs returning actual IDs from the supplied wardrobe data; validate and reject hallucinated IDs.

## First implementation milestones

- [ ] Validate Gemini model availability and JSON/video input support in the hackathon environment.
- [ ] Implement style analysis with **photo and short video** test cases; persist original media refs and timestamps.
- [ ] Implement daily outfit recommendations using **actual garment images**, persona, and trip/weather data.
- [ ] Return validated clothing IDs and missing-item descriptions.
- [ ] Add on-demand virtual try-on and destination look image generation.
- [ ] Save several real-input success/failure examples, latency measurements, and prompt/model versions.

## Evaluation notes

Use permissioned, unscripted photos/video clips. Track what changes when using descriptions only versus original images/video/audio; focus on garment recognition, outfit changes, style fidelity, ID validity, and visual consistency. Document at least one genuine failure, its reproduction steps, and a mitigation. Store test metadata in Git; keep sensitive original media outside the repo.
