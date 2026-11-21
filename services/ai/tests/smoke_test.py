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


def weather_and_inspiration_checks() -> None:
    print("Weather + inspiration (offline)")
    from src.outfit_planning.models import MediaRef, WeatherDay
    from src.outfit_planning.planner import llm_input, normalize_weather, select_inspiration

    req = load_request()
    days = trip_days(req)
    req.trip.weather[2] = WeatherDay(date=days[2], kind="climate", minTempC=2, maxTempC=9)
    req.trip.weather.append(WeatherDay(date=days[0].replace(day=20), kind="forecast", minTempC=1, maxTempC=2))
    req.trip.weather.append(WeatherDay(date=days[1], kind="forecast", minTempC=0, maxTempC=0))
    weather, warns = normalize_weather(req, days)
    check(weather[days[2]].kind == "climate" and any("seasonal estimate" in w for w in warns),
          "climate estimate kept and labeled")
    check(any("outside the trip" in w for w in warns) and any("Duplicate" in w for w in warns),
          "out-of-trip and duplicate weather records reported")

    empty = load_request()
    empty.trip.weather = [WeatherDay(date=days[0], kind="forecast"),
                          WeatherDay(date=days[1], kind="unavailable", maxTempC=30)]
    weather2, warns2 = normalize_weather(empty, days)
    check(weather2[days[0]].kind == "unavailable" and weather2[days[1]].maxTempC is None
          and weather2[days[2]].kind == "unavailable", "empty/contradictory/missing weather -> unavailable")

    payload = json.loads(llm_input(req, outfit_slots(days, 3), weather))
    check("weather" not in payload["trip"] and payload["outfitsToCreate"][0]["weather"]["maxTempC"] == 10,
          "each outfit slot carries its own day's weather")

    def ref(i, **kw):
        return MediaRef(**({"id": i, "kind": "image", "mimeType": "image/jpeg",
                            "readUrl": f"https://x.example/{i}.jpg"} | kw))

    insp = load_request()
    insp.styleProfile.visualReferenceIds = ["m1", "m2", "m4", "m5"]
    insp.media = [ref("m1"), ref("m1"), ref("m2", mimeType="image/gif"), ref("m3"), ref("m4", readUrl="ftp://x/a")]
    chosen, warns3 = select_inspiration(insp)
    check([m.id for m in chosen] == ["m1"], "only valid profile references selected")
    check(sum("Inspiration" in w for w in warns3) == 4 and any("'m5'" in w for w in warns3),
          "rejected media and unsupplied references reported")

    rain = LlmMissingItem(description="x", category="accessory", searchQuery="x", priority="optional", reason="r")
    plan = LlmPlan(outfits=[LlmOutfit(
        name="A", date=str(days[0]), attractionIds=[], wardrobeItemIds=["top-02", "bottom-02", "shoes-01"],
        missingItems=[rain], rationale="r", occasions=[], styleConnections=[], stylingTips=[],
        inspirationReferenceIds=["m1", "ghost"])])
    outfits, warns4 = validate(plan, req, days[:1], weather, {"m1"})
    check(outfits[0].inspirationReferenceIds == ["m1"] and any("ghost" in w for w in warns4),
          "unseen inspiration ids removed")
    check(any("rain chance" in w for w in warns4) and any("no outerwear" in w for w in warns4),
          "rainy/cold day without outer layer flagged")
    check(outfits[0].weatherKind == "forecast", "outfit records the weather kind it was planned for")


