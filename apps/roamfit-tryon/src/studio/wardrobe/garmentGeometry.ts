// Builds garment shells from the measured body. Each shell reuses the body's own cross-sections, grown to the
// garment circumference given by the size chart (or a default ease when the chart doesn't say).
// Anti-clipping by construction: layers are applied in order (bottom → top → outer) and each shell section is
// forced to be at least GAP larger than whatever already occupies it.
// This is an illustrative circumference-based drape, NOT a physical cloth simulation.
import * as THREE from 'three'
import { axesFor, sectionPerimeter, type Body, type Section } from '../avatar/bodyModel'
import { tubeGeometry, type VertexMod } from '../avatar/tubeGeometry'
import { byId, type Garment, type Worn } from './catalog'

const GAP = 0.008 // m of circumference between layers
const cm = (v: number) => v / 100
const smooth = (t: number) => t * t * (3 - 2 * t)
const clamp01 = (t: number) => Math.max(0, Math.min(1, t))

export type Piece = { key: string; garment: Garment; geometry: THREE.BufferGeometry; buttons?: THREE.Vector3[] }
export type BuildResult = { pieces: Piece[]; notes: string[] }

type Occ = { torso: number[]; legs: [number[], number[]]; arms: [number[], number[]] }

/** finished-garment value (cm) for a dimension, or null when the chart can't provide a garment measurement */
function finished(g: Garment, size: string | undefined, dim: string): number | null {
  if (g.sizeChart.provenance !== 'finished-garment' || !size) return null
  const v = g.sizeChart.sizes[size]?.[dim]
  return typeof v === 'number' ? v : null
}

function arcLengths(secs: Section[]) {
  const out = [0]
  for (let i = 1; i < secs.length; i++) { const p = secs[i - 1].c, q = secs[i].c; out.push(out[i - 1] + Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])) }
  return out
}

function grow(secs: Section[], perims: number[]): Section[] {
  return secs.map((s, i) => { const f = perims[i] / sectionPerimeter(s); return { ...s, a: s.a * f, b: s.b * f } })
}

function necklineMod(kind: Garment['neckline'], body: Body, topY: number): VertexMod {
  const depth = { crew: 0.022, square: 0.075, boat: 0.012, v: 0.17 }[kind ?? 'crew']
  const half = { crew: 0.07, square: 0.075, boat: 0.13, v: 0.09 }[kind ?? 'crew']
  return (p) => {
    const front = p.z > body.torso[0].c[2] + 0.005
    if (!front) { if (p.y > topY - 0.004) p.y = topY - 0.004; return }
    const x = Math.abs(p.x)
    let cut: number
    if (kind === 'square') cut = x < half ? topY - depth : topY - depth * smooth(clamp01(1 - (x - half) / 0.012))
    else if (kind === 'v') cut = topY - depth * clamp01(1 - x / half)
    else cut = topY - depth * Math.cos(Math.min(1, x / half) * Math.PI / 2)
    if (p.y > cut) p.y = cut
  }
}

