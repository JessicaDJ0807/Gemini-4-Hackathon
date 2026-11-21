# Experiment 01: Style extraction from images

**Date:** 2026-11-21 · **Model:** `gemini-4-neon` · **Prompt:** [`style_analysis_v1`](../../../services/ai/prompts/style_analysis_v1.md) · **Status:** Done, findings below

**Question:** Can Gemini turn a messy, mixed set of inspiration photos into an accurate, editable `StyleProfile`?

**Code:** [`services/ai/src/style_analysis/`](../../../services/ai/src/style_analysis/) · **Raw outputs:** [`services/ai/runs/style_extraction/`](../../../services/ai/runs/style_extraction/)

```bash
cd services/ai && source .venv/bin/activate
python -m src.style_analysis.extract --runs 2
```

## Test inputs

8 Unsplash/Pexels photos in `services/ai/tests/fixtures/media/` (not committed). Chosen to be deliberately mixed, not one consistent style:

| Id | File | What's in it (human reference) | Why it's a useful test |
| --- | --- | --- | --- |
| img-01 | elist-nguyen-…-unsplash.jpg | Floral tapestry bodice, sheer white puff-sleeve blouse, flower in hair | Pairs with img-05 |
| img-02 | manito-silk-…-unsplash.jpg | White sleeveless button-down, plain studio shot | Minimal; trousers barely visible |
| img-03 | pexels-andrysso-…jpg | Sports crop top, off-white joggers, white sneakers | Unusual seated pose |
| img-04 | pexels-followingnyc-…jpg | Grey coat, turtleneck, neon snake-print midi skirt, ankle boots | Crowded street, other people's clothes in background |
| img-05 | pexels-kha-ruxury-…jpg | Floral tapestry bodice, lace blouse, lace gloves, straw bonnet | Tight crop; no lower body |
| img-06 | pexels-marcelodias-…jpg | Black leather jacket, ripped black skinny jeans | Dark image, partly hidden top |
| img-07 | pexels-truenorthlens-…jpg | Orange fuzzy cardigan, print shirt, zigzag trousers, scarf, bracelets | Many layers and prints; ambiguous held object |
| img-08 | rangga-cahya-nugraha-…-unsplash.jpg | Oversized brown plaid blazer and matching trousers | Leaning pose |

## Design decisions

### Input

| Decision | Choice | Why |
| --- | --- | --- |
| How images are sent | Uploaded through the **Files API**, then deleted after the run | 8 photos are ~21 MB, above the commonly cited ~20 MB inline request limit; matches the docs' "pass references, not blobs" rule; needed for videos next anyway |
| Image size | **Original full resolution** (2.4k–6k px), no resizing | Test the model on real uploads first; the API downsamples internally |
| Image ids | `img-01`…`img-08`, assigned in **alphabetical filename order**; mapping saved in each run file | Short ids are easier for the model to cite correctly than long filenames. **Limitation:** adding a new image can shift the ids; switch to stable ids from a fixtures manifest before the next experiment |
| Prompt layout | Text line `Image id: img-NN` immediately before each image, then one closing instruction | Lets the model tie each observation to the right image |
| Tags / notes | **None**; images only | Isolates what the model gets from visuals alone; tags come in a later experiment |

### Prompt ([`style_analysis_v1.md`](../../../services/ai/prompts/style_analysis_v1.md), sent as the system instruction)

Each rule targets a specific risk:

| Rule | Risk it addresses |
| --- | --- |
| Analyze only the main subject's outfit; ignore background people, setting, makeup, hair | img-04 has a crowd wearing other clothes |
| Describe clothing only; never the wearer's body, age, gender, ethnicity or attractiveness | Privacy and fairness; the style profile shouldn't depend on who wore the clothes |
| Describe only what's visible in crops; don't invent hidden garments | img-05 and others are tightly cropped |
| Fabric/fit/weather are "appears to be", never fact | From [docs/ai/README.md](../README.md): never treat guessed fabric or waterproofness as verified |
| Report **separate style directions** instead of blending into an average | Real inspiration boards are mixed; averaging produces a vague, useless profile |
| Every trait must **cite supporting image ids** | Makes each claim checkable; lets us catch invented ids |
| Avoidances only with real evidence; otherwise empty | You can't tell what someone dislikes from 8 photos of things they like |
| Plain, searchable vocabulary | Later steps (outfit planning, Shopify search) need searchable terms |
| Describe each image first, then combine | A light chain of reasoning: the combined profile is built from per-image notes |

### Output schema ([`schema.py`](../../../services/ai/src/style_analysis/schema.py))

- The model returns **`StyleExtraction`**, which is richer than the shared `StyleProfile` contract: per-image observations, style directions (with strength `dominant`/`secondary`/`minor`), and every trait as `{label, image_ids}`.
- Code then **flattens it into the contract's `StyleProfile`** (plain string lists), so the app's contract is unchanged.
- Enforced with **structured output** (`response_mime_type="application/json"` + `response_schema=StyleExtraction`) so the response always parses.

