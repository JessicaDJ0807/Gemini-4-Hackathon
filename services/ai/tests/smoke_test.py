"""End-to-end smoke test for outfit planning + shopping gaps.

From services/ai/ with the venv active:
    python tests/smoke_test.py            # offline checks + one live Gemini call
    python tests/smoke_test.py --offline  # no API calls
"""

import json
import sys
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_DIR))

from src.outfit_planning.models import OutfitPlanRequest, OutfitPlanResponse  # noqa: E402
from src.outfit_planning.planner import (LlmMissingItem, LlmOutfit, LlmPlan,  # noqa: E402
                                         PlanningError, generate_outfits,
                                         outfit_slots, trip_days, validate)
from src.outfit_planning.shopping import identify_shopping_gaps  # noqa: E402

REQUEST = SERVICE_DIR / "examples" / "outfit_plan_request.json"
passed = 0


def check(cond: bool, label: str) -> None:
    global passed
    if not cond:
        raise SystemExit(f"FAIL: {label}")
    passed += 1
    print(f"  ok  {label}")


def load_request() -> OutfitPlanRequest:
    return OutfitPlanRequest.model_validate_json(REQUEST.read_text())


def offline_checks() -> None:
    print("Offline checks")
    req = load_request()
    slots = outfit_slots(trip_days(req), 3)
    check([str(d) for d in slots] == ["2026-12-03", "2026-12-04", "2026-12-05"], "3 outfits spread one per day")

    rain = LlmMissingItem(description="Rain shell", category="outerwear", color="black",
                          searchQuery="black rain shell", priority="essential", reason="rain")
    fake = LlmPlan(outfits=[
        LlmOutfit(name="A", date="2026-12-03", attractionIds=["fushimi-inari", "nishiki-market"],
                  wardrobeItemIds=["top-01", "bottom-02", "shoes-01", "made-up-99"], missingItems=[rain],
                  rationale="r", occasions=[], styleConnections=[], stylingTips=[]),
        LlmOutfit(name="B", date="not-a-date", attractionIds=[], wardrobeItemIds=["dress-01", "shoes-02"],
                  missingItems=[rain], rationale="r", occasions=[], styleConnections=[], stylingTips=[]),
        LlmOutfit(name="C", date="2026-12-05", attractionIds=["philosophers-path"],
                  wardrobeItemIds=["top-02"], missingItems=[], rationale="r",
                  occasions=[], styleConnections=[], stylingTips=[]),
    ])
    outfits, warnings = validate(fake, req, slots)
    check("made-up-99" not in outfits[0].wardrobeItemIds, "invented wardrobe id removed")
    check(outfits[0].attractionIds == ["fushimi-inari"], "attraction on another date removed")
    check(str(outfits[1].date) == "2026-12-04", "invalid date replaced with planned slot")
    check(outfits[2].attractionIds == [], "unscheduled attraction removed")
    check(any("incomplete" in w for w in warnings), "incomplete outfit flagged")
    check([o.id for o in outfits] == ["look-01", "look-02", "look-03"], "stable outfit ids")

    gaps = identify_shopping_gaps(outfits, req.wardrobe)
    check(len(gaps) == 1 and gaps[0].outfitIds == ["look-01", "look-02"], "duplicate purchase merged across outfits")

    bad = load_request()
    bad.trip.endDate = bad.trip.startDate.replace(day=1)
    try:
        trip_days(bad)
        check(False, "end before start rejected")
    except PlanningError as e:
        check(e.status == 400, "end before start rejected with 400")

    class BrokenClient:
        class models:
            @staticmethod
            def generate_content(**_):
                raise TimeoutError("simulated outage")

    try:
        generate_outfits(load_request(), client=BrokenClient())
        check(False, "upstream failure handled")
    except PlanningError as e:
        check(e.code == "AI_UNAVAILABLE" and e.retryable, "upstream failure -> AI_UNAVAILABLE, retryable")


def style_analysis_checks() -> None:
    print("Style analysis (offline)")
    from src.style_analysis.schema import StyleDirection, StyleExtraction, Trait
    from src.style_analysis.service import StyleAnalysisError, StyleAnalysisRequest, analyze_style

    def expect_error(body: dict, status: int, label: str) -> None:
        try:
            analyze_style(StyleAnalysisRequest(requestId="t", inputRevision=1, **body))
            check(False, label)
        except StyleAnalysisError as e:
            check(e.status == status, label)

    media = {"id": "m1", "kind": "image", "mimeType": "image/gif", "readUrl": "https://x.example/a.gif"}
    expect_error({}, 400, "empty request rejected (400)")
    expect_error({"media": [media]}, 415, "unsupported media type rejected (415)")
    expect_error({"media": [media | {"mimeType": "image/jpeg"}] * 2}, 400, "duplicate media ids rejected (400)")

    fake = StyleExtraction(
        per_image=[], aesthetics=[Trait(label="Minimal", image_ids=[]), Trait(label="minimal", image_ids=[])],
        colors=[Trait(label="black", image_ids=["ghost-id"])], silhouettes=[], styling_patterns=[],
        avoidances=[Trait(label="prints", image_ids=[])], summary="s",
        style_directions=[StyleDirection(name="Clean", description="d", image_ids=["ghost-id"], strength="dominant")])

    class FakeClient:
        class models:
            @staticmethod
            def generate_content(**_):
                return type("R", (), {"parsed": fake})()

    res = analyze_style(StyleAnalysisRequest(requestId="t", inputRevision=1, tags=["minimal"],
                                             avoidances=["high heels"]), client=FakeClient())
    p = res.suggestedProfile
    check(p.avoidances == ["high heels"], "user avoidances kept; model-invented dislikes dropped")
    check([t.lower() for t in p.styleTags].count("minimal") == 1, "style tags deduplicated ignoring case")
    check(res.styleDirections[0].visualReferenceIds == [] and any("unknown media" in w for w in res.warnings),
          "unknown media ids removed and reported")


def live_check() -> None:
    print("Live check (Gemini)")
    req = load_request()
    res = generate_outfits(req)
    owned_ids = {w.id for w in req.wardrobe}

    check(len(res.outfits) == 3, "three outfits returned")
    check(len({o.id for o in res.outfits}) == 3, "outfit ids unique")
    check(all(set(o.wardrobeItemIds) <= owned_ids for o in res.outfits), "all wardrobe ids exist")
    pieces = [p for o in res.outfits for ps in o.itemsByCategory.values() for p in ps]
    check(all((p.id in owned_ids) == p.owned for p in pieces), "owned vs missing pieces distinguishable")
    missing = [m for o in res.outfits for m in o.missingItems]
    check(all(m.searchQuery.strip() for m in missing), "every missing item has a search query")
    check(len({o.id for o in res.outfits} | {m.id for m in missing}) == 3 + len(missing), "missing-item ids unique")
    check(all(g.searchQuery for g in res.shoppingGaps), "shopping gaps have queries")
    round_trip = OutfitPlanResponse.model_validate_json(res.model_dump_json())
    check(round_trip == res, "response JSON parses and validates")
    print(json.dumps({"outfits": [o.name for o in res.outfits],
                      "gaps": [g.searchQuery for g in res.shoppingGaps]}, indent=1))


if __name__ == "__main__":
    offline_checks()
    style_analysis_checks()
    if "--offline" not in sys.argv:
        live_check()
    print(f"\nAll {passed} checks passed.")