export function buildOutfit(body: Body, worn: Worn, sizes: Record<string, string>): BuildResult {
  const notes: string[] = []
  const pieces: Piece[] = []
  const occ: Occ = {
    torso: body.torso.map(sectionPerimeter),
    legs: body.legs.map(l => l.map(sectionPerimeter)) as [number[], number[]],
    arms: body.arms.map(a => a.map(sectionPerimeter)) as [number[], number[]],
  }
  const L = body.landmarks
  const bodyAt = (key: string) => sectionPerimeter(body.torso.find(s => s.key === key)!)
  const take = (arr: number[], i: number, want: number) => { const v = Math.max(want, arr[i] + GAP); arr[i] = v; return v }

  // ---------- torso shell (tops / outerwear / trouser seat) ----------
  const torsoShell = (g: Garment, size: string | undefined, y0: number, y1: number, defaultEaseCm: number) => {
    const idx = body.torso.map((s, i) => [s, i] as const).filter(([s]) => s.c[1] >= y0 - 1e-6 && s.c[1] <= y1 + 1e-6)
    const e = (dim: string, bodyKey: string) => { const f = finished(g, size, dim); return f == null ? null : cm(f) - bodyAt(bodyKey) }
    const eBust = e('chest', 'bust') ?? cm(defaultEaseCm)
    const eWaist = e('waist', 'waist') ?? eBust
    const eHip = e('hip', 'hip') ?? eWaist
    const ys = [L.hip, L.waist, L.bust, L.shoulder], es = [eHip, eWaist, eBust, Math.min(eBust, 0.03)]
    const easeAt = (y: number) => {
      if (y <= ys[0]) return es[0]
      for (let i = 0; i < ys.length - 1; i++) if (y <= ys[i + 1]) return es[i] + (es[i + 1] - es[i]) * smooth((y - ys[i]) / (ys[i + 1] - ys[i]))
      return es[es.length - 1]
    }
    // Tops hang: below the bust a garment can't follow the body inward more than its own ease allows
    let maxBelow = 0
    const perims = idx.map(([s, i]) => take(occ.torso, i, Math.max(sectionPerimeter(s) + easeAt(s.c[1]), sectionPerimeter(s) + 0.006)))
    if (g.slot !== 'bottom') for (let k = perims.length - 1; k >= 0; k--) {
      const y = idx[k][0].c[1]
      if (y < L.bust) { perims[k] = Math.max(perims[k], maxBelow * 0.985); occ.torso[idx[k][1]] = perims[k] } else maxBelow = perims[k]
    }
    return grow(idx.map(([s]) => s), perims)
  }

  // ---------- sleeves ----------
  const sleeve = (g: Garment, size: string | undefined, lengthM: number, easeTop: number, easeCuff: number) => {
    return body.arms.map((arm, side) => {
      const arc = arcLengths(arm)
      const n = Math.max(2, arc.findIndex(a => a >= lengthM) === -1 ? arm.length : arc.findIndex(a => a >= lengthM) + 1)
      const secs = arm.slice(0, n)
      const perims = secs.map((s, i) => { const t = arc[i] / Math.max(lengthM, 1e-3); return take(occ.arms[side], i, sectionPerimeter(s) + cm(easeTop + (easeCuff - easeTop) * t)) })
      return tubeGeometry(grow(secs, perims))
    })
  }

  // ---------- BOTTOM ----------
  const bottom = worn.bottom ? byId[worn.bottom] : null
  if (bottom) {
    const size = sizes[bottom.id]
    if (bottom.style === 'trouser-flare') {
      const thighF = finished(bottom, size, 'thigh'), inseamF = finished(bottom, size, 'inseam') ?? 79
      const legThigh = body.legs[0].find(x => x.key === 'thigh') ?? body.legs[0][1]
      const thighEaseM = Math.max(thighF != null ? cm(thighF) - sectionPerimeter(legThigh) : 0.05, 0.02)
      // Seat must enclose the tops of both trouser legs: perimeter ≥ convex hull of two leg shells (+ gap).
      const legHull = (y: number) => {
        let best = body.legs[0][0]; for (const sct of body.legs[0]) if (Math.abs(sct.c[1] - y) < Math.abs(best.c[1] - y)) best = sct
        return sectionPerimeter(best) + thighEaseM + 4 * Math.abs(best.c[0]) + 2 * GAP
      }
      const seat = torsoShell(bottom, size, L.crotch, L.waist + 0.012, 3).map(sct => {
        if (sct.c[1] > L.hip) return sct
        const need = legHull(Math.max(sct.c[1], body.legs[0][0].c[1] - 0.02)), have = sectionPerimeter(sct)
        return need > have ? { ...sct, a: sct.a * need / have, b: sct.b * need / have } : sct
      })
      pieces.push({ key: 'bottom-seat', garment: bottom, geometry: tubeGeometry(seat) })
      const flare = bottom.geo.hemFlare ?? 1.3
      body.legs.forEach((leg, side) => {
        const arc = arcLengths(leg)
        const startOffset = leg[0].c[1] - L.crotch // leg tube starts slightly above crotch
        const hemArc = cm(inseamF) + startOffset
        const secs: Section[] = [...leg]
        // extend below ankle if the garment inseam is longer than the leg
        const extra = hemArc - arc[arc.length - 1]
        const last = leg[leg.length - 1]
        const room = last.c[1] - 0.012
        if (extra > 0.002) {
          const ext = Math.min(extra, room)
          for (let k = 1; k <= 4; k++) secs.push({ ...last, c: [last.c[0], last.c[1] - (ext * k) / 4, last.c[2]] })
          if (extra > room + 0.01 && side === 0) notes.push(`${bottom.name}: inseam ${inseamF} cm is longer than your leg — the hem would break on the shoe.`)
        }
        const arcAll = arcLengths(secs)
        let n = arcAll.findIndex(a => a >= hemArc); n = n === -1 ? secs.length : n + 1
        const use = secs.slice(0, n)
        const thighEase = thighF != null ? cm(thighF) - sectionPerimeter(leg.find(x => x.key === 'thigh') ?? leg[1]) : 0.05
        const kneeT = 0.55
        const total = arcAll[n - 1]
        const perims = use.map((s, i) => {
          const t = arcAll[i] / total
          const base = sectionPerimeter(i < leg.length ? leg[i] : last)
          let want = base + Math.max(thighEase, 0.02) * (1 - 0.35 * t)
          if (t > kneeT) { const kneeP = sectionPerimeter(leg[Math.min(leg.length - 1, Math.round(kneeT * (leg.length - 1)))]) + Math.max(thighEase, 0.02) * 0.8; want = Math.max(want, kneeP * (1 + (flare - 1) * smooth((t - kneeT) / (1 - kneeT)))) }
          return i < occ.legs[side].length ? take(occ.legs[side], i, want) : want
        })
        if (thighF != null && thighEase < 0 && side === 0) notes.push(`${bottom.name} ${size}: thigh is smaller than yours — shown at minimum clearance.`)
        pieces.push({ key: `bottom-leg-${side}`, garment: bottom, geometry: tubeGeometry(grow(use, perims)) })
      })
    } else if (bottom.style === 'skirt-midi') {
      const top = L.waist + 0.012, hem = Math.max(0.05, L.waist - cm(bottom.geo.lengthCm ?? 70))
      const ease = cm(bottom.geo.easeCm ?? 4)
      const legHullAt = (y: number) => {
        const leg = body.legs[0]; let best = leg[0]
        for (const s of leg) if (Math.abs(s.c[1] - y) < Math.abs(best.c[1] - y)) best = s
        return sectionPerimeter(best) + 4 * Math.abs(best.c[0])
      }
      const torsoAt = (y: number) => { let best = body.torso[0]; for (const s of body.torso) if (Math.abs(s.c[1] - y) < Math.abs(best.c[1] - y)) best = s; return best }
      const secs: Section[] = [], N = 40
      let hipP = 0
      for (let i = 0; i <= N; i++) {
        const y = top - ((top - hem) * i) / N
        const tor = torsoAt(y)
        const base = y >= L.crotch ? sectionPerimeter(tor) : legHullAt(y)
        let P = base + ease
        if (y <= L.hip) { if (!hipP) hipP = P; P = Math.max(P, hipP * (1 + 0.55 * smooth(clamp01((L.hip - y) / (L.hip - hem))))) } // A-line
        const ti = body.torso.indexOf(tor)
        if (y >= L.crotch) P = take(occ.torso, ti, P)
        const { a, b } = axesFor(P, 0.8, 2.2)
        secs.push({ c: [0, y, y >= L.crotch ? tor.c[2] : 0], t: [0, 1, 0], u: [1, 0, 0], a, b, n: 2.2 })
      }
      pieces.push({ key: 'bottom-skirt', garment: bottom, geometry: tubeGeometry(secs.reverse(), { segments: 96 }) })
      notes.push(`${bottom.name}: brand chart gives body-size ranges only — skirt shape is illustrative.`)
    }
  }

  // ---------- TOP ----------
  const topG = worn.top ? byId[worn.top] : null
  if (topG) {
    const size = sizes[topG.id]
    const hemY = L.neckBase - cm(topG.geo.lengthCm ?? 58)
    const secs = torsoShell(topG, size, hemY, L.neckBase, 8)
    pieces.push({ key: 'top-body', garment: topG, geometry: tubeGeometry(secs, { segments: 128, mod: necklineMod(topG.neckline, body, L.neckBase) }) })
    const sl = topG.style === 'tee' ? cm(topG.geo.sleeveCm ?? 13) : cm(finished(topG, size, 'sleeve') ?? body.derived.sleeveCm.value) + 0.01
    sleeve(topG, size, sl, topG.style === 'tee' ? 6 : 4, topG.style === 'tee' ? 7 : 3).forEach((geo, i) => pieces.push({ key: `top-sleeve-${i}`, garment: topG, geometry: geo }))
    if (topG.sizeChart.provenance === 'finished-garment' && finished(topG, size, 'chest')! < bodyAt('bust') * 100) notes.push(`${topG.name} ${size}: chest is smaller than your bust.`)
  }

  // ---------- OUTER ----------
  const outer = worn.outer ? byId[worn.outer] : null
  if (outer) {
    const size = sizes[outer.id]
    const hemY = L.neckBase - cm(outer.geo.lengthCm ?? 68)
    const secs = torsoShell(outer, size, hemY, L.neckBase + 0.004, outer.geo.easeCm ?? 12)
    const geo = tubeGeometry(secs, { segments: 128, mod: necklineMod(outer.neckline, body, L.neckBase + 0.004) })
    // buttons down the front below the V
    const vBottom = L.neckBase - 0.17
    const buttons = secs.filter((_, i) => i % 15 === 0).filter(s => s.c[1] < vBottom - 0.02 && s.c[1] > hemY + 0.04).slice(-3).map(s => new THREE.Vector3(0, s.c[1], s.c[2] + s.b + 0.003))
    pieces.push({ key: 'outer-body', garment: outer, geometry: geo, buttons })
    const sl = cm(finished(outer, size, 'sleeve') ?? body.derived.sleeveCm.value) + 0.015
    sleeve(outer, size, sl, 9, 6).forEach((g2, i) => pieces.push({ key: `outer-sleeve-${i}`, garment: outer, geometry: g2 }))
    if (outer.sizeChart.provenance === 'none') notes.push(`${outer.name}: no size chart — drape shown with a generic ease, not this item's real size.`)
  }

  return { pieces, notes }
}
