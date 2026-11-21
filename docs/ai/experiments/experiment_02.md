# Experiment 02: Multi-image style boards

**Date:** 2026-11-21 · **Model:** `gemini-4-neon` · **Prompt:** [`style_analysis_v2`](../../../services/ai/prompts/style_analysis_v2.md) · **Runs:** 8 cases × 2 = 16, all succeeded

**Question:** Can Gemini find the shared aesthetic behind several visually different outfits, and produce a grounded profile that's useful for outfit planning and shopping?

**Short answer:** Yes for the main style: it identified the expected dominant style in 16/16 runs and handled the outlier and mixed boards correctly. But it **invents dislikes** (12/16 runs), its smaller sub-styles change between runs and image orders, and it takes ~40–60 s.

**Code:** [`experiment_02.py`](../../../services/ai/src/style_analysis/experiment_02.py) · **Outputs:** [`services/ai/runs/style_extraction_exp02/`](../../../services/ai/runs/style_extraction_exp02/) (one JSON per case/run + `summary.json`)

```bash
cd services/ai && source .venv/bin/activate
python -m src.style_analysis.experiment_02 --validate-only   # fixture check only
python -m src.style_analysis.experiment_02 --runs 2          # full run (~15 min)
python -m src.style_analysis.experiment_02 --summarize-only  # re-score saved outputs
```

## Method

### Fixtures

20 Pexels photos (Pexels License), 5 per board, at `services/ai/tests/fixtures/media/style_inspiration_fixture_pack/` (not committed). The brief said `tests/fixtures/style_boards/images/`; the files were actually in the path above, so that path was used.

**Validation before running:** all 20 files present, valid JPEG, 933–1120 × 1400 px, in their board's folder, no duplicate files; all 8 cases reference valid ids. Issues found (not fixed, manifest left untouched):
- Every photo has `download_status: "pending"` in `manifest.json` although all files exist.
- `ecl-01` is the same photo as Experiment 01's `img-07` (Pexels 33041186).

