"""Shopping gaps: turn outfits' missing items into a short list of shop searches.

`plan_shopping` asks Gemini to merge needs worded differently, swap in owned items
that do the job, keep a few ranked buys and write Shopify-friendly queries. Its
output is validated against the outfits and wardrobe; if the call fails, the
deterministic `identify_shopping_gaps` is used instead. The shopping integration
owns the actual product search, cart and checkout; this only says what to look
for and why.
"""

import json
import os
import re
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel

from .models import MissingItem, Outfit, ShoppingGap, StyleProfile, WardrobeItem

SERVICE_DIR = Path(__file__).resolve().parents[2]
PROMPT_VERSION = "shopping_v1"
PROMPT = (SERVICE_DIR / "prompts" / f"{PROMPT_VERSION}.md").read_text()
MAX_FALLBACK_QUERIES = 2


def build_search_query(item: MissingItem) -> str:
    """Fallback query from structured descriptors when the model left it blank."""
    parts = [item.color, item.material, item.silhouette, *item.styleDescriptors[:1],
             item.category if item.category not in (None, "accessory") else None]
    query = " ".join(p for p in parts if p)
    return query or item.description


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", text.lower()).strip()


def similar_owned(item: MissingItem, wardrobe: list[WardrobeItem]) -> list[str]:
    """Owned items with the same category and color: likely not a real gap."""
    if not item.category:
        return []
    color = _norm(item.color or "")
    return [w.id for w in wardrobe
            if w.category == item.category and color and color in _norm(w.color or "")]


def identify_shopping_gaps(outfits: list[Outfit], wardrobe: list[WardrobeItem]) -> list[ShoppingGap]:
    gaps: dict[str, ShoppingGap] = {}
    for outfit in outfits:
        for item in outfit.missingItems:
            key = _norm(item.searchQuery or build_search_query(item))
            if key in gaps:
                g = gaps[key]
                if outfit.id not in g.outfitIds:
                    g.outfitIds.append(outfit.id)
                g.missingItemIds.append(item.id)
                if item.priority == "essential":
                    g.priority = "essential"
                continue
            gaps[key] = ShoppingGap(
                id=f"gap-{len(gaps) + 1:02d}",
                searchQuery=item.searchQuery or build_search_query(item),
                category=item.category,
                color=item.color,
                silhouette=item.silhouette,
                material=item.material,
                styleDescriptors=item.styleDescriptors,
                priority=item.priority,
                reason=item.reason,
                outfitIds=[outfit.id],
                missingItemIds=[item.id],
                similarOwnedItemIds=similar_owned(item, wardrobe),
            )
    return list(gaps.values())


# ---------- AI shopping list ----------

class LlmSuggestion(BaseModel):
    missingItemIds: list[str]
    decision: Literal["buy", "use_owned"]
    ownedAlternativeId: Optional[str] = None
    searchQuery: str
    fallbackQueries: list[str] = []
    category: Optional[Literal["top", "bottom", "dress", "outerwear", "shoes", "accessory"]] = None
    color: Optional[str] = None
    silhouette: Optional[str] = None
    material: Optional[str] = None
    styleDescriptors: list[str] = []
    priority: Literal["essential", "optional"]
    rank: Optional[int] = None
    reason: str


class LlmShoppingList(BaseModel):
    suggestions: list[LlmSuggestion]


def shopping_input(outfits: list[Outfit], wardrobe: list[WardrobeItem], profile: StyleProfile | None) -> str:
    return json.dumps({
        "styleProfile": profile.model_dump(exclude_none=True) if profile else None,
        "wardrobe": [w.model_dump(exclude={"imageUrl"}, exclude_none=True) for w in wardrobe],
        "outfits": [{
            "id": o.id, "date": o.date.isoformat(), "name": o.name, "occasions": o.occasions,
            "ownedPieces": o.wardrobeItemIds,
            "missingItems": [m.model_dump(exclude_none=True) for m in o.missingItems],
        } for o in outfits],
    }, ensure_ascii=False)


def _clean_queries(primary: str, extra: list[str]) -> list[str]:
    seen, out = {_norm(primary)}, []
    for q in extra:
        q = " ".join(q.split())
        if q and _norm(q) not in seen:
            seen.add(_norm(q))
            out.append(q)
    return out[:MAX_FALLBACK_QUERIES]