### Settings

| Setting | Value | Why |
| --- | --- | --- |
| Model | `gemini-4-neon` (override with `STYLE_MODEL` in `.env`) | Chosen by the user for this feature |
| Temperature | Not set (model default) | Google's guidance for recent thinking models is to keep the default; tune only if needed |
| Thinking | Not set (model default, dynamic) | Measured instead: used ~4–5k thinking tokens |
| Media resolution | Not set (default) | Baseline first; try `MEDIA_RESOLUTION_LOW` later for speed |
| Seed | Not set | Ran twice instead, to see natural variation |
| Calls | **One call** for all images (per-image + combined in one response) | Simplest; the model sees all images together when grouping them |
| Runs | **2** on the same uploaded files | Check consistency |

### Automatic checks on every run

- **Invalid ids:** every cited image id must be one of the inputs.
- **Missing images:** every input must have a per-image observation.
- Timing and token usage saved with the output.

## Results

| | Run 1 | Run 2 |
| --- | --- | --- |
| Time | 64.1 s | 55.2 s |
| Input tokens (8 images + prompt) | 10,395 | 10,395 |
| Thinking tokens | 5,094 | 4,192 |
| Output tokens | 2,313 | 2,390 |
| Invalid / missing image ids | none / none | none / none |

**Style directions (identical grouping in both runs):**

| Strength | Direction | Images |
| --- | --- | --- |
| secondary | Romantic cottagecore | img-01, img-05 |
| secondary | Eclectic maximalism | img-04, img-07 |
| secondary | Clean neutral / relaxed tailoring | img-02, img-08 |
| minor | Athleisure | img-03 |
| minor | Edgy streetwear | img-06 |

No direction was marked `dominant`, which is correct: no style covers most of the images.

Run 1 summary: *"Your inspiration images span several distinct style directions rather than one single aesthetic, anchored by romantic cottagecore layering, bold eclectic maximalism, and relaxed neutral tailoring. You also pull in sporty athleisure and edgy black-and-white casualwear as smaller accents."*

## What worked

- **Garment recognition was accurate** on all 8 images, including details like the striped faux-fur cuffs (img-04), lace gloves and bonnet (img-05), and the matching plaid set (img-08).
- **Ignored the background crowd** in img-04; only the main outfit was described.
- **Crops handled honestly**: every image noted what was cut off ("footwear not visible").
- **Grouping into directions was correct and stable**: same 5 groups, same images, both runs. It did not blend everything into one average.
- **No invented ids, no missing images, avoidances left empty** (correct: no evidence).
- **No descriptions of the wearers' bodies, age, gender or ethnicity.**
- Fabric guesses were consistently phrased as "appears to be".

## What didn't work / issues

1. **The shared `StyleProfile` contract loses the most useful result.** Flattened, the profile is 11 aesthetics in one list (`cottagecore, maximalist, minimalist, athleisure, edgy…`), which is exactly the vague average we tried to avoid. The style directions and their supporting images exist only in our internal format. **Proposed contract change for the team:** add an optional `styleDirections: {name, description, strength, visualReferenceIds}[]` to `StyleProfile`. (Not changed; `packages/contracts/` is shared.)
2. **Too slow for onboarding.** 55–64 s per profile, with ~4–5k thinking tokens. Users wait on this screen.
3. **Colors are inconsistent between runs.** Run 1 grouped colors into 6 families ("earth tones", "warm pastels"); run 2 listed 10 single colors. Fine for display, bad for later matching against wardrobe items.
4. **One likely misidentification:** img-07's held patterned object was called a "woven patterned straw hat" / "straw fedora". From the photo it's unclear whether it's a hat at all; the model stated it with confidence instead of marking it uncertain.
5. **Minor run-to-run detail drift:** img-04 sunglass lenses "yellow-tinted" vs "green-tinted"; img-08 "tailored casual, menswear-inspired" vs "tailored casual, minimalist, vintage-inspired".
6. **Scope creep in the summary:** run 2 added advice ("you may want to focus on one or two of these directions…"). The summary should describe, not recommend.
7. **Positional image ids** (see Input): fragile once the fixture set changes.

## Next steps

- [ ] Speed: compare `thinking_level` low, `MEDIA_RESOLUTION_LOW`, and other Gemini 4 models (hydrogen/carbon/argon) on the same 8 images; track quality vs time.
- [ ] Colors: give the schema a fixed color-family vocabulary, or both `family` and `specific` fields.
- [ ] Prompt v2: "summary describes, doesn't advise"; "mark unclear items as uncertain".
- [ ] Stable fixture ids via a `tests/fixtures/cases.json` manifest.
- [ ] Propose `styleDirections` to the team for `packages/contracts/`.
- [ ] Experiment 02: short videos (and audio cues).
- [ ] Experiment: tags + images together; does a conflicting tag override the images?
