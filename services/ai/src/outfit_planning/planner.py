"""Outfit planning: StyleProfile + wardrobe + trip -> validated outfits.

Gemini drafts the outfits (structured JSON); everything after that is
deterministic Python validation so the response only contains ids, dates and
attractions that exist in the request.
"""

import json
import os
from datetime import date, timedelta
from pathlib import Path
from typing import Literal, Optional

from dotenv import load_dotenv
from google import genai
from google.genai import types
from pydantic import BaseModel

from .models import (MissingItem, Outfit, OutfitPiece, OutfitPlanRequest,
                     OutfitPlanResponse, WardrobeItem)
from .shopping import build_search_query, identify_shopping_gaps

SERVICE_DIR = Path(__file__).resolve().parents[2]
load_dotenv(SERVICE_DIR / ".env")
MODEL = os.getenv("OUTFIT_MODEL", "gemini-4-hydrogen")
PROMPT = (SERVICE_DIR / "prompts" / "outfit_planning_v1.md").read_text()
CATEGORIES = {"top", "bottom", "dress", "outerwear", "shoes", "accessory"}
MAX_TRIP_DAYS = 7


class PlanningError(Exception):
    def __init__(self, code: str, message: str, retryable: bool, status: int):
        super().__init__(message)
        self.code, self.message, self.retryable, self.status = code, message, retryable, status


# ---------- what we ask Gemini for ----------

class LlmMissingItem(BaseModel):
    description: str
    category: Optional[Literal["top", "bottom", "dress", "outerwear", "shoes", "accessory"]] = None
    color: Optional[str] = None
    silhouette: Optional[str] = None
    material: Optional[str] = None
    styleDescriptors: list[str] = []
    searchQuery: str
    priority: Literal["essential", "optional"]
    reason: str


class LlmOutfit(BaseModel):
    name: str
    date: str
    attractionIds: list[str]
    wardrobeItemIds: list[str]
    missingItems: list[LlmMissingItem]
    rationale: str
    occasions: list[str]
    styleConnections: list[str]
    stylingTips: list[str]


class LlmPlan(BaseModel):
    outfits: list[LlmOutfit]


# ---------- helpers ----------

def trip_days(req: OutfitPlanRequest) -> list[date]:
    start, end = req.trip.startDate, req.trip.endDate
    if end < start:
        raise PlanningError("INVALID_REQUEST", "endDate is before startDate.", False, 400)
    n = (end - start).days + 1
    if n > MAX_TRIP_DAYS:
        raise PlanningError("INVALID_REQUEST", f"Trips are limited to {MAX_TRIP_DAYS} days.", False, 400)
    return [start + timedelta(days=i) for i in range(n)]


def outfit_slots(days: list[date], count: int) -> list[date]:
    """Spread `count` outfits over the trip so every day gets one before any gets two."""
    return sorted(days[i % len(days)] for i in range(count))


def llm_input(req: OutfitPlanRequest, slots: list[date]) -> str:
    return json.dumps({
        "styleProfile": req.styleProfile.model_dump(exclude_none=True),
        "trip": json.loads(req.trip.model_dump_json(exclude_none=True)),
        "wardrobe": [w.model_dump(exclude={"imageUrl"}, exclude_none=True) for w in req.wardrobe],
        "preferences": req.preferences,
        "outfitsToCreate": [{"outfitNumber": i + 1, "date": d.isoformat()} for i, d in enumerate(slots)],
    }, ensure_ascii=False)


def is_complete(owned: list[WardrobeItem], missing: list[MissingItem]) -> bool:
    cats = {w.category for w in owned} | {m.category for m in missing if m.category}
    return ("dress" in cats or {"top", "bottom"} <= cats) and "shoes" in cats


# ---------- validation ----------