def validate_shopping(plan: LlmShoppingList, outfits: list[Outfit],
                      wardrobe: list[WardrobeItem]) -> tuple[list[ShoppingGap], list[str]]:
    """Keep only real ids; every missing item ends up in exactly one gap."""
    items = {m.id: (m, o.id) for o in outfits for m in o.missingItems}
    owned = {w.id: w for w in wardrobe}
    assigned: set[str] = set()
    warnings: list[str] = []
    gaps: list[ShoppingGap] = []

    for s in plan.suggestions:
        ids = [i for i in dict.fromkeys(s.missingItemIds) if i in items and i not in assigned]
        dropped = [i for i in s.missingItemIds if i not in items]
        if dropped:
            warnings.append(f"Shopping: removed unknown missing-item ids {dropped}.")
        if not ids:
            continue
        assigned.update(ids)
        group = [items[i][0] for i in ids]
        first = group[0]
        category = s.category or first.category

        decision, alt = s.decision, s.ownedAlternativeId
        if decision == "use_owned":
            w = owned.get(alt or "")
            if w is None or (category and w.category != category):
                warnings.append(f"Shopping: owned alternative {alt!r} for {ids} is unknown or a different "
                                "category; kept as a buy.")
                decision, alt = "buy", None
        else:
            alt = None

        query = " ".join(s.searchQuery.split()) or first.searchQuery or build_search_query(first)
        gap = ShoppingGap(
            id="", searchQuery=query, category=category, color=s.color or first.color,
            silhouette=s.silhouette or first.silhouette, material=s.material or first.material,
            styleDescriptors=s.styleDescriptors or first.styleDescriptors,
            # the model may not downgrade a need an outfit marked essential
            priority="essential" if s.priority == "essential" or any(m.priority == "essential" for m in group)
            else "optional",
            reason=s.reason or first.reason,
            outfitIds=list(dict.fromkeys(items[i][1] for i in ids)),
            missingItemIds=ids,
            decision=decision, ownedAlternativeId=alt,
            fallbackQueries=_clean_queries(query, s.fallbackQueries),
            rank=s.rank if decision == "buy" else None,
        )
        if decision == "buy":
            gap.similarOwnedItemIds = similar_owned(gap, wardrobe)  # duck-typed: category + color
        gaps.append(gap)

    leftover = [i for i in items if i not in assigned]
    if leftover:
        warnings.append(f"Shopping: model skipped missing items {leftover}; added them as plain searches.")
        rest = [o.model_copy(update={"missingItems": [m for m in o.missingItems if m.id in leftover]})
                for o in outfits]
        gaps += identify_shopping_gaps(rest, wardrobe)

    buys = sorted((g for g in gaps if g.decision == "buy"), key=lambda g: (g.rank is None, g.rank or 0))
    for n, g in enumerate(buys, 1):
        g.rank = n
    ordered = buys + [g for g in gaps if g.decision == "use_owned"]
    for n, g in enumerate(ordered, 1):
        g.id = f"gap-{n:02d}"
    return ordered, warnings


def plan_shopping(outfits: list[Outfit], wardrobe: list[WardrobeItem], profile: StyleProfile | None = None,
                  images: dict | None = None, client=None) -> tuple[list[ShoppingGap], list[str]]:
    """AI shopping list with a deterministic fallback. Never raises."""
    if not any(o.missingItems for o in outfits):
        return [], []
    try:
        from google import genai
        from google.genai import types

        client = client or genai.Client()
        contents: list = [shopping_input(outfits, wardrobe, profile)]
        for w in wardrobe:
            if images and w.id in images:
                contents += [f"Wardrobe item id: {w.id}", images[w.id]]
        response = client.models.generate_content(
            model=os.getenv("SHOPPING_MODEL") or os.getenv("OUTFIT_MODEL", "gemini-4-hydrogen"),
            contents=contents,
            config=types.GenerateContentConfig(system_instruction=PROMPT, response_mime_type="application/json",
                                               response_schema=LlmShoppingList),
        )
        plan = response.parsed
        if not isinstance(plan, LlmShoppingList):
            raise ValueError("unparseable shopping list")
        return validate_shopping(plan, outfits, wardrobe)
    except Exception as e:
        return identify_shopping_gaps(outfits, wardrobe), [
            f"Shopping list fell back to plain merging ({type(e).__name__})."]
