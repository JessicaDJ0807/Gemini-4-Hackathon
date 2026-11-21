# Roamfit Try-On Studio

Roamfit shows a traveller, or their stylised "Little Self", wearing a chosen outfit inside a real destination photo. It can then optionally make the figure turn around in place.

The flow is: pick garments and a destination, click **Generate Try-On** (one image), then optionally click **Generate 360° Preview** (one paid video, with drag-to-rotate frames).

> This is an image/video simulation. It is not a 3D model, and it does not simulate fit, size or fabric.

## Run locally

Requirements: Node ≥ 22.9, pnpm (or npm), and `ffmpeg` on `PATH` (only needed for the 360° preview frames).

```bash
pnpm install          # or: npm install
cp .env.example .env  # then add GEMINI_API_KEY
pnpm dev              # Vite on :5173 + API on :8787
```

Open **http://localhost:5173/#/studio**.

The API key is read only by the Node server. Never commit `.env` and never put keys in `VITE_*` variables.

Without a key, the UI, team fixtures and cached results still load, but generation returns `GEMINI_API_KEY not configured`.

### Checks (no paid calls)

```bash
pnpm test    # 45 tests; 3 are skipped on a fresh clone because they need locally generated results
pnpm build
```

## Environment variables

| Variable | Needed for | Default / note |
| --- | --- | --- |
| `GEMINI_API_KEY` | all generation | server-side only |
| `GEMINI4_PLANNER_MODEL` | Model A: reads appearance and garments | `gemini-4-neon` |
| `GEMINI4_QA_MODEL` | Model B: reviews the still, non-blocking | `gemini-4-carbon`; must differ from Model A |
| `IMAGE_MODEL` | try-on image | `gemini-nano-banana-2.1` (not Gemini 4) |
| `VIDEO_MODEL` | optional 360° video | `gemini-omni-1.2-flash` (not Gemini 4), about US$0.56 per 8 s video |
| `TRYON_MEDIA_ALLOWED_HOSTS` | team or Shopify garment image URLs | `cdn.shopify.com`; https only |
| `ROAMFIT_PRIVATE_ASSETS_DIR` | optional demo person photo outside the repo | `../assets` |
| `PORT` | API port | `8787` |

The other variables in `.env.example` belong to other routes (the original app, Shopify, and `#/tryon`) and are optional.

## What works

- **Two modes, one workflow.**
  - **My Little Self**: built from a text description (no photo is sent) or from a photo, in the Cozy Clay style reference.
  - **Real Me**: built from an uploaded person photo plus the garment images.
- **Inputs.** Garments come from the built-in demo pieces, the team's `WardrobeItem[]` and `DailyOutfit[]` (props, or the recorded team fixture), or uploaded garment photos. Destinations are Old Montréal and two Kyoto photos.
- **Still first.** The try-on photo appears as soon as it's generated. The Gemini 4 review arrives afterwards and never blocks.
- **Optional 360° preview.** It runs only after an explicit cost confirmation. There are no automatic retries and no validation gate. Frames come straight from the video via FFmpeg: no masks, no segmentation. The viewer offers drag or arrow keys, a scrubber, play/pause of the original video, and back to the photo.
- **Cache.** Results are cached by avatar × mode × garments × destination. A matching selection is shown instantly with no API call, and "Your looks" switches between saved results.
- **Safety.** Consent is required before any upload to Gemini. Team image URLs are fetched only from allow-listed hosts. Paid video returns 402 without `authorizeCost: true`.

## Limitations

- **Not 3D, not a fit simulation.** Rotation coverage is not verified, so the preview is labelled "AI-generated rotating preview".
- **Real Me needs an uploaded photo on a fresh clone.** The demo person photo is private and is not in the repo.
- **Unconfirmed media rights.** The Montréal photo, the garment cut-outs in `assets/derived/` and the style reference in `assets/reference/` have no recorded source or licence. Confirm them before making the repo or site public. Kyoto photos are CC BY-SA (see `public/backgrounds/CREDITS.md`).
- **Only three destination photos.** Other destinations need approved street-level photos.
- **Shopify is not connected** in this studio.
- **Body measurements are not used.**
- **Single-process prototype.** Jobs live in memory, and results are stored on local disk in `spike-results/` (git-ignored).

## Integration

See **[docs/SCENE_API.md](docs/SCENE_API.md)** for the Try-On Studio interface: inputs, outputs, job states and the React embed.

`#/tryon` with `/api/v1/tryon-previews` is a separate, contract-first module from an earlier integration pass. It uses the 4-view turnaround and is documented in [docs/INTEGRATION.md](docs/INTEGRATION.md) and [docs/HANDOFF.md](docs/HANDOFF.md).

### Other routes

These are experiments, kept for reference: `#/studio-turnaround` (cut-out turnaround), `#/studio-3d` (3D disabled), `#/studio-legacy`, `#/3d`, and `/` (the original app).
