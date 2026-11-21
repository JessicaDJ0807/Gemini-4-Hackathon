"""Render an outfit-plan request + response as one HTML page you can eyeball.

From services/ai/:
    python tools/view_plan.py examples/outfit_plan_request_inspiration.json \
        examples/outfit_plan_response_inspiration.json --open

Images: URLs on the local fixture server (http://127.0.0.1:8799/...) are mapped to
files under tests/fixtures/ so the page works without the server running. Any
other URL is used as-is. Output goes to generated/plan_views/ (gitignored).
"""

import argparse
import html
import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlparse

SERVICE_DIR = Path(__file__).resolve().parents[1]
FIXTURES = SERVICE_DIR / "tests" / "fixtures"
LOCAL_HOSTS = {"127.0.0.1", "localhost"}
esc = html.escape


def image_src(url: str | None) -> str | None:
    if not url:
        return None
    u = urlparse(url)
    if u.hostname in LOCAL_HOSTS:
        path = FIXTURES / u.path.lstrip("/")
        if path.exists():
            return path.resolve().as_uri()
    return url


def weather_text(w: dict | None) -> tuple[str, str]:
    """(css class, label) for one WeatherDay."""
    if not w or w.get("kind") == "unavailable":
        return "unavailable", "Weather unavailable"
    parts = []
    if w.get("minTempC") is not None and w.get("maxTempC") is not None:
        parts.append(f"{w['minTempC']:g}–{w['maxTempC']:g} °C")
    if w.get("precipitationProbabilityPct") is not None:
        parts.append(f"{w['precipitationProbabilityPct']:g}% rain")
    if w.get("windKph") is not None:
        parts.append(f"wind {w['windKph']:g} kph")
    if w.get("conditions"):
        parts.append(w["conditions"])
    prefix = "Forecast" if w["kind"] == "forecast" else "Climate estimate"
    return w["kind"], f"{prefix}: " + " · ".join(parts)


def chips(items: list[str], cls: str = "chip") -> str:
    return "".join(f'<span class="{cls}">{esc(x)}</span>' for x in items)


