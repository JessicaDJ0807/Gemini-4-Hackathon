"""Outfit planning: StyleProfile + wardrobe + trip -> validated outfits.

Gemini drafts the outfits (structured JSON); everything after that is
deterministic Python validation so the response only contains ids, dates and
attractions that exist in the request.
"""

import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from urllib.parse import urlparse

import httpx
from pathlib import Path
from typing import Literal, Optional

from dotenv import load_dotenv
from google import genai
from google.genai import types
from pydantic import BaseModel

from .models import (InspirationNote, MediaRef, MissingItem, Outfit, OutfitPiece, OutfitPlanRequest,
                     OutfitPlanResponse, WardrobeItem, WeatherDay)
from .shopping import build_search_query, plan_shopping

SERVICE_DIR = Path(__file__).resolve().parents[2]
load_dotenv(SERVICE_DIR / ".env")
MODEL = os.getenv("OUTFIT_MODEL", "gemini-4-hydrogen")
PROMPT_VERSION = "outfit_planning_v4"
PROMPT = (SERVICE_DIR / "prompts" / f"{PROMPT_VERSION}.md").read_text()
CATEGORIES = {"top", "bottom", "dress", "outerwear", "shoes", "accessory"}
MAX_TRIP_DAYS = 7
ALLOWED_HOSTS = {h.strip() for h in os.getenv("MEDIA_ALLOWED_HOSTS", "").split(",") if h.strip()}
IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
VIDEO_TYPES = {"video/mp4", "video/webm"}
MAX_WARDROBE_IMAGE_MB = 10
MAX_INSPIRATION_MEDIA = 10
RAINY_PCT = 50   # at or above: expect a rain-ready layer
COLD_MAX_C = 12  # max temp at or below: expect outerwear


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
    inspirationReferenceIds: list[str] = []
    directionId: Optional[str] = None


class LlmInspirationNote(BaseModel):
    mediaId: str
    takeaway: str
    usable: bool


class LlmPlan(BaseModel):
    # Notes come first so the model studies every inspiration item before planning.
    inspirationNotes: list[LlmInspirationNote] = []
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


WEATHER_VALUES = ("minTempC", "maxTempC", "precipitationProbabilityPct", "conditions", "windKph", "humidityPct")


def normalize_weather(req: OutfitPlanRequest, days: list[date]) -> tuple[dict[date, WeatherDay], list[str]]:
    """One clean WeatherDay per trip day from B's records. Never fills in values."""
    trip_set = set(days)
    by_day: dict[date, WeatherDay] = {}
    warnings: list[str] = []
    for w in req.trip.weather:
        if w.date not in trip_set:
            warnings.append(f"Weather record for {w.date} is outside the trip; ignored.")
            continue
        if w.date in by_day:
            warnings.append(f"Duplicate weather records for {w.date}; used the first.")
            continue
        w = w.model_copy()
        if w.precipitationProbabilityPct is not None and not 0 <= w.precipitationProbabilityPct <= 100:
            warnings.append(f"Weather for {w.date}: rain probability {w.precipitationProbabilityPct} is out of range; ignored.")
            w.precipitationProbabilityPct = None
        if w.minTempC is not None and w.maxTempC is not None and w.minTempC > w.maxTempC:
            warnings.append(f"Weather for {w.date}: min temperature above max; temperatures ignored.")
            w.minTempC = w.maxTempC = None
        if w.kind == "unavailable":
            if any(getattr(w, f) is not None for f in WEATHER_VALUES):
                warnings.append(f"Weather for {w.date} is marked unavailable but has values; values ignored.")
            w = WeatherDay(date=w.date, kind="unavailable")
        elif all(getattr(w, f) is None for f in WEATHER_VALUES):
            warnings.append(f"Weather for {w.date} is marked {w.kind} but has no values; treated as unavailable.")
            w = WeatherDay(date=w.date, kind="unavailable")
        by_day[w.date] = w

    for d in days:
        if d not in by_day:
            warnings.append(f"No weather record for {d}; outfits for that day are not weather-verified.")
            by_day[d] = WeatherDay(date=d, kind="unavailable")
        elif by_day[d].kind == "unavailable":
            warnings.append(f"Weather unavailable for {d}; outfits for that day are not weather-verified.")
        elif by_day[d].kind == "climate":
            warnings.append(f"Weather for {d} is a seasonal estimate, not a forecast.")
    return by_day, warnings


