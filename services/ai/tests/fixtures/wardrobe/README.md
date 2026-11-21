# Wardrobe fixture pack (10 items)

Ten Pexels stock-photo sources with a manifest for wardrobe-based outfit planning, image recognition, and shopping-gap demos.

## Setup

```bash
python -m pip install requests Pillow
python download_images.py
```

Images appear in `images/wd-01.jpg` etc. Actual extension is detected automatically (`jpg`, `png`, or `webp`). Existing valid images are skipped. Failed downloads show the original source page for manual download. **The ZIP contains scripts and metadata, not the image binaries**, because the creation environment could not access the Pexels CDN.

## Integrating

Put this directory under `services/ai/tests/fixtures/wardrobe/` and use `manifest.json` as the source of truth for wardrobe IDs. The fixture labels are approximate and meant for tests, not ground-truth product attributes. Some photographs contain additional items, hands, or backgrounds; they're not transparent product cutouts.

## Licensing

Source pages are Pexels photos. See https://www.pexels.com/license/ for the license and restrictions (especially trademark/person rights). Keep `source_url` for provenance; do not claim the subjects or brands endorse the project.