def render(req: dict, res: dict, title: str) -> str:
    wardrobe = {w["id"]: w for w in req.get("wardrobe", [])}
    media = {m["id"]: m for m in req.get("media", [])}
    attractions = {a["id"]: a for a in req["trip"].get("attractions", [])}
    weather = {w["date"]: w for w in req["trip"].get("weather", [])}
    seen_photos = set(res.get("wardrobeImagesUsed", []))
    seen_insp = set(res.get("inspirationMediaUsed", []))
    cited = defaultdict(list)
    for o in res["outfits"]:
        for m in o.get("inspirationReferenceIds", []):
            cited[m].append(o["id"])

    per_outfit = defaultdict(list)
    general = []
    for w in res.get("warnings", []):
        oid = w.split(":", 1)[0]
        (per_outfit[oid] if oid.startswith("look-") else general).append(w)

    profile = req["styleProfile"]
    trip = req["trip"]
    out = [f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>{esc(title)}</title>
<style>{CSS}</style></head><body><main>
<header><h1>{esc(trip['destination']['name'])} · {esc(trip['startDate'])} → {esc(trip['endDate'])}</h1>
<p class="meta">{esc(res['requestId'])} · model {esc(res.get('model') or '?')} · {len(res['outfits'])} outfits ·
{len(seen_photos)}/{len(wardrobe)} wardrobe photos seen · {len(seen_insp)}/{len(media)} inspiration media seen</p></header>
<section class="panel"><h2>Style profile</h2>
<div>{chips(profile.get('styleTags', []) + profile.get('aesthetics', []))}</div>
<div>{chips(profile.get('colors', []), 'chip color')}</div>
<div>{chips(profile.get('silhouettes', []) + profile.get('stylingPatterns', []), 'chip soft')}</div>
{f'<div>Avoid: {chips(profile["avoidances"], "chip avoid")}</div>' if profile.get('avoidances') else ''}
{f'<p class="note">{esc(profile["notes"])}</p>' if profile.get('notes') else ''}
{f'<p class="note">Preferences: {esc(req["preferences"])}</p>' if req.get('preferences') else ''}</section>"""]

    if media:
        out.append('<section class="panel"><h2>Inspiration</h2><div class="strip">')
        for mid, m in media.items():
            state = ("cited by " + ", ".join(cited[mid])) if cited[mid] else ("seen, not cited" if mid in seen_insp else "not seen")
            cls = "cited" if cited[mid] else ("seen" if mid in seen_insp else "unseen")
            src = image_src(m.get("readUrl"))
            img = (f'<img src="{esc(src)}" alt="{esc(mid)}" loading="lazy">' if m.get("kind") == "image"
                   else f'<video src="{esc(src)}" muted controls></video>')
            out.append(f'<figure class="insp {cls}">{img}<figcaption><b>{esc(mid)}</b> {esc(state)}</figcaption></figure>')
        out.append("</div></section>")

    out.append('<section class="panel"><h2>Weather (from request)</h2><div class="days">')
    for d, w in sorted(weather.items()):
        cls, label = weather_text(w)
        out.append(f'<div class="day {cls}"><b>{esc(d)}</b><span>{esc(label)}</span></div>')
    out.append("</div></section>")

    if general:
        out.append('<section class="panel warn"><h2>Warnings</h2><ul>'
                   + "".join(f"<li>{esc(w)}</li>" for w in general) + "</ul></section>")

    for o in res["outfits"]:
        cls, label = weather_text(weather.get(o["date"]))
        atts = [attractions.get(a, {"name": a})["name"] for a in o.get("attractionIds", [])]
        out.append(f"""<article class="outfit"><div class="head"><h2>{esc(o.get('name') or o['id'])}</h2>
<span class="meta">{esc(o['id'])} · {esc(o['date'])}{' · ' + esc(', '.join(atts)) if atts else ''}</span>
<span class="badge {cls}">{esc(label)}</span></div><div class="pieces">""")
        for wid in o["wardrobeItemIds"]:
            w = wardrobe.get(wid, {"name": wid, "category": "?"})
            src = image_src(w.get("imageUrl"))
            img = f'<img src="{esc(src)}" alt="" loading="lazy">' if src else '<div class="noimg">no photo</div>'
            flag = "" if wid in seen_photos else '<span class="tiny">photo not seen</span>'
            out.append(f'<figure class="piece">{img}<figcaption><b>{esc(w["name"])}</b>'
                       f'<span>{esc(w["category"])} · {esc(wid)}</span>{flag}</figcaption></figure>')
        for m in o.get("missingItems", []):
            out.append(f'<figure class="piece missing {esc(m["priority"])}"><div class="noimg">'
                       f'<b>BUY · {esc(m["priority"])}</b><span>{esc(m["searchQuery"])}</span></div>'
                       f'<figcaption><b>{esc(m["description"])}</b><span>{esc(m.get("category") or "?")}</span>'
                       f'<span class="tiny">{esc(m["reason"])}</span></figcaption></figure>')
        out.append("</div>")
        insp = o.get("inspirationReferenceIds", [])
        if insp:
            out.append('<div class="drew">Drew on: ' + "".join(
                f'<img src="{esc(image_src(media[i]["readUrl"]) or "")}" title="{esc(i)}" alt="{esc(i)}">'
                for i in insp if i in media and media[i].get("kind") == "image") + f' {esc(", ".join(insp))}</div>')
        out.append(f'<p class="rationale">{esc(o["rationale"])}</p>')
        if o.get("styleConnections"):
            out.append(f'<div>{chips(o["styleConnections"], "chip soft")}</div>')
        if o.get("occasions"):
            out.append(f'<div>{chips(o["occasions"], "chip")}</div>')
        if o.get("stylingTips"):
            out.append("<ul class='tips'>" + "".join(f"<li>{esc(t)}</li>" for t in o["stylingTips"]) + "</ul>")
        if per_outfit[o["id"]]:
            out.append('<ul class="owarn">' + "".join(f"<li>{esc(w)}</li>" for w in per_outfit[o["id"]]) + "</ul>")
        out.append("</article>")

    gaps = res.get("shoppingGaps", [])
    if gaps:
        out.append('<section class="panel"><h2>Shopping gaps</h2><table><tr><th>Search</th><th>Priority</th>'
                   '<th>For</th><th>Similar owned</th><th>Reason</th></tr>')
        for g in gaps:
            out.append(f'<tr><td><b>{esc(g["searchQuery"])}</b></td><td>{esc(g["priority"])}</td>'
                       f'<td>{esc(", ".join(g["outfitIds"]))}</td><td>{esc(", ".join(g.get("similarOwnedItemIds", [])) or "—")}</td>'
                       f'<td>{esc(g["reason"])}</td></tr>')
        out.append("</table></section>")
    out.append("</main></body></html>")
    return "\n".join(out)


CSS = """
:root{--bg:#f6f5f2;--card:#fff;--ink:#1d1c1a;--muted:#6b6862;--line:#e4e1da;--chip:#efece6;
--accent:#2f6f5e;--warn:#9a5b00;--warnbg:#fff6e5;--buy:#b03a2e;--rain:#2d5d8a;--climate:#7a5a9a}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--card:#201f1d;--ink:#ecebe7;--muted:#a19d95;
--line:#34322e;--chip:#2c2a27;--accent:#6fc2a8;--warn:#f0b35a;--warnbg:#2b2316;--buy:#f08a7e;--rain:#8ab8e6;--climate:#c3a4e6}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}h1{margin:0 0 4px;font-size:24px}h2{margin:0 0 10px;font-size:17px}
.meta{color:var(--muted);font-size:13px}.panel,.outfit{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:14px 0}
.chip{display:inline-block;background:var(--chip);border-radius:99px;padding:2px 10px;margin:2px 4px 2px 0;font-size:13px}
.chip.soft{background:transparent;border:1px solid var(--line)}.chip.avoid{color:var(--buy);border:1px solid var(--buy);background:transparent}
.note{color:var(--muted);margin:8px 0 0}.strip{display:flex;gap:10px;overflow-x:auto}
.insp{margin:0;width:150px;flex:none}.insp img,.insp video{width:150px;height:190px;object-fit:cover;border-radius:8px;border:3px solid transparent}
.insp.cited img{border-color:var(--accent)}.insp.unseen img,.insp.seen img{opacity:.55}.insp figcaption{font-size:12px;color:var(--muted)}
.days{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px}.day{border-left:4px solid var(--muted);padding:4px 10px;display:flex;flex-direction:column}
.day.forecast,.badge.forecast{border-color:var(--rain);color:var(--rain)}.day.climate,.badge.climate{border-color:var(--climate);color:var(--climate)}
.day span{color:var(--ink);font-size:13px}.warn{background:var(--warnbg)}.warn li,.owarn li{color:var(--warn)}
.head{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 12px;margin-bottom:12px}.head h2{margin:0}
.badge{border:1px solid currentColor;border-radius:99px;padding:1px 10px;font-size:12px;color:var(--muted)}
.pieces{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px}.piece{margin:0}
.piece img,.noimg{width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:8px;background:var(--chip)}
.noimg{display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:8px;color:var(--muted);font-size:13px}
.missing .noimg{border:2px dashed var(--buy);background:transparent;color:var(--buy)}.missing.optional .noimg{opacity:.7}
.piece figcaption{display:flex;flex-direction:column;font-size:13px;margin-top:4px}.piece figcaption span{color:var(--muted)}
.tiny{font-size:11px}.drew{margin:12px 0 0;font-size:13px;color:var(--accent);display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.drew img{width:40px;height:50px;object-fit:cover;border-radius:4px}.rationale{margin:12px 0 8px}
.tips{color:var(--muted);font-size:13px;margin:8px 0 0;padding-left:18px}.owarn{font-size:13px;margin:8px 0 0;padding-left:18px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:6px;border-top:1px solid var(--line);vertical-align:top}
"""


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("request", type=Path)
    ap.add_argument("response", type=Path)
    ap.add_argument("-o", "--out", type=Path)
    ap.add_argument("--open", action="store_true", help="open in the default browser (macOS)")
    a = ap.parse_args()
    req, res = json.loads(a.request.read_text()), json.loads(a.response.read_text())
    out = a.out or SERVICE_DIR / "generated" / "plan_views" / f"{a.response.stem}.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render(req, res, a.response.stem))
    print(out)
    if a.open:
        subprocess.run(["open" if sys.platform == "darwin" else "xdg-open", str(out)])


if __name__ == "__main__":
    main()
