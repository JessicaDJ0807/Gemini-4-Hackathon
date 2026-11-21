"""Production style analysis: POST /v1/style-analysis (docs/integrations/ai-app-api.md).

Flow: validate request -> download each media file from B's readUrl ->
send tags + notes + media to Gemini 4 -> validate ids -> map to the contract's
suggestedProfile + observations. Reuses the StyleExtraction schema from the experiments.
"""

import json
import os
import tempfile
import time
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv
from google import genai
from google.genai import types
from pydantic import BaseModel

from ..outfit_planning.models import MediaRef, StyleDirection, StyleProfile
from .schema import StyleExtraction, invalid_image_ids

SERVICE_DIR = Path(__file__).resolve().parents[2]
load_dotenv(SERVICE_DIR / ".env")
MODEL = os.getenv("STYLE_MODEL", "gemini-4-neon")
PROMPT_VERSION = "style_analysis_v3"
PROMPT = (SERVICE_DIR / "prompts" / f"{PROMPT_VERSION}.md").read_text()
ALLOWED_HOSTS = {h.strip() for h in os.getenv("MEDIA_ALLOWED_HOSTS", "").split(",") if h.strip()}
IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
VIDEO_TYPES = {"video/mp4", "video/webm"}
MAX_IMAGE_MB, MAX_VIDEO_MB, MAX_MEDIA = 20, 100, 10


class StyleAnalysisError(Exception):
    def __init__(self, code: str, message: str, retryable: bool, status: int):
        super().__init__(message)
        self.code, self.message, self.retryable, self.status = code, message, retryable, status


# ---------- contract models ----------

class StyleAnalysisRequest(BaseModel):
    requestId: str
    inputRevision: int
    tags: list[str] = []
    avoidances: list[str] = []
    notes: Optional[str] = None
    media: list[MediaRef] = []


class Observation(BaseModel):
    mediaId: str
    detail: str
    timestampSeconds: Optional[float] = None


class StyleDirectionOut(BaseModel):  # extension
    name: str
    description: str
    strength: str
    visualReferenceIds: list[str]


class StyleAnalysisResponse(BaseModel):
    requestId: str
    inputRevision: int
    suggestedProfile: StyleProfile
    observations: list[Observation]
    warnings: list[str]
    styleDirections: list[StyleDirectionOut] = []  # extension
    model: Optional[str] = None  # extension


# ---------- media download ----------

def check_media(req: StyleAnalysisRequest) -> None:
    if len(req.media) > MAX_MEDIA:
        raise StyleAnalysisError("PAYLOAD_TOO_LARGE", f"At most {MAX_MEDIA} media items.", False, 413)
    if len({m.id for m in req.media}) != len(req.media):
        raise StyleAnalysisError("INVALID_REQUEST", "Duplicate media ids.", False, 400)
    for m in req.media:
        allowed = IMAGE_TYPES if m.kind == "image" else VIDEO_TYPES
        if m.mimeType not in allowed:
            raise StyleAnalysisError("UNSUPPORTED_MEDIA", f"{m.id}: {m.mimeType} not supported for {m.kind}.", False, 415)
        url = urlparse(m.readUrl)
        if url.scheme not in ("http", "https"):
            raise StyleAnalysisError("INVALID_REQUEST", f"{m.id}: readUrl must be http(s).", False, 400)
        if ALLOWED_HOSTS and url.hostname not in ALLOWED_HOSTS:
            raise StyleAnalysisError("MEDIA_FORBIDDEN", f"{m.id}: media host not allowed.", False, 403)


def download(m: MediaRef) -> bytes:
    limit = (MAX_IMAGE_MB if m.kind == "image" else MAX_VIDEO_MB) * 1024 * 1024
    try:
        with httpx.stream("GET", m.readUrl, timeout=30, follow_redirects=False) as r:
            if r.status_code in (401, 403):
                raise StyleAnalysisError("MEDIA_FORBIDDEN", f"{m.id}: media URL refused access.", False, 403)
            r.raise_for_status()
            data = b""
            for chunk in r.iter_bytes():
                data += chunk
                if len(data) > limit:
                    raise StyleAnalysisError("PAYLOAD_TOO_LARGE", f"{m.id}: file is too large.", False, 413)
            return data
    except StyleAnalysisError:
        raise
    except Exception as e:  # never echo the signed URL
        raise StyleAnalysisError("MEDIA_UNREADABLE", f"{m.id}: could not download media ({type(e).__name__}).", True, 400) from e


def to_part(client: genai.Client, m: MediaRef, data: bytes):
    if m.kind == "image":
        return types.Part.from_bytes(data=data, mime_type=m.mimeType)
    # Videos go through the Files API and must finish processing first.
    suffix = ".mp4" if m.mimeType == "video/mp4" else ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
        tmp.write(data)
        tmp.flush()
        f = client.files.upload(file=tmp.name, config={"mime_type": m.mimeType, "display_name": m.id})
    deadline = time.time() + 120
    while f.state and f.state.name == "PROCESSING" and time.time() < deadline:
        time.sleep(2)
        f = client.files.get(name=f.name)
    if not f.state or f.state.name != "ACTIVE":
        raise StyleAnalysisError("MEDIA_UNREADABLE", f"{m.id}: video could not be processed.", True, 400)
    return f