**Human review of the boards** (labels are the fixture author's, not ground truth):

| Board | Fit | Notes |
| --- | --- | --- |
| Minimal | Good | Blazers/jumpsuit in camel, beige, black. `min-04` is a **black-and-white photo** (colors unknowable). `min-03`/`min-04` lean darker/edgier |
| Romantic | Strong | Floral/lace dresses, puff sleeves, ribbons, straw hat |
| Edgy | Mostly | `edg-03` reads more 90s streetwear than grunge. `edg-05`: subject small in frame, outfit hard to see |
| Eclectic | Mostly | `ecl-04` (pom-pom jacket) and `ecl-05` (ruffle top, bodysuit, lace tights) are editorial/costume rather than everyday |

### Cases

| Case | Images | Expectation |
| --- | --- | --- |
| 4 coherent boards | 5 from one board | One dominant direction covering all 5 |
| `outlier_minimal_plus_edgy` | 4 minimal + `edg-01` | Minimal dominant; edgy kept as a minority, not dropped, not turned into a dislike |
| `mixed_minimal_romantic` | 3 minimal + 2 romantic | Minimal dominant, romantic secondary |
| `reordered_minimal`, `reordered_eclectic` | Same images, different order | Same result as the original order |

### What changed from Experiment 01 (and what didn't)

- **Changed:** prompt v1 → v2. Only rule 5 (how to combine images) was replaced with the revised aggregation instructions; the closing line now says "identify the shared visual styling principles". All other rules are identical.
- **Same:** model, `StyleExtraction` schema, structured JSON output, default temperature/thinking/media resolution, Files API upload, `Image id:` line before each image, id validation. Code reuses Experiment 01's `upload_images` and `run_once`.
- **Different by fixture, not by design:** images are 1400 px (Exp 01 used 2.4k–6k originals) and boards are 5 images (Exp 01 was 8).
- **Image ids** are the manifest's stable ids (`min-01`…), fixing Exp 01's positional-id limitation. Each image is uploaded once and reused across cases.

### Automatic scoring

Per run: invalid/missing ids; **top direction** = the strongest direction (dominant > secondary > minor); **primary recall** = how many of the expected board's images the top direction contains; secondary found; outlier placement; % of traits backed by ≥2 images ("shared traits"); avoidances. Across runs: same grouping of images into directions, and Jaccard overlap of aesthetic labels.

## Results

| Case | Run | Time | Tokens (thinking) | Top direction | Primary recall | Other directions | Shared traits | Avoidances |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Minimal | 1 | 53.5 s | 13,046 (3,561) | Minimalist Modern Tailoring | 5/5 | 3 | 69% | 3 |
| Minimal | 2 | 53.7 s | 11,629 (2,658) | Minimalist Tailoring | 5/5 | 2 | 83% | 3 |
| Romantic | 1 | 43.7 s | 12,183 (3,081) | Romantic Cottagecore | 5/5 | 2 | 96% | 3 |
| Romantic | 2 | 51.4 s | 13,555 (4,402) | Romantic Cottagecore | 5/5 | 2 | 82% | 3 |
| Edgy | 1 | 59.2 s | 13,552 (4,530) | Dark Edgy Streetwear and Grunge | 5/5 | 2 | 83% | 0 |
| Edgy | 2 | 63.2 s | 14,843 (5,679) | Dark Edgy Streetwear | 5/5 | 2 | 71% | 1 |
| Eclectic | 1 | 56.5 s | 13,939 (4,750) | Eclectic Maximalism | 5/5 | 3 | 77% | 1 |
| Eclectic | 2 | 42.3 s | 11,856 (2,699) | Expressive Maximalism | 5/5 | 2 | 83% | 1 |
| Outlier 4+1 | 1 | 46.9 s | 11,436 (2,593) | Modern Minimalist Tailoring | 4/4 | edg-01 as **minor** | 70% | 3 |
| Outlier 4+1 | 2 | 48.1 s | 12,353 (3,521) | Modern Minimalist Tailoring | 4/4 | edg-01 + min-03/04 as **secondary** "Edgy Dark Styling" | 57% | 2 |
| Mixed 3+2 | 1 | 44.3 s | 11,719 (2,911) | Modern Minimalist Tailoring | 3/3 | Romantic Cottagecore (secondary) | 71% | 0 |
| Mixed 3+2 | 2 | 47.8 s | 11,769 (2,985) | Minimalist Tailoring | 3/3 | Romantic Cottagecore (secondary) | 62% | 0 |
| Reordered minimal | 1 | 45.6 s | 11,986 (2,969) | Minimalist Tailoring | **4/5** (min-02 missing) | 3 | 73% | 3 |
| Reordered minimal | 2 | 49.3 s | 12,142 (3,091) | Modern Minimalist Tailoring | 5/5 | 3 | 65% | 3 |
| Reordered eclectic | 1 | 50.5 s | 12,528 (3,212) | Eclectic Maximalism | 5/5 | 3 | 90% | 1 |
| Reordered eclectic | 2 | 44.5 s | 12,368 (3,131) | Bold Eclectic Maximalism | 5/5 | 2 | 86% | 2 |

No invalid image ids and no missing per-image observations in any run. No failed calls.

### Consistency

| Comparison | Same image grouping? | Aesthetic-label overlap (Jaccard) |
| --- | --- | --- |
| Minimal run 1 vs 2 | No | 0.33 |
| Romantic run 1 vs 2 | No | 0.71 |
| Edgy run 1 vs 2 | No | 0.62 |
| Eclectic run 1 vs 2 | No | 0.88 |
| Outlier run 1 vs 2 | No | 0.30 |
| Mixed run 1 vs 2 | **Yes** | 0.70 |
| Reordered minimal vs original (run 1 / run 2) | No / No | 0.50 / 0.33 |
| Reordered eclectic vs original (run 1 / run 2) | **Yes** / No | 0.36 / 0.30 |

The **dominant** direction was stable everywhere (same images, near-identical name). What varies is the split into secondary/minor sub-styles and the exact label wording.

## Evaluation by criterion

- **Dominant style identification: strong.** 16/16 runs named the expected style as dominant. 15/16 put every expected image in it; reordered-minimal run 1 left `min-02` (the utility jumpsuit) out of the dominant group and in a sub-style.
- **Shared-trait grounding: good.** Every trait cites image ids, all ids valid; 57–96% of traits are backed by ≥2 images. Single-image traits remain (e.g. `beige ['min-02']`), which is correct as detail but shouldn't be treated as a shared trait.
- **Secondary preferences: strong.** Mixed board: romantic found as secondary in both runs with exactly `rom-01`, `rom-02`. Outlier board: `edg-01` never entered the dominant group and was always kept as its own direction (minor in run 1; in run 2 grouped with the darker `min-03`/`min-04` as "Edgy Dark Styling", which matches the human review that those two lean edgy).
- **Ordering sensitivity: low for the main style, high for sub-styles.** Same dominant style in every reordered run; sub-style grouping differed in 3 of 4 order comparisons.
- **Run-to-run consistency: moderate.** Grouping identical only for the simple mixed board. Label overlap 0.30–0.88.
- **Latency: 42–63 s, 11–15k tokens** (2.6–5.7k thinking) per 5-image board. Similar to Exp 01; still too slow for an onboarding screen.

## Qualitative examples

**Good, honest uncertainty** (`min-04`, black-and-white photo): colors given as *"undetermined (black-and-white photograph…)"* with the note *"exact garment colors cannot be determined"*. No invented colors.

**Good, mixed board summary** (run 1): *"Your style profile balances two distinct directions: a dominant modern minimalist wardrobe built on relaxed blazers, tailored trousers, and belted neutral sets, alongside a secondary romantic cottagecore aesthetic centered on floral dresses with square necklines, voluminous sleeves, and ribbon bows."*

**Good, hard image** (`edg-03`): garments listed accurately (*colorblock zip-up blouson jacket, deconstructed patchwork denim, chunky platform shoes, graphic cap, wallet chain, beaded necklace*).

**Bad, invented dislikes** (minimal run 1): avoidances *"prints and patterns", "bright or saturated colors", "heavy statement accessories or embellishments"*, each "supported" by all 5 images. The summary then tells the user they are *"skipping prints, bright colors, and heavy embellishments"*.

## Failure cases

1. **Invented avoidances in 12/16 runs** (all coherent boards except edgy run 1, outlier, both reorders; only the mixed board had none). They're dislikes inferred from things *absent* in 5 photos. **Root cause is our prompt:** rule 7 (carried over from v1) gives *"a consistent absence across many images"* as an example of valid evidence. This contradicts the brief ("do not invent preferences, dislikes"; "don't assume minority preferences are unwanted"). In the outlier case it even listed "bright saturated colors" as a dislike while keeping an edgy minority style.
2. **Sub-style instability:** secondary/minor directions are regrouped between runs and orders. Fine for display, unreliable as stored profile data.
3. **Repeated misidentification:** `ecl-01` (= Exp 01 `img-07`) again lists a "woven fedora hat" for the ambiguous held object, without marking it uncertain.
4. **One dominant-group omission:** reordered minimal run 1 left `min-02` out of the dominant direction.
5. **Latency:** ~50 s average.

## Recommended improvements

1. **Prompt v3, avoidances:** "Never infer avoidances from absence. Only include avoidances the user states explicitly." This also matches the A/B contract, where avoidances come from user input. *(Applied in the production style-analysis endpoint; see below.)*
2. **Mark uncertain items:** add an `uncertain` flag or "possibly" wording to per-image garments.
3. **Store only the dominant direction (plus explicit secondaries) in the profile;** treat sub-styles as display-only.
4. **Speed:** try `thinking_level` low and `MEDIA_RESOLUTION_LOW` on the same boards, and compare the other Gemini 4 models.
5. **Contract:** add optional `styleDirections` to `StyleProfile` (proposed in Exp 01) so the dominant/secondary split survives into outfit planning.
6. **Fixtures:** fix `download_status` in the manifest; consider replacing `edg-05` (outfit barely visible) and `ecl-01` (overlaps Exp 01).

## Limitations

- Board labels are the fixture author's and one human review; no independent ground truth.
- Two runs per case is enough to see variation, not to measure it precisely.
- Scoring of label agreement uses exact-string Jaccard, which undercounts synonyms ("Minimalist Tailoring" vs "Modern Minimalist Tailoring").
- Image resolution differs from Exp 01, so the two experiments aren't a clean prompt-only comparison.
