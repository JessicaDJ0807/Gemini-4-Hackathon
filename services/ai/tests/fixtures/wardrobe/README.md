# Wardrobe fixture pack (37 items)

Thirty-seven wardrobe photos with a manifest for wardrobe-based outfit planning, image recognition, and shopping-gap demos. `wd-01`–`wd-10` are Pexels stock photos that `download_images.py` can fetch. `wd-11`–`wd-20` are user-supplied and `wd-21`–`wd-37` come from Wikimedia Commons (shoes, bottoms, bags and accessories); both have `photo_id: null`, live in `images/`, and aren't fetched by the script.

## Setup

```bash
python -m pip install requests Pillow
python download_images.py
```

Images appear in `images/wd-01.jpg` etc. Actual extension is detected automatically (`jpg`, `png`, or `webp`). Existing valid images are skipped. Failed downloads show the original source page for manual download. **The ZIP contains scripts and metadata, not the image binaries**, because the creation environment could not access the Pexels CDN.

## Integrating

Put this directory under `services/ai/tests/fixtures/wardrobe/` and use `manifest.json` as the source of truth for wardrobe IDs. The fixture labels are approximate and meant for tests, not ground-truth product attributes. Some photographs contain additional items, hands, or backgrounds; they're not transparent product cutouts.

## Licensing

`wd-21`–`wd-37` are Wikimedia Commons files; each manifest entry has `source_url`, `author`, `license` and `license_url`. CC BY and CC BY-SA require attribution, and CC BY-SA adaptations must keep the same license. `wd-11`–`wd-20` have no recorded source or license yet; fill in `source_url` and `source` in the manifest before using them outside local tests. `wd-01`–`wd-10` are Pexels photos. See https://www.pexels.com/license/ for the license and restrictions (especially trademark/person rights). Keep `source_url` for provenance; do not claim the subjects or brands endorse the project.