def unique(labels) -> list[str]:
    """Deduplicate ignoring case and spacing; keep the first spelling."""
    seen, out = set(), []
    for label in labels:
        key = " ".join(label.lower().split())
        if key and key not in seen:
            seen.add(key)
            out.append(label)
    return out


STRENGTH_RANK = {"dominant": 0, "secondary": 1, "minor": 2}


def profile_directions(ex: StyleExtraction, directions: list["StyleDirectionOut"],
                       tags: list[str]) -> list[StyleDirection]:
    """Give each direction the traits seen in its own media, strongest first.

    A trait belongs to a direction when it cites at least one of that direction's
    media ids. Traits that cite no media (from tags/notes) go to the strongest direction.
    """
    ordered = sorted(directions, key=lambda d: STRENGTH_RANK.get(d.strength, 3))
    garments = {o.image_id: o.garments for o in ex.per_image}
    out = []
    for n, d in enumerate(ordered):
        ids = set(d.visualReferenceIds)
        strongest = n == 0

        def pick(traits):
            return unique(t.label for t in traits
                          if (set(t.image_ids) & ids) or (strongest and not t.image_ids))

        if not ids:
            source = "tags"
        elif strongest and tags:
            source = "both"  # the user's tags also feed the strongest direction
        else:
            source = "media"
        out.append(StyleDirection(
            id=f"dir-{n + 1:02d}", name=d.name, strength=d.strength, description=d.description,
            colors=pick(ex.colors), silhouettes=pick(ex.silhouettes),
            stylingPatterns=pick(ex.styling_patterns),
            keyPieces=unique(g for i in d.visualReferenceIds for g in garments.get(i, []))[:6],
            visualReferenceIds=d.visualReferenceIds, source=source,
        ))
    return out


# ---------- entry point ----------

def analyze_style(req: StyleAnalysisRequest, client: genai.Client | None = None) -> StyleAnalysisResponse:
    tags = [t.strip() for t in req.tags if t.strip()]
    avoidances = [a.strip() for a in req.avoidances if a.strip()]
    notes = (req.notes or "").strip()
    if not (tags or notes or req.media):
        raise StyleAnalysisError("INVALID_REQUEST", "Provide at least one tag, note, or media item.", False, 400)
    check_media(req)

    client = client or genai.Client()
    warnings: list[str] = []
    contents: list = [json.dumps({"tags": tags, "notes": notes or None}, ensure_ascii=False)]
    uploaded = []
    try:
        for m in req.media:
            part = to_part(client, m, download(m))
            if m.kind == "video":
                uploaded.append(part)
            contents += [f"Media id: {m.id} ({m.kind})", part]
        contents.append("Build the style profile from these inputs.")

        try:
            response = client.models.generate_content(
                model=MODEL, contents=contents,
                config=types.GenerateContentConfig(system_instruction=PROMPT,
                                                   response_mime_type="application/json",
                                                   response_schema=StyleExtraction))
        except Exception as e:
            raise StyleAnalysisError("AI_UNAVAILABLE", f"Style analysis failed: {type(e).__name__}", True, 503) from e
    finally:
        for f in uploaded:
            try:
                client.files.delete(name=f.name)
            except Exception:
                pass

    ex: StyleExtraction | None = response.parsed
    if ex is None:
        raise StyleAnalysisError("INVALID_UPSTREAM", "Model returned no usable profile.", True, 502)

    # Deterministic clean-up: drop any id that wasn't supplied.
    valid = {m.id for m in req.media}
    bad = invalid_image_ids(ex, valid)
    if bad:
        warnings.append(f"Removed references to unknown media ids {bad}.")
    keep = lambda ids: [i for i in dict.fromkeys(ids) if i in valid]
    labels = lambda traits: unique(t.label for t in traits)

    observations = []
    for o in ex.per_image:
        if o.image_id in valid:
            detail = "; ".join(o.garments)
            if o.notes:
                detail += f". {o.notes}"
            observations.append(Observation(mediaId=o.image_id, detail=detail))
    missing = valid - {o.mediaId for o in observations}
    if missing:
        warnings.append(f"No observation returned for media {sorted(missing)}.")
    if ex.avoidances:
        warnings.append("Model-suggested dislikes were ignored; avoidances come only from the user.")

    directions = [StyleDirectionOut(name=d.name, description=d.description, strength=d.strength,
                                    visualReferenceIds=keep(d.image_ids)) for d in ex.style_directions]
    main = [d.name for d in sorted(directions, key=lambda d: {"dominant": 0, "secondary": 1}.get(d.strength, 2))
            if d.strength in ("dominant", "secondary")]
    profile = StyleProfile(
        styleTags=unique(tags + main + labels(ex.aesthetics)),
        colors=labels(ex.colors),
        avoidances=avoidances,  # the user's own, preserved exactly
        visualReferenceIds=[m.id for m in req.media if m.id in {i for d in directions for i in d.visualReferenceIds}
                            or m.id in {o.mediaId for o in observations}],
        notes=ex.summary,
        aesthetics=labels(ex.aesthetics),
        silhouettes=labels(ex.silhouettes),
        stylingPatterns=labels(ex.styling_patterns),
        directions=profile_directions(ex, directions, tags),
    )
    if not req.media:
        warnings.append("No media supplied; profile is based on tags and notes only.")
    return StyleAnalysisResponse(requestId=req.requestId, inputRevision=req.inputRevision,
                                 suggestedProfile=profile, observations=observations,
                                 warnings=warnings, styleDirections=directions, model=MODEL)