def validate(plan: LlmPlan, req: OutfitPlanRequest, slots: list[date]) -> tuple[list[Outfit], list[str]]:
    wardrobe = {w.id: w for w in req.wardrobe}
    attractions = {a.id: a for a in req.trip.attractions}
    days = set(slots)
    avoid = [a.lower() for a in req.styleProfile.avoidances]
    warnings: list[str] = []
    outfits: list[Outfit] = []

    for i, lo in enumerate(plan.outfits[: len(slots)]):
        oid = f"look-{i + 1:02d}"
        try:
            d = date.fromisoformat(lo.date)
        except ValueError:
            d = None
        if d not in days:
            warnings.append(f"{oid}: model returned date {lo.date!r}; assigned {slots[i]}.")
            d = slots[i]

        ids = list(dict.fromkeys(lo.wardrobeItemIds))
        unknown = [x for x in ids if x not in wardrobe]
        if unknown:
            warnings.append(f"{oid}: removed unknown wardrobe ids {unknown}.")
        owned = [wardrobe[x] for x in ids if x in wardrobe]

        bad_att = [a for a in lo.attractionIds if a not in attractions or attractions[a].date != d]
        if bad_att:
            warnings.append(f"{oid}: removed attractions not scheduled on {d}: {bad_att}.")
        att_ids = [a for a in dict.fromkeys(lo.attractionIds) if a not in bad_att]

        missing = []
        for j, m in enumerate(lo.missingItems):
            item = MissingItem(id=f"miss-{i + 1:02d}-{j + 1:02d}", **m.model_dump())
            if not item.searchQuery.strip():
                item.searchQuery = build_search_query(item)
            missing.append(item)

        for w in owned:
            text = f"{w.name} {' '.join(w.styleTags)}".lower()
            hits = [a for a in avoid if a in text]
            if hits:
                warnings.append(f"{oid}: uses {w.id} which matches avoidance {hits}.")
        if not is_complete(owned, missing):
            warnings.append(f"{oid}: may be incomplete (needs top+bottom or dress, and shoes).")

        by_cat: dict[str, list[OutfitPiece]] = {}
        for w in owned:
            by_cat.setdefault(w.category, []).append(OutfitPiece(id=w.id, name=w.name, owned=True))
        for m in missing:
            by_cat.setdefault(m.category or "other", []).append(
                OutfitPiece(id=m.id, name=m.description, owned=False))

        outfits.append(Outfit(
            id=oid, date=d, attractionIds=att_ids, wardrobeItemIds=[w.id for w in owned],
            rationale=lo.rationale, missingItems=missing, stylingTips=lo.stylingTips,
            name=lo.name, itemsByCategory=by_cat, occasions=lo.occasions,
            styleConnections=lo.styleConnections,
        ))
    return outfits, warnings


# ---------- entry point ----------

def generate_outfits(req: OutfitPlanRequest, client: genai.Client | None = None) -> OutfitPlanResponse:
    """Plan `req.outfitCount` outfits (default 3) across the trip days."""
    profile = req.styleProfile
    if not (profile.styleTags or profile.aesthetics or profile.colors or profile.notes):
        raise PlanningError("INVALID_REQUEST", "Style profile needs at least one positive preference.", False, 400)
    days = trip_days(req)
    slots = outfit_slots(days, req.outfitCount)

    warnings: list[str] = []
    if not req.wardrobe:
        warnings.append("Wardrobe is empty; every piece will be a suggested purchase.")
    for w in req.trip.weather:
        if w.kind == "unavailable":
            warnings.append(f"Weather unavailable for {w.date}; outfits for that day are not weather-verified.")
    weather_days = {w.date for w in req.trip.weather}
    for d in days:
        if d not in weather_days:
            warnings.append(f"No weather record for {d}; outfits for that day are not weather-verified.")
    per_day = max(slots.count(d) for d in days)
    if per_day > 2:
        warnings.append(f"{per_day} outfits on one day exceeds the contract's 1-2 per day.")
    if len(slots) < len(days):
        warnings.append("Fewer outfits than trip days; some days have no outfit.")

    client = client or genai.Client()
    config = types.GenerateContentConfig(
        system_instruction=PROMPT,
        response_mime_type="application/json",
        response_schema=LlmPlan,
    )
    contents = llm_input(req, slots)

    outfits: list[Outfit] = []
    for attempt in range(2):  # one retry if the model returns too few outfits
        try:
            response = client.models.generate_content(model=MODEL, contents=contents, config=config)
        except Exception as e:
            raise PlanningError("AI_UNAVAILABLE", f"Outfit generation failed: {type(e).__name__}", True, 503) from e
        plan = response.parsed
        if plan is None:
            continue
        outfits, check_warnings = validate(plan, req, slots)
        if len(outfits) == len(slots) and all(o.wardrobeItemIds or o.missingItems for o in outfits):
            warnings += check_warnings
            break
    else:
        if not outfits:
            raise PlanningError("INVALID_UPSTREAM", "Model returned no usable outfits.", True, 502)
        warnings += check_warnings
        warnings.append(f"Only {len(outfits)} of {len(slots)} requested outfits were usable.")

    return OutfitPlanResponse(
        requestId=req.requestId, inputRevision=req.inputRevision, outfits=outfits,
        warnings=warnings, shoppingGaps=identify_shopping_gaps(outfits, req.wardrobe), model=MODEL,
    )