def weather_for_llm(w: WeatherDay) -> dict:
    return w.model_dump(mode="json", include={"kind", *WEATHER_VALUES}, exclude_none=True)


def llm_input(req: OutfitPlanRequest, slots: list[date], weather: dict[date, WeatherDay]) -> str:
    return json.dumps({
        "styleProfile": req.styleProfile.model_dump(exclude_none=True),
        "trip": json.loads(req.trip.model_dump_json(exclude={"weather"}, exclude_none=True)),
        "wardrobe": [w.model_dump(exclude={"imageUrl"}, exclude_none=True) for w in req.wardrobe],
        "preferences": req.preferences,
        "outfitsToCreate": [{"outfitNumber": i + 1, "date": d.isoformat(), "weather": weather_for_llm(weather[d])}
                            for i, d in enumerate(slots)],
    }, ensure_ascii=False)


def fetch_image(item: WardrobeItem) -> tuple[str, types.Part | None, str | None]:
    """Download one wardrobe photo. Returns (id, part or None, warning or None)."""
    url = urlparse(item.imageUrl or "")
    if url.scheme not in ("http", "https"):
        return item.id, None, f"{item.id}: no usable imageUrl; planned from text only."
    if ALLOWED_HOSTS and url.hostname not in ALLOWED_HOSTS:
        return item.id, None, f"{item.id}: image host not allowed; planned from text only."
    try:
        r = httpx.get(item.imageUrl, timeout=15, follow_redirects=False)
        r.raise_for_status()
        mime = r.headers.get("content-type", "").split(";")[0].strip()
        if mime not in IMAGE_TYPES:
            return item.id, None, f"{item.id}: unsupported image type {mime or 'unknown'}; planned from text only."
        if len(r.content) > MAX_WARDROBE_IMAGE_MB * 1024 * 1024:
            return item.id, None, f"{item.id}: image too large; planned from text only."
        return item.id, types.Part.from_bytes(data=r.content, mime_type=mime), None
    except Exception as e:  # never echo the URL (may be signed)
        return item.id, None, f"{item.id}: image could not be downloaded ({type(e).__name__}); planned from text only."


def fetch_wardrobe_images(items: list[WardrobeItem]) -> tuple[dict[str, types.Part], list[str]]:
    if not items:
        return {}, []
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(fetch_image, items))
    parts = {i: p for i, p, _ in results if p is not None}
    warnings = [w for _, _, w in results if w]
    return parts, warnings


def select_inspiration(req: OutfitPlanRequest) -> tuple[list[MediaRef], list[str]]:
    """Inspiration media to send: the profile's visual references, safe types and hosts only."""
    warnings: list[str] = []
    refs = set(req.styleProfile.visualReferenceIds)
    chosen: list[MediaRef] = []
    seen: set[str] = set()
    for m in req.media:
        if m.id in seen:
            warnings.append(f"Inspiration {m.id}: duplicate id; used the first.")
            continue
        seen.add(m.id)
        if refs and m.id not in refs:
            warnings.append(f"Inspiration {m.id}: not in the profile's visualReferenceIds; not used.")
            continue
        allowed = IMAGE_TYPES if m.kind == "image" else VIDEO_TYPES
        url = urlparse(m.readUrl)
        if m.mimeType not in allowed:
            warnings.append(f"Inspiration {m.id}: {m.mimeType} not supported for {m.kind}; not used.")
        elif url.scheme not in ("http", "https"):
            warnings.append(f"Inspiration {m.id}: readUrl must be http(s); not used.")
        elif ALLOWED_HOSTS and url.hostname not in ALLOWED_HOSTS:
            warnings.append(f"Inspiration {m.id}: media host not allowed; not used.")
        elif len(chosen) >= MAX_INSPIRATION_MEDIA:
            warnings.append(f"Inspiration {m.id}: over the {MAX_INSPIRATION_MEDIA}-item limit; not used.")
        else:
            chosen.append(m)
    missing = [r for r in req.styleProfile.visualReferenceIds if r not in seen]
    if missing:
        warnings.append(f"Profile visual references with no media supplied: {missing}.")
    return chosen, warnings


