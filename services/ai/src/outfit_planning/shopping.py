"""Shopping gap detection: turn outfits' missing items into deduplicated shop searches.

Deterministic (no model call). The shopping integration owns the actual product
search, cart and checkout; this only says what to look for and why.
"""

import re

from .models import MissingItem, Outfit, ShoppingGap, WardrobeItem


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
