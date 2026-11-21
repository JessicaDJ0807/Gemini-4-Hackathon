"""Style extraction experiment: inspiration images -> StyleProfile.

Run from services/ai/ with the venv active:
    python -m src.style_analysis.extract                 # all images in tests/fixtures/media
    python -m src.style_analysis.extract --runs 2        # repeat to check consistency

Each run is saved to runs/style_extraction/<timestamp>-<n>.json with the exact
prompt version, settings, image-id mapping, raw output, timing and token usage.
"""

import argparse
import json
import os
import time
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types

from .schema import StyleExtraction, invalid_image_ids, to_style_profile

SERVICE_DIR = Path(__file__).resolve().parents[2]
MEDIA_DIR = SERVICE_DIR / "tests" / "fixtures" / "media"
RUNS_DIR = SERVICE_DIR / "runs" / "style_extraction"
PROMPT_VERSION = "style_analysis_v1"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".heic"}

load_dotenv(SERVICE_DIR / ".env")
MODEL = os.getenv("STYLE_MODEL", "gemini-4-neon")


def upload_images(client: genai.Client, paths: list[Path]) -> list[types.File]:
    files = []
    for p in paths:
        f = client.files.upload(file=p, config={"display_name": p.name})
        while f.state and f.state.name == "PROCESSING":
            time.sleep(1)
            f = client.files.get(name=f.name)
        if f.state and f.state.name == "FAILED":
            raise RuntimeError(f"Upload failed for {p.name}")
        files.append(f)
    return files


def run_once(client, image_ids, files, prompt, config) -> dict:
    contents: list = []
    for image_id, f in zip(image_ids, files):
        contents.append(f"Image id: {image_id}")
        contents.append(f)
    contents.append("Build the style profile from these images.")

    start = time.perf_counter()
    response = client.models.generate_content(model=MODEL, contents=contents, config=config)
    elapsed = time.perf_counter() - start

    extraction: StyleExtraction = response.parsed
    usage = response.usage_metadata
    return {
        "elapsed_seconds": round(elapsed, 1),
        "usage": {
            "prompt_tokens": usage.prompt_token_count,
            "output_tokens": usage.candidates_token_count,
            "thinking_tokens": usage.thoughts_token_count,
            "total_tokens": usage.total_token_count,
        },
        "invalid_image_ids": invalid_image_ids(extraction, set(image_ids)),
        "missing_per_image": sorted(set(image_ids) - {o.image_id for o in extraction.per_image}),
        "style_profile": to_style_profile(extraction, image_ids),
        "extraction": extraction.model_dump(),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs", type=int, default=1)
    args = parser.parse_args()

    paths = sorted(p for p in MEDIA_DIR.iterdir() if p.suffix.lower() in IMAGE_EXTS)
    if not paths:
        raise SystemExit(f"No images in {MEDIA_DIR}")
    image_ids = [f"img-{i:02d}" for i in range(1, len(paths) + 1)]
    prompt = (SERVICE_DIR / "prompts" / f"{PROMPT_VERSION}.md").read_text()

    # Settings: everything not listed here is left at the model's default.
    config = types.GenerateContentConfig(
        system_instruction=prompt,
        response_mime_type="application/json",
        response_schema=StyleExtraction,
    )

    client = genai.Client()
    print(f"Uploading {len(paths)} images...")
    files = upload_images(client, paths)

    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    try:
        for n in range(1, args.runs + 1):
            print(f"Run {n}/{args.runs} with {MODEL}...")
            result = run_once(client, image_ids, files, prompt, config)
            record = {
                "model": MODEL,
                "prompt_version": PROMPT_VERSION,
                "settings": "defaults except system_instruction + JSON schema output",
                "images": {i: p.name for i, p in zip(image_ids, paths)},
                **result,
            }
            out = RUNS_DIR / f"{stamp}-{n}.json"
            out.write_text(json.dumps(record, indent=2, ensure_ascii=False))
            print(f"  {result['elapsed_seconds']}s, {result['usage']['total_tokens']} tokens, "
                  f"invalid ids: {result['invalid_image_ids'] or 'none'} -> {out.relative_to(SERVICE_DIR)}")
    finally:
        for f in files:
            client.files.delete(name=f.name)


if __name__ == "__main__":
    main()