def fetch_inspiration(client: genai.Client, items: list[MediaRef]) -> tuple[dict[str, object], list[str]]:
    """Download inspiration media (videos go through the Files API). Failures become warnings."""
    from ..style_analysis.service import StyleAnalysisError, download, to_part

    def one(m: MediaRef):
        try:
            return m.id, to_part(client, m, download(m)), None
        except StyleAnalysisError as e:
            return m.id, None, f"Inspiration {e.message} Planned without it."
        except Exception as e:  # never echo the signed URL
            return m.id, None, f"Inspiration {m.id}: could not be read ({type(e).__name__}). Planned without it."

    if not items:
        return {}, []
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(one, items))
    return {i: p for i, p, _ in results if p is not None}, [w for _, _, w in results if w]


def weather_warnings(oid: str, w: WeatherDay, owned: list[WardrobeItem], missing: list[MissingItem]) -> list[str]:
    """Deterministic sanity checks: does the outfit have a layer the weather clearly calls for?"""
    if w.kind == "unavailable":
        return []
    has_outer = any(x.category == "outerwear" for x in owned) or any(m.category == "outerwear" for m in missing)
    out = []
    if w.precipitationProbabilityPct is not None and w.precipitationProbabilityPct >= RAINY_PCT and not has_outer:
        out.append(f"{oid}: {w.precipitationProbabilityPct:.0f}% rain chance on {w.date} but no outer layer.")
    if w.maxTempC is not None and w.maxTempC <= COLD_MAX_C and not has_outer:
        out.append(f"{oid}: max {w.maxTempC:.0f}°C on {w.date} but no outerwear.")
    return out


def is_complete(owned: list[WardrobeItem], missing: list[MissingItem]) -> bool:
    cats = {w.category for w in owned} | {m.category for m in missing if m.category}
    return ("dress" in cats or {"top", "bottom"} <= cats) and "shoes" in cats


# ---------- validation ----------

def validate(plan: LlmPlan, req: OutfitPlanRequest, slots: list[date],
             weather: dict[date, WeatherDay] | None = None,
             inspiration_ids: set[str] = frozenset()) -> tuple[list[Outfit], list[str]]:
    weather = weather or {}
    wardrobe = {w.id: w for w in req.wardrobe}
    attractions = {a.id: a for a in req.trip.attractions}
    days = set(slots)
    avoid = [a.lower() for a in req.styleProfile.avoidances]
    directions = {d.id: d for d in req.styleProfile.directions}
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
        day_weather = weather.get(d) or WeatherDay(date=d, kind="unavailable")
        warnings += weather_warnings(oid, day_weather, owned, missing)

        insp = list(dict.fromkeys(lo.inspirationReferenceIds))
        bad_insp = [x for x in insp if x not in inspiration_ids]
        if bad_insp:
            warnings.append(f"{oid}: removed inspiration ids Gemini did not see: {bad_insp}.")
        insp = [x for x in insp if x in inspiration_ids]

        direction_id = lo.directionId if lo.directionId in directions else None
        if lo.directionId and direction_id is None:
            warnings.append(f"{oid}: removed unknown direction id {lo.directionId!r}.")

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
            styleConnections=lo.styleConnections, inspirationReferenceIds=insp,
            weatherKind=day_weather.kind, directionId=direction_id,
        ))

    warnings += variety_warnings(outfits, wardrobe)

    # A minor direction is a small accent, so it should not lead most of the trip.
    led_by_minor = [o.id for o in outfits if o.directionId and directions[o.directionId].strength == "minor"]
    has_stronger = any(d.strength != "minor" for d in directions.values())
    if has_stronger and len(led_by_minor) > len(outfits) // 3:
        warnings.append(f"Outfits {led_by_minor} are led by a minor style direction; "
                        "minor directions should only add accents.")
    return outfits, warnings


CORE_ROLES = ("top", "bottom", "outerwear", "shoes")  # a dress fills the "bottom" role


