"""Experiment 02: multi-image style boards (coherent, outlier, mixed, reordered).

Run from services/ai/ with the venv active:
    python -m src.style_analysis.experiment_02 --validate-only   # check fixtures, no API calls
    python -m src.style_analysis.experiment_02 --runs 2          # run all cases, then summarize
    python -m src.style_analysis.experiment_02 --summarize-only  # re-score saved outputs

Reuses Experiment 01's upload + generate step and StyleExtraction schema.
Only the prompt changes (style_analysis_v2). Outputs go to runs/style_extraction_exp02/.
"""

import argparse
import json
import time
from pathlib import Path

from google import genai
from google.genai import types

from .extract import MODEL, SERVICE_DIR, run_once, upload_images
from .schema import StyleExtraction

FIXTURE_DIR = SERVICE_DIR / "tests" / "fixtures" / "media" / "style_inspiration_fixture_pack"
RUNS_DIR = SERVICE_DIR / "runs" / "style_extraction_exp02"
PROMPT_VERSION = "style_analysis_v2"
EXPECTED_PHOTOS = 20
STRENGTH_ORDER = {"dominant": 0, "secondary": 1, "minor": 2}
TRAIT_GROUPS = ("aesthetics", "colors", "silhouettes", "styling_patterns")


# ---------- fixtures ----------

def load_manifest(fixture_dir: Path) -> dict:
    manifest = json.loads((fixture_dir / "manifest.json").read_text())
    photos = {p["id"]: p for p in manifest["photos"]}
    problems = []
    if len(manifest["photos"]) != EXPECTED_PHOTOS:
        problems.append(f"expected {EXPECTED_PHOTOS} photos, manifest lists {len(manifest['photos'])}")
    if len(photos) != len(manifest["photos"]):
        problems.append("duplicate photo ids in manifest")
    for pid, p in photos.items():
        path = fixture_dir / p["path"]
        if not path.is_file() or path.stat().st_size == 0:
            problems.append(f"{pid}: missing or empty file {p['path']}")
            continue
        with open(path, "rb") as fh:
            if fh.read(3) != b"\xff\xd8\xff":
                problems.append(f"{pid}: not a JPEG ({p['path']})")
        if Path(p["path"]).parts[1] != p["board"]:
            problems.append(f"{pid}: file is not in its board folder '{p['board']}'")
    for name, case in manifest["cases"].items():
        unknown = [i for i in case["image_ids"] if i not in photos]
        if unknown:
            problems.append(f"case {name}: unknown ids {unknown}")
    if problems:
        raise SystemExit("Fixture validation failed:\n  " + "\n  ".join(problems))
    return manifest


# ---------- running ----------

def run_cases(manifest: dict, fixture_dir: Path, runs: int) -> None:
    photos = {p["id"]: p for p in manifest["photos"]}
    prompt = (SERVICE_DIR / "prompts" / f"{PROMPT_VERSION}.md").read_text()
    # Same settings as Experiment 01: everything else at model defaults.
    config = types.GenerateContentConfig(
        system_instruction=prompt,
        response_mime_type="application/json",
        response_schema=StyleExtraction,
    )

    client = genai.Client()
    needed = sorted({i for c in manifest["cases"].values() for i in c["image_ids"]})
    print(f"Uploading {len(needed)} images once, shared by all cases...")
    uploaded = dict(zip(needed, upload_images(client, [fixture_dir / photos[i]["path"] for i in needed])))

    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    try:
        for name, case in manifest["cases"].items():
            ids = case["image_ids"]
            for n in range(1, runs + 1):
                print(f"{name} run {n}/{runs}...", flush=True)
                record = {
                    "case": name,
                    "run": n,
                    "case_spec": case,
                    "model": MODEL,
                    "prompt_version": PROMPT_VERSION,
                    "settings": "defaults except system_instruction + JSON schema output (same as exp 01)",
                    "images": {i: {"path": photos[i]["path"], "board": photos[i]["board"],
                                   "pexels_id": photos[i]["pexels_id"]} for i in ids},
                }
                try:
                    record.update(run_once(client, ids, [uploaded[i] for i in ids], prompt, config))
                    record["status"] = "ok"
                    print(f"  {record['elapsed_seconds']}s, {record['usage']['total_tokens']} tokens")
                except Exception as e:  # record failures instead of dropping them
                    record.update(status="error", error=f"{type(e).__name__}: {e}")
                    print(f"  FAILED: {record['error']}")
                (RUNS_DIR / f"{name}__run{n}.json").write_text(
                    json.dumps(record, indent=2, ensure_ascii=False))
    finally:
        for f in uploaded.values():
            client.files.delete(name=f.name)


# ---------- scoring ----------

def top_direction(directions: list[dict]) -> dict | None:
    return min(directions, key=lambda d: STRENGTH_ORDER.get(d["strength"], 9)) if directions else None


def partition(directions: list[dict]) -> set[frozenset]:
    return {frozenset(d["image_ids"]) for d in directions}


