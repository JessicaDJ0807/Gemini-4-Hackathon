#!/usr/bin/env python3
"""Download ten Pexels wardrobe-fixture photos. Usage: python download_images.py"""
import json
import re
import time
from pathlib import Path
from urllib.parse import urljoin
import requests
from PIL import Image, UnidentifiedImageError

ROOT = Path(__file__).resolve().parent
DATA = json.loads((ROOT / "manifest.json").read_text())
DEST = ROOT / "images"
DEST.mkdir(exist_ok=True)
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "Mozilla/5.0 (compatible; wardrobe-fixture-downloader/1.0)"})


def validate(path):
    try:
        with Image.open(path) as img:
            img.verify()
        with Image.open(path) as img:
            return img.format, img.size
    except (OSError, UnidentifiedImageError):
        return None


def candidates(item):
    photo_id = item["photo_id"]
    base = f"https://images.pexels.com/photos/{photo_id}/pexels-photo-{photo_id}"
    for suffix in ("jpeg", "jpg", "png", "webp"):
        yield f"{base}.{suffix}?auto=compress&cs=tinysrgb&w=1200"
    # Last resort: discover the actual CDN image URL from the Pexels source page.
    try:
        response = SESSION.get(item["source_url"], timeout=12)
        response.raise_for_status()
        for match in re.findall(r'<meta[^>]+(?:property|name)=["\']og:image["\'][^>]+content=["\']([^"\']+)', response.text):
            yield match.replace("&amp;", "&")
    except requests.RequestException:
        pass


failed = []
for item in DATA["items"]:
    prefix = item["id"]
    existing = next((p for p in DEST.glob(prefix + ".*") if validate(p)), None)
    if existing:
        print(f"SKIP {prefix}: {existing.name}")
        continue
    print(f"GET  {prefix}: {item['name']}")
    success = False
    for url in candidates(item):
        try:
            resp = SESSION.get(url, timeout=18)
            if resp.status_code in (403, 404):
                continue
            resp.raise_for_status()
            if not resp.headers.get("content-type", "").startswith("image/"):
                continue
            temp = DEST / (prefix + ".tmp")
            temp.write_bytes(resp.content)
            result = validate(temp)
            if not result:
                temp.unlink(missing_ok=True)
                continue
            fmt, dims = result
            ext = {"JPEG":"jpg", "PNG":"png", "WEBP":"webp"}.get(fmt, fmt.lower())
            final = DEST / f"{prefix}.{ext}"
            temp.replace(final)
            print(f" OK  {final.name} ({dims[0]}x{dims[1]})")
            success = True
            break
        except requests.RequestException as exc:
            print(f"  retrying: {str(exc)[:90]}")
        finally:
            (DEST / (prefix + ".tmp")).unlink(missing_ok=True)
    if not success:
        failed.append((prefix, item["source_url"]))
    time.sleep(0.15)

print(f"\nCompleted: {len(DATA['items']) - len(failed)}/{len(DATA['items'])} images")
if failed:
    print("Unresolved items (open source page and download manually):")
    for key, url in failed:
        print(f"  {key}: {url}")
    raise SystemExit(1)
