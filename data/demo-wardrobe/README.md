# Demo wardrobe

Nine fictional garments with stable IDs, categories, colors, style tags, and original SVG illustrations created for this repository. No third-party product photos, brands, prices, or inventory are used. The illustrations may be used and modified with the project.

`wardrobe.mjs` is the canonical catalog (`demo-wardrobe-v1`). B serves illustrations under `/wardrobe/` and returns the catalog from `/api/demo-wardrobe`. These vector references are used only by the mock UI; live mode uses the photo catalog below. They do not establish actual fit, fabric, warmth, or weather resistance.


## Live photo wardrobe

`photo-wardrobe.mjs` maps A's checked-in [fixture manifest](../../services/ai/tests/fixtures/wardrobe/manifest.json) to the shared wardrobe contract. It preserves all ten `wd-*` IDs, fixture names, colors, and style tags. B serves the existing JPEG files from `/wardrobe-photos/`; no additional copies or downloads are needed. The live adapter converts those local paths to absolute URLs A can fetch.

These are sample wardrobe references with approximate labels, not purchasable product listings. Source links appear in the UI's photo credits. See A's [fixture provenance and license notes](../../services/ai/tests/fixtures/wardrobe/README.md). Product matches from Shop are a separate catalog.
