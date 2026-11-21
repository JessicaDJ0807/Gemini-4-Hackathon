# Try-On Studio integration interface

The Try-On Studio is the simplified full-scene pipeline behind `#/studio`. All routes are served by `server/index.js` (default port 8787). The Vite dev server proxies `/api` to it.

## Flow

1. The client sends `POST /api/scene/tryon` and gets back a job, or `{ cached: true }`.
2. The client polls `GET /api/scene/jobs/:id` until the job is `done` or `failed`.
3. The client reads the result with `POST /api/scene/lookup`, sending the same body as step 1. The result contains `still.url`.
4. Optionally, the client sends `POST /api/scene/video` with `{ key, authorizeCost: true }`, polls the job the same way, and reads `video.url` and `video.frames[]` from the result.

## Input

`POST /api/scene/tryon`. The same body without `consent` and `regenerate` can be sent to `POST /api/scene/lookup`, which never generates anything.

```jsonc
{
  "mode": "little-self",              // or "real-me"
  "input": "text",                    // little-self only: "text" (no photo sent) | "photo"
  "description": "shoulder-length black hair, round glasses",   // required for text input; optional notes otherwise (≤500 chars)
  "personId": "person-0123456789ab.jpg",                       // from POST /api/studio/upload; required for real-me on a fresh clone
  "garments": [                       // 1–6 items, in any mix of these three forms:
    "tee",                                                     //   1. built-in demo id: tee | trousers | cardigan
    "upload-0123456789ab.png",                                 //   2. Roamfit garment upload (outfitId from /api/studio/upload)
    { "id": "wd-01", "name": "White basic T-shirt", "category": "top",
      "imageUrl": "/fixtures/team-wardrobe/wd-01.jpg", "color": "white" }   // 3. team WardrobeItem / TryOnGarment
  ],
  "backgroundId": "bg-kyoto-ninenzaka-morning-v1",
  "consent": true,                    // the user agreed to send their inputs to Google Gemini API
  "regenerate": false                 // true = ignore the cache and generate again
}
```

### Field rules

- **Garment `category`** must be one of `top`, `bottom`, `dress`, `outerwear`, `shoes` or `accessory`.
- **Garment `imageUrl`** must be one of:
  - a local path under `/fixtures/team-wardrobe/` or `/media/`;
  - an `https` URL on a host listed in `TRYON_MEDIA_ALLOWED_HOSTS`.

  Anything else is refused and never fetched. The server reads the bytes and requires JPEG, PNG or WebP; an SVG is refused.
- **`backgroundId`** must be one of the following server-side IDs:

  | `backgroundId` | Destination |
  | --- | --- |
  | `bg-montreal-old-port-street-v1` | Old Montréal |
  | `bg-kyoto-ninenzaka-morning-v1` | Kyoto, Ninenzaka early morning |
  | `bg-kyoto-ninenzaka-sunlit-v1` | Kyoto, Ninenzaka sunlit lane |

  `GET /api/scene/config` lists them with credits. To map a team `trip.destination` to a background, use `matchDestination()` in `src/integration/backgrounds.ts`.
- **Person photos** are uploaded first with `POST /api/studio/upload`, sending `{ kind: "person" | "garment", dataUrl }`. The response is `{ id, outfitId? }`. Delete a photo with `DELETE /api/studio/upload/:id`.

## Output

### Job

Returned by `POST /api/scene/tryon` and `POST /api/scene/video`, and polled at `GET /api/scene/jobs/:id`.

```jsonc
{ "id": "a1b2c3d4", "kind": "still", "key": "<cache key>", "status": "running",
  "step": "Generating your try-on photo", "startedAt": 1763740000000,
  "error": { "message": "…" } }
```

- `kind` is `"still"` or `"video"`.
- `status` is `"running"`, `"done"` or `"failed"`.
- `error` is present only when the job failed.

If the selection is already cached, `POST /api/scene/tryon` returns `{ "cached": true, "key": "…" }` instead of a job, and makes no API call.

### Errors

Errors are returned as `{ "error": "message" }` with one of these HTTP statuses:

| Status | Meaning |
| --- | --- |
| 400 | Invalid input or missing consent |
| 402 | Video requested without `authorizeCost` |
| 409 | A video for this look is already running |
| 503 | No API key configured |

### Result

Returned by `POST /api/scene/lookup` (as `{ key, result }`) and by `GET /api/scene/results` (as an array).

```jsonc
{
  "key": "…", "mode": "real-me", "input": "photo",
  "garmentIds": ["wd-01", "wd-06"],
  "garments": [{ "id": "wd-01", "name": "…", "category": "top", "imageUrl": "…" }],
  "backgroundId": "bg-kyoto-ninenzaka-morning-v1", "destination": "Kyoto",
  "still": {
    "url": "/api/scene/file/<key>/still.png",            // generated try-on image (16:9)
    "createdAt": "…", "totalMs": 41000,
    "notes": ["default used: glasses"],                    // Model A uncertainties and defaults
    "review": { "verdict": "pass", "notes": ["…"] }        // Model B, arrives a few seconds later, informational
  },
  "video": {                                               // only after the optional 360° step
    "url": "/api/scene/file/<key>/video-<id>.mp4",
    "frames": ["/api/scene/file/<key>/frames-<id>/001.jpg", "…"],   // ordered frame manifest
    "frameCount": 48, "seconds": 8, "model": "gemini-omni-1.2-flash",
    "costEstimateUsd": 0.56, "label": "AI-generated rotating preview (coverage not verified)"
  },
  "trace": [{ "role": "Model A · Gemini 4 garment analysis", "model": "gemini-4-neon", "latencyMs": 5200 }]
}
```

`frames` are taken at 6 fps and 1280 px wide.

## Frontend embed (React 19)

```tsx
import SceneStudio from './scene/SceneStudio'

<SceneStudio
  wardrobe={wardrobeItems}            // team WardrobeItem[]
  outfits={dailyOutfits}              // team DailyOutfit[] → "Recommended looks"
  destination={trip.destination}      // team TripContext destination; picks the matching background
  resolveImageUrl={url => url}        // optional: rewrite imageUrls to URLs the Roamfit server may read
/>
```

Without props, the studio shows the built-in demo pieces, and a "Team plan (fixture)" tab with the recorded team plan.

If the team app isn't React, it can embed `http://<host>:5173/#/studio` in an iframe, or call the HTTP API above directly.

### Files the component needs

| Area | Files |
| --- | --- |
| UI | `src/scene/SceneStudio.tsx`, `src/scene/SceneViewer.tsx`, `src/scene/scene.css`, `src/studio2/studio2.css` |
| Team contracts | `src/integration/teamAdapter.ts`, `teamContracts.ts`, `backgrounds.ts`, `fixtures/` |
| Shared contract | `shared/tryon/contract.js` and `contract.d.ts` |
| Server | `server/index.js`, `server/scene/`, `server/assetPaths.js`, `server/tryon/{geminiClient,models,assetIntake}.js`, `server/preview/media.js` (URL allow-list), `server/avatar3d/` (uploads, `/media`) |
| Assets | `assets/` (garment cut-outs, style reference), `public/backgrounds/`, `public/fixtures/team-wardrobe/` |
| npm packages | `express`, `react`, `react-dom` |
| System tools | `ffmpeg`, only for 360° frames |

`three` and `@react-three/*` are used only by the legacy routes. They can be dropped together with those routes.