def direction_checks() -> None:
    print("Style directions (offline)")
    from src.outfit_planning.models import StyleDirection
    from src.outfit_planning.planner import normalize_weather
    from src.style_analysis.schema import ImageObservation, StyleDirection as ExDirection, StyleExtraction, Trait
    from src.style_analysis.service import StyleDirectionOut, profile_directions

    ex = StyleExtraction(
        per_image=[ImageObservation(image_id="m1", garments=["blazer"], aesthetics=[], colors=[], silhouettes=[],
                                    styling_details=[], notes=""),
                   ImageObservation(image_id="m2", garments=["floral dress"], aesthetics=[], colors=[],
                                    silhouettes=[], styling_details=[], notes="")],
        style_directions=[ExDirection(name="Romantic", description="d", image_ids=["m2"], strength="minor"),
                          ExDirection(name="Minimal", description="d", image_ids=["m1"], strength="dominant")],
        aesthetics=[], colors=[Trait(label="camel", image_ids=["m1"]), Trait(label="pink", image_ids=["m2"]),
                               Trait(label="navy", image_ids=[])],
        silhouettes=[], styling_patterns=[], avoidances=[], summary="s")
    outs = [StyleDirectionOut(name=d.name, description=d.description, strength=d.strength,
                              visualReferenceIds=d.image_ids) for d in ex.style_directions]
    dirs = profile_directions(ex, outs, ["minimal"])
    check([d.name for d in dirs] == ["Minimal", "Romantic"] and dirs[0].id == "dir-01", "directions ordered strongest first")
    check(dirs[0].colors == ["camel", "navy"] and dirs[1].colors == ["pink"],
          "each direction gets the traits seen in its own media")
    check(dirs[0].keyPieces == ["blazer"] and dirs[0].source == "both" and dirs[1].source == "media",
          "key pieces and source filled")

    req = load_request()
    req.styleProfile.directions = [StyleDirection(id="dir-01", name="Minimal", strength="dominant"),
                                   StyleDirection(id="dir-02", name="Romantic", strength="minor")]
    days = trip_days(req)
    weather, _ = normalize_weather(req, days)

    def outfit(direction):
        return LlmOutfit(name="A", date=str(days[0]), attractionIds=[], wardrobeItemIds=["dress-01", "shoes-01"],
                         missingItems=[], rationale="r", occasions=[], styleConnections=[], stylingTips=[],
                         directionId=direction)

    outfits, warns = validate(LlmPlan(outfits=[outfit("dir-01"), outfit("dir-99")]), req, days[:1] * 2, weather)
    check(outfits[0].directionId == "dir-01" and outfits[1].directionId is None
          and any("dir-99" in w for w in warns), "unknown direction id removed")
    _, warns2 = validate(LlmPlan(outfits=[outfit("dir-02")] * 3), req, days[:1] * 3, weather)
    check(any("minor style direction" in w for w in warns2), "minor direction leading the trip flagged")


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


def b_contract_checks() -> None:
    """Rules from B's validators in packages/contracts/*.mjs."""
    print("B contract alignment (offline)")
    from src.outfit_planning.models import StyleDirection
    from src.style_analysis.service import b_labels, nested_profile

    check(b_labels(["Minimal", " camel", "minimal ", "", "x" * 101]) == ["minimal", "camel"],
          "labels deduplicated like B's uniqueLabels (first position, last spelling)")
    d = lambda i, s, **kw: StyleDirection(id=i, name=f"Style {i}", strength=s, **kw)
    p = nested_profile([d("dir-01", "dominant", colors=["camel", "Black"], visualReferenceIds=["a"]),
                        d("dir-02", "minor", colors=["black", "pink"], visualReferenceIds=["b"])],
                       ["minimal"], ["high heels"], "s" * 600, None)
    check(p.styleTags == ["minimal", "Style dir-01", "Style dir-02"] and p.aesthetics == ["Style dir-01", "Style dir-02"],
          "styleTags = user tags + direction names; aesthetics = direction names")
    check(p.colors == ["camel", "black", "pink"] and p.visualReferenceIds == ["a", "b"] and len(p.summary) == 500,
          "flat fields are unions of direction values; summary capped at 500")

    req = load_request()
    req.outfitCount = None
    for days, expected in ((1, 2), (2, 3), (3, 3), (5, 5)):
        req.trip.endDate = req.trip.startDate.replace(day=req.trip.startDate.day + days - 1)
        trip = trip_days(req)
        n = min(max(3, len(trip)), 2 * len(trip))
        check(n == expected and max(outfit_slots(trip, n).count(x) for x in trip) <= 2,
              f"default outfit count for a {days}-day trip is {expected} (1-2 per day)")


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
    weather_and_inspiration_checks()
    direction_checks()
    style_analysis_checks()
    b_contract_checks()
    if "--offline" not in sys.argv:
        live_check()
    print(f"\nAll {passed} checks passed.")