def variety_warnings(outfits: list[Outfit], wardrobe: dict[str, WardrobeItem]) -> list[str]:
    """Flag near-duplicate outfits: two looks that differ in fewer than two core roles."""
    def core(o: Outfit) -> dict[str, frozenset[str]]:
        roles: dict[str, set[str]] = {r: set() for r in CORE_ROLES}
        pieces = [(x, wardrobe[x].category) for x in o.wardrobeItemIds] + [(m.id, m.category) for m in o.missingItems]
        for pid, cat in pieces:
            role = "bottom" if cat == "dress" else cat
            if role in roles:
                roles[role].add(pid)
        return {r: frozenset(v) for r, v in roles.items()}

    out = []
    cores = [(o.id, core(o)) for o in outfits]
    for i, (a, ca) in enumerate(cores):
        for b, cb in cores[i + 1:]:
            differing = [r for r in ca if ca[r] != cb[r]]
            if len(differing) < 2:
                out.append(f"{a} and {b} are near-duplicates (differ only in {differing or 'nothing'}).")
    return out


def inspiration_notes(plan: LlmPlan, outfits: list[Outfit], seen: list[str]) -> tuple[list[InspirationNote], list[str]]:
    """Keep one note per inspiration item Gemini saw; report items no outfit used."""
    by_id = {}
    for n in plan.inspirationNotes:
        if n.mediaId in seen and n.mediaId not in by_id:
            by_id[n.mediaId] = n
    notes, warnings = [], []
    for mid in seen:
        used_in = [o.id for o in outfits if mid in o.inspirationReferenceIds]
        n = by_id.get(mid)
        if n is None:
            warnings.append(f"Inspiration {mid}: no note from the model.")
            if used_in:
                notes.append(InspirationNote(mediaId=mid, takeaway="", usable=True, usedInOutfitIds=used_in))
            continue
        notes.append(InspirationNote(mediaId=mid, takeaway=n.takeaway, usable=n.usable, usedInOutfitIds=used_in))
        if n.usable and not used_in:
            warnings.append(f"Inspiration {mid}: marked usable but no outfit used it.")
    return notes, warnings


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
    weather, weather_warns = normalize_weather(req, days)
    warnings += weather_warns
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
    contents: list = [llm_input(req, slots, weather)]
    images: dict[str, types.Part] = {}
    if req.useWardrobeImages:
        images, image_warnings = fetch_wardrobe_images(req.wardrobe)
        warnings += image_warnings
        for w in req.wardrobe:
            if w.id in images:
                contents += [f"Wardrobe item id: {w.id}", images[w.id]]
    inspiration: dict[str, object] = {}
    if req.useInspirationMedia and req.media:
        chosen, select_warnings = select_inspiration(req)
        inspiration, fetch_warnings = fetch_inspiration(client, chosen)
        warnings += select_warnings + fetch_warnings
        for m in chosen:
            if m.id in inspiration:
                contents += [f"Inspiration media id: {m.id}", inspiration[m.id]]

    outfits: list[Outfit] = []
    for attempt in range(2):  # one retry if the model returns too few outfits
        try:
            response = client.models.generate_content(model=MODEL, contents=contents, config=config)
        except Exception as e:
            raise PlanningError("AI_UNAVAILABLE", f"Outfit generation failed: {type(e).__name__}", True, 503) from e
        plan = response.parsed
        if plan is None:
            continue
        outfits, check_warnings = validate(plan, req, slots, weather, set(inspiration))
        notes, note_warnings = inspiration_notes(plan, outfits, [m.id for m in req.media if m.id in inspiration])
        check_warnings += note_warnings
        if len(outfits) == len(slots) and all(o.wardrobeItemIds or o.missingItems for o in outfits):
            warnings += check_warnings
            break
    else:
        if not outfits:
            raise PlanningError("INVALID_UPSTREAM", "Model returned no usable outfits.", True, 502)
        warnings += check_warnings
        warnings.append(f"Only {len(outfits)} of {len(slots)} requested outfits were usable.")

    gaps, shop_warnings = plan_shopping(outfits, req.wardrobe, profile, images, client)
    warnings += shop_warnings

    return OutfitPlanResponse(
        requestId=req.requestId, inputRevision=req.inputRevision, outfits=outfits,
        warnings=warnings, shoppingGaps=gaps, model=MODEL,
        wardrobeImagesUsed=[w.id for w in req.wardrobe if w.id in images],
        inspirationMediaUsed=[m.id for m in req.media if m.id in inspiration],
        inspirationNotes=notes,
    )
