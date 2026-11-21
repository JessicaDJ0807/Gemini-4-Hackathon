# Model Choices

Which Gemini model each AI feature uses, and why. Update this file whenever a choice changes, and note the change in that experiment's commit.

Configure models through environment variables in `services/ai/.env`, not hard-coded strings, so we can swap them without code changes.

## Current assignments

| Feature / module | Model | Status | Notes |
| --- | --- | --- | --- |
| Style extraction (`style_analysis/`) | `gemini-4-neon` | In use (MVP), prompt v3 | Dominant style correct 16/16 in [experiment 02](experiments/experiment_02.md); 40–60 s with 4–5 images, ~12 s tags only. See also [experiment 01](experiments/01-style-extraction-images.md). Override with `STYLE_MODEL` |
| Outfit planning (`outfit_planning/`) | `gemini-4-hydrogen` | In use (MVP) | Gemini 4; fastest of the four Gemini 4 models in the quick test; ~20–25 s per 3-outfit plan text-only, ~27 s with 10 wardrobe photos. Prompt `outfit_planning_v2`. Not compared on quality. Override with `OUTFIT_MODEL` |
| Outfit preview (`preview_generation/`) | `gemini-4-hydrogen` writes the image prompt → `gemini-3.1-flash-image` draws it | In use (MVP) | **No Gemini 4 model can output images** (tested 2026-11-21: all four return text only), so Gemini 4 does the visual planning and a Gemini image model renders. Falls back to a template prompt if the Gemini 4 step fails. ~14 s. Override with `PREVIEW_BRIEF_MODEL` / `IMAGE_MODEL` |
| Destination scene (`preview_generation/`) | same as outfit preview | In use (MVP) | Same service, `mode: "destination"`; generic setting, no landmarks |
| Virtual try-on (user photo) | TBD | Not started | Not built |
| Smoke test (`hello_gemini.py`) | `gemini-4-hydrogen` | In use | Default only; checks the key and SDK |

Status values: **Not started** → **Experimenting** → **Chosen** (keep the evidence in the notes).

## Available models (checked 2026-11-21)

From `python hello_gemini.py --list-models` with our API key:

- **Gemini 4:** `gemini-4-hydrogen`, `gemini-4-carbon`, `gemini-4-neon`, `gemini-4-argon`
- **Gemini 3.x Flash:** `gemini-3.8-flash` (Google's suggested replacement for retired models), `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`
- **Image output (candidates for try-on and scenes):** `gemini-3-pro-image`, `gemini-3.1-flash-image`, `gemini-3.1-flash-lite-image`, `gemini-nano-banana-2.1`, `gemini-2.5-flash-image`
- **Other:** `gemini-omni-flash-preview`, Gemma 4 (`gemma-4-26b-a4b-it`, `gemma-4-31b-it`), Antigravity and Deep Research previews

`gemini-2.5-flash` is listed but returns 404 ("no longer available to new users"). The list alone doesn't guarantee a model works, so test before relying on it.

## Observations

All four Gemini 4 models report the same API metadata: 1,048,576 input tokens and thinking support. Hydrogen and Neon allow 65,536 output tokens; Carbon and Argon allow 32,768. The metadata doesn't describe how they differ in quality, so compare them on our own tasks.

Wall-clock time for a one-word reply (single run each, 2026-11-21, includes Python startup):

| Model | Time |
| --- | --- |
| `gemini-4-hydrogen` | ~2 s |
| `gemini-4-carbon` | ~3 s |
| `gemini-4-argon` | ~4 s |
| `gemini-4-neon` | ~17 s |
| `gemini-3.8-flash` | ~3 s |

Neon was by far the slowest in this one test. Measure its latency on real style-extraction inputs, since onboarding is user-facing.
