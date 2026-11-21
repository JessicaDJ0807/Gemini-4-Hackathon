"""Outfit visualization: one generated image per selected outfit.

mode="outfit":      the outfit on an anonymous figure, plain studio background.
mode="destination": same outfit in a generic setting inspired by the destination
                    (no specific landmarks, signage or text; illustrative only).

Never raises for generation problems: returns status="unavailable" so the
outfit recommendation flow is not blocked.
"""

import os
import time
from pathlib import Path
from typing import Literal, Optional

from dotenv import load_dotenv
from google import genai
from google.genai import types
from pydantic import BaseModel

from ..outfit_planning.models import Outfit, StyleProfile, WardrobeItem

SERVICE_DIR = Path(__file__).resolve().parents[2]
load_dotenv(SERVICE_DIR / ".env")
IMAGE_MODEL = os.getenv("IMAGE_MODEL", "gemini-3.1-flash-image")  # no Gemini 4 model outputs images
BRIEF_MODEL = os.getenv("PREVIEW_BRIEF_MODEL", "gemini-4-hydrogen")  # Gemini 4 writes the image brief
BRIEF_INSTRUCTION = (
    "You write image-generation prompts for a fashion lookbook. Given a draft prompt, rewrite it as one "
    "detailed paragraph that keeps EVERY listed garment with its exact color and silhouette, adds how the "
    "pieces are layered and styled to match the overall style, and keeps all the constraints (anonymous "
    "person with face hidden, the setting rules, no landmarks, no text, no logos). Do not add garments. "
    "Return only the prompt."
)
GENERATED_DIR = SERVICE_DIR / "generated"  # git-ignored; served at /media/generated/


class PreviewRequest(BaseModel):
    outfit: Outfit
    wardrobe: list[WardrobeItem] = []
    styleProfile: Optional[StyleProfile] = None
    destinationName: Optional[str] = None
    mode: Literal["outfit", "destination"] = "outfit"


class PreviewResponse(BaseModel):
    outfitId: str
    mode: str
    status: Literal["ok", "unavailable"]
    imageRef: Optional[str] = None  # URL path served by the API, e.g. /media/generated/x.png
    filePath: Optional[str] = None
    model: str
    briefModel: Optional[str] = None  # Gemini 4 model that wrote the prompt; None = template fallback
    prompt: str
    limitations: list[str]
    error: Optional[str] = None


def describe_garments(outfit: Outfit, wardrobe: list[WardrobeItem]) -> list[str]:
    by_id = {w.id: w for w in wardrobe}
    lines = []
    for wid in outfit.wardrobeItemIds:
        w = by_id.get(wid)
        if w:
            lines.append(f"- {w.name} ({w.category}{', ' + w.color if w.color else ''})")
    for m in outfit.missingItems:
        bits = [m.color, m.material, m.silhouette, m.category]
        lines.append(f"- {m.description} ({', '.join(b for b in bits if b)})")
    return lines


def build_prompt(req: PreviewRequest) -> str:
    garments = "\n".join(describe_garments(req.outfit, req.wardrobe)) or "- (no garments listed)"
    style = ""
    if req.styleProfile:
        traits = req.styleProfile.aesthetics + req.styleProfile.styleTags
        style = f"Overall style: {', '.join(dict.fromkeys(traits))}.\n" if traits else ""
    if req.mode == "destination" and req.destinationName:
        scene = (f"Setting: a generic scene inspired by the general atmosphere of {req.destinationName} "
                 "(streets, nature or architecture typical of the region). Do NOT depict specific "
                 "landmarks, readable signs, logos or text.")
    else:
        scene = "Setting: plain light-grey studio background, soft even lighting."
    return (
        "Fashion lookbook photo of ONE complete outfit, full body, head to toe.\n"
        "Show exactly these garments, keeping their colors and silhouettes; add nothing else "
        "except plain neutral basics if needed for modesty:\n"
        f"{garments}\n{style}"
        "The person is anonymous: face turned away or cropped out, no recognizable person.\n"
        f"{scene}\nNo text, no watermark, no brand logos."
    )


def write_brief(client: genai.Client, draft: str) -> str | None:
    """Gemini 4 turns the template into a richer image prompt. None on failure."""
    try:
        r = client.models.generate_content(
            model=BRIEF_MODEL, contents=draft,
            config=types.GenerateContentConfig(system_instruction=BRIEF_INSTRUCTION))
        return r.text.strip() if r.text and r.text.strip() else None
    except Exception:
        return None


def visualize_outfit(req: PreviewRequest, client: genai.Client | None = None) -> PreviewResponse:
    prompt = build_prompt(req)
    limitations = ["Illustrative image; not an exact depiction of the garments' fit, fabric or the real destination."]
    brief_model = None
    try:
        client = client or genai.Client()
        brief = write_brief(client, prompt)
        if brief:
            prompt, brief_model = brief, BRIEF_MODEL
    except Exception:
        pass
    base = dict(outfitId=req.outfit.id, mode=req.mode, model=IMAGE_MODEL, briefModel=brief_model,
                prompt=prompt, limitations=limitations)
    try:
        response = client.models.generate_content(
            model=IMAGE_MODEL, contents=prompt,
            config=types.GenerateContentConfig(response_modalities=["IMAGE"],
                                               image_config=types.ImageConfig(aspect_ratio="3:4")),
        )
        parts = response.candidates[0].content.parts if response.candidates else []
        image = next((p.inline_data for p in parts or [] if p.inline_data and p.inline_data.data), None)
        if image is None:
            return PreviewResponse(status="unavailable", error="Model returned no image.", **base)
        ext = "png" if "png" in (image.mime_type or "") else "jpg"
        GENERATED_DIR.mkdir(parents=True, exist_ok=True)
        name = f"{req.outfit.id}-{req.mode}-{int(time.time())}.{ext}"
        (GENERATED_DIR / name).write_bytes(image.data)
        return PreviewResponse(status="ok", imageRef=f"/media/generated/{name}",
                               filePath=str(GENERATED_DIR / name), **base)
    except Exception as e:
        return PreviewResponse(status="unavailable", error=f"{type(e).__name__}: {str(e)[:200]}", **base)