def jaccard(a: set, b: set) -> float:
    return round(len(a & b) / len(a | b), 2) if a | b else 1.0


def score(record: dict, photos: dict) -> dict:
    s = {"case": record["case"], "run": record["run"], "status": record["status"]}
    if record["status"] != "ok":
        return s | {"error": record.get("error")}
    e, case = record["extraction"], record["case_spec"]
    dirs = e["style_directions"]
    top = top_direction(dirs)
    traits = [t for g in TRAIT_GROUPS for t in e[g]]
    s |= {
        "seconds": record["elapsed_seconds"],
        "tokens": record["usage"]["total_tokens"],
        "thinking_tokens": record["usage"]["thinking_tokens"],
        "invalid_ids": record["invalid_image_ids"],
        "missing_images": record["missing_per_image"],
        "n_directions": len(dirs),
        "directions": [f"[{d['strength']}] {d['name']} {d['image_ids']}" for d in dirs],
        "top_direction": top["name"] if top else None,
        "top_strength": top["strength"] if top else None,
        "n_traits": len(traits),
        "shared_traits_pct": round(100 * sum(len(set(t["image_ids"])) >= 2 for t in traits) / len(traits)) if traits else 0,
        "uncited_traits": [t["label"] for t in traits if not t["image_ids"]],
        "avoidances": [t["label"] for t in e["avoidances"]],
    }
    if "expected_primary" in case:
        expected = {i for i in case["image_ids"] if photos[i]["board"] == case["expected_primary"]}
        got = set(top["image_ids"]) if top else set()
        s["primary_recall"] = f"{len(got & expected)}/{len(expected)}"
        s["primary_extra"] = sorted(got - expected)
    if "expected_secondary" in case:
        sec = {i for i in case["image_ids"] if photos[i]["board"] == case["expected_secondary"]}
        match = [d for d in dirs if d is not top and sec <= set(d["image_ids"])]
        s["secondary_found"] = f"[{match[0]['strength']}] {match[0]['name']}" if match else None
    if case["kind"] == "outlier":
        out = [i for i in case["image_ids"] if photos[i]["board"] != case["expected_primary"]]
        s["outlier_ids"] = out
        s["outlier_in_top"] = any(i in (top["image_ids"] if top else []) for i in out)
        s["outlier_kept_as_direction"] = any(set(out) <= set(d["image_ids"]) for d in dirs if d is not top)
    return s


def summarize(manifest: dict) -> None:
    photos = {p["id"]: p for p in manifest["photos"]}
    records = {}
    for f in sorted(RUNS_DIR.glob("*__run*.json")):
        r = json.loads(f.read_text())
        records[(r["case"], r["run"])] = r
    scores = [score(r, photos) for r in records.values()]

    def aesthetics(r):
        return {t["label"].lower() for t in r["extraction"]["aesthetics"]} if r["status"] == "ok" else set()

    comparisons = []
    for name, case in manifest["cases"].items():
        r1, r2 = records.get((name, 1)), records.get((name, 2))
        if r1 and r2 and r1["status"] == r2["status"] == "ok":
            comparisons.append({
                "kind": "run1 vs run2", "case": name,
                "same_grouping": partition(r1["extraction"]["style_directions"]) == partition(r2["extraction"]["style_directions"]),
                "aesthetics_jaccard": jaccard(aesthetics(r1), aesthetics(r2)),
            })
        if case["kind"] == "permutation":
            base = case["compare_with"]
            for n in (1, 2):
                a, b = records.get((base, n)), records.get((name, n))
                if a and b and a["status"] == b["status"] == "ok":
                    comparisons.append({
                        "kind": f"order (run {n})", "case": f"{name} vs {base}",
                        "same_grouping": partition(a["extraction"]["style_directions"]) == partition(b["extraction"]["style_directions"]),
                        "aesthetics_jaccard": jaccard(aesthetics(a), aesthetics(b)),
                        "top_direction": [top_direction(a["extraction"]["style_directions"])["name"],
                                          top_direction(b["extraction"]["style_directions"])["name"]],
                    })

    (RUNS_DIR / "summary.json").write_text(json.dumps(
        {"model": MODEL, "prompt_version": PROMPT_VERSION, "scores": scores, "comparisons": comparisons},
        indent=2, ensure_ascii=False))
    print(json.dumps({"scores": scores, "comparisons": comparisons}, indent=1, ensure_ascii=False))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixtures", type=Path, default=FIXTURE_DIR)
    parser.add_argument("--runs", type=int, default=2)
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--summarize-only", action="store_true")
    args = parser.parse_args()

    manifest = load_manifest(args.fixtures)
    print(f"Fixtures OK: {len(manifest['photos'])} photos, {len(manifest['cases'])} cases")
    if args.validate_only:
        return
    if not args.summarize_only:
        run_cases(manifest, args.fixtures, args.runs)
    summarize(manifest)


if __name__ == "__main__":
    main()
