// Measurement-driven simplified body. Units: metres, y up, feet at y = 0, facing +z.
// Each body part is a stack of superellipse cross-sections ("sections"). At the bust, waist, hip, thigh and
// neck landmarks the section perimeter equals the user's circumference exactly (verified in tests).
// Head is stylised (×HEAD_SCALE) and is NOT part of the measured body.

export type Measurements = {
  heightCm: number; bustCm: number; waistCm: number; hipCm: number; inseamCm: number
  shoulderCm?: number | null; sleeveCm?: number | null; thighCm?: number | null; neckCm?: number | null
}
export type Vec3 = [number, number, number]
/** c = centre, t = unit tangent (tube direction), u = unit "width" axis; depth axis = t × u. Semi-axes a (width), b (depth). */
export type Section = { c: Vec3; t: Vec3; u: Vec3; a: number; b: number; n: number; key?: string }
export type Body = {
  torso: Section[]; legs: [Section[], Section[]]; arms: [Section[], Section[]]
  head: { c: Vec3; r: number }; neckTopY: number
  landmarks: Record<string, number>; derived: Record<string, { value: number; source: 'input' | 'estimated' }>
}

export const HEAD_SCALE = 1.35
export const DEFAULTS: Measurements = { heightCm: 168, bustCm: 88, waistCm: 70, hipCm: 96, inseamCm: 77 }

// ---------- superellipse helpers ----------
const SEG = 64
export function shapePoint(a: number, b: number, n: number, th: number): [number, number] {
  const c = Math.cos(th), s = Math.sin(th)
  return [a * Math.sign(c) * Math.abs(c) ** (2 / n), b * Math.sign(s) * Math.abs(s) ** (2 / n)]
}
export function perimeter(a: number, b: number, n: number, seg = 720) {
  let p = 0, [px, pz] = shapePoint(a, b, n, 0)
  for (let i = 1; i <= seg; i++) { const [x, z] = shapePoint(a, b, n, (i / seg) * Math.PI * 2); p += Math.hypot(x - px, z - pz); px = x; pz = z }
  return p
}
/** semi-axes for a target circumference C (m) with depth ratio k and exponent n */
export function axesFor(C: number, k: number, n: number) { const a = C / perimeter(1, k, n); return { a, b: a * k } }

// ---------- 1-D monotone-ish Hermite interpolation through control points (hits every control exactly) ----------
function hermite(ys: number[], vs: number[], y: number) {
  const N = ys.length
  if (y <= ys[0]) return vs[0]
  if (y >= ys[N - 1]) return vs[N - 1]
  let i = 0; while (y > ys[i + 1]) i++
  const slope = (j: number) => {
    if (j === 0) return (vs[1] - vs[0]) / (ys[1] - ys[0])
    if (j === N - 1) return (vs[N - 1] - vs[N - 2]) / (ys[N - 1] - ys[N - 2])
    const d0 = (vs[j] - vs[j - 1]) / (ys[j] - ys[j - 1]), d1 = (vs[j + 1] - vs[j]) / (ys[j + 1] - ys[j])
    return d0 * d1 <= 0 ? 0 : (2 * d0 * d1) / (d0 + d1) // harmonic mean → no overshoot at extremes (exact landmarks)
  }
  const h = ys[i + 1] - ys[i], t = (y - ys[i]) / h, t2 = t * t, t3 = t2 * t
  return (2 * t3 - 3 * t2 + 1) * vs[i] + (t3 - 2 * t2 + t) * h * slope(i) + (-2 * t3 + 3 * t2) * vs[i + 1] + (t3 - t2) * h * slope(i + 1)
}

const norm = (v: Vec3): Vec3 => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l] }
const lerp3 = (p: Vec3, q: Vec3, t: number): Vec3 => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]

/** Build a limb as a straight-ish chain through joints with circumference controls along its length. */
function limb(joints: Vec3[], circ: { at: number; C: number; key?: string }[], k: number, n: number, steps: number, uHint: Vec3): Section[] {
  const segLen = joints.slice(1).map((j, i) => Math.hypot(j[0] - joints[i][0], j[1] - joints[i][1], j[2] - joints[i][2]))
  const total = segLen.reduce((s, x) => s + x, 0)
  const out: Section[] = []
  // uniform samples plus every control position, so controlled circumferences are hit exactly
  const ds = [...new Set([...Array.from({ length: steps + 1 }, (_, s) => (s / steps) * total), ...circ.map(x => x.at * total)])].sort((p, q) => p - q)
  for (const d of ds) {
    let acc = 0, i = 0
    while (i < segLen.length - 1 && acc + segLen[i] < d) acc += segLen[i++]
    const t = Math.min(1, (d - acc) / segLen[i])
    const c = lerp3(joints[i], joints[i + 1], t)
    const tan = norm([joints[i + 1][0] - joints[i][0], joints[i + 1][1] - joints[i][1], joints[i + 1][2] - joints[i][2]])
    // u = component of uHint orthogonal to tangent
    const dot = uHint[0] * tan[0] + uHint[1] * tan[1] + uHint[2] * tan[2]
    const u = norm([uHint[0] - dot * tan[0], uHint[1] - dot * tan[1], uHint[2] - dot * tan[2]])
    const C = hermite(circ.map(x => x.at * total), circ.map(x => x.C), d)
    const { a, b } = axesFor(C, k, n)
    const key = circ.find(x => Math.abs(x.at * total - d) < 1e-9 && x.key)?.key
    out.push({ c, t: tan, u, a, b, n, key })
  }
  return out
}

export function buildBody(input: Measurements): Body {
  const m = { ...DEFAULTS, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v != null && v !== 0)) } as Measurements
  const H = m.heightCm / 100, cm = (v: number) => v / 100
  const derived: Body['derived'] = {}
  const pick = (key: string, given: number | null | undefined, est: number) => {
    const v = given ?? est; derived[key] = { value: Math.round(v * 10) / 10, source: given ? 'input' : 'estimated' }; return v
  }
  const shoulderCm = pick('shoulderCm', m.shoulderCm, m.bustCm * 0.44)
  const thighCm = pick('thighCm', m.thighCm, m.hipCm * 0.58)
  const neckCm = pick('neckCm', m.neckCm, 22 + m.bustCm * 0.13)
  const sleeveCm = pick('sleeveCm', m.sleeveCm, m.heightCm * 0.345)

  // Vertical landmarks (fractions of stature from standard anthropometric proportions; inseam is direct).
  const crotchY = cm(m.inseamCm)
  const L = {
    crotch: crotchY, hip: Math.max(crotchY + 0.03 * H, 0.5 * H), waist: 0.615 * H, bust: 0.72 * H,
    armpit: 0.745 * H, shoulder: 0.81 * H, neckBase: 0.83 * H, neckTop: 0.865 * H, ankle: 0.045 * H, knee: 0.285 * H,
  }
  if (L.hip >= L.waist - 0.04) L.hip = L.waist - 0.06

  // ---- torso ----
  const ctrl: { y: number; C: number; k: number; n: number; key?: string }[] = [
    { y: L.crotch - 0.008 * H, C: cm(m.hipCm) * 0.4, k: 0.7, n: 2.2 },
    { y: L.crotch + 0.01 * H, C: cm(m.hipCm) * 0.93, k: 0.74, n: 2.3 },
    { y: L.hip, C: cm(m.hipCm), k: 0.74, n: 2.4, key: 'hip' },
    { y: L.waist, C: cm(m.waistCm), k: 0.78, n: 2.3, key: 'waist' },
    { y: (L.waist + L.bust) / 2, C: (cm(m.waistCm) + cm(m.bustCm)) / 2 * 0.985, k: 0.74, n: 2.3 },
    { y: L.bust, C: cm(m.bustCm), k: 0.7, n: 2.4, key: 'bust' },
    { y: L.armpit, C: cm(m.bustCm) * 0.97, k: 0.64, n: 2.6 },
    { y: L.shoulder - 0.012 * H, C: 0, k: 0.46, n: 3.2, key: 'shoulder' }, // C from shoulder width below
    { y: L.neckBase, C: cm(neckCm) * 1.18, k: 0.85, n: 2.1 },
    { y: L.neckTop, C: cm(neckCm), k: 0.92, n: 2, key: 'neck' },
  ]
  // shoulder section: width = biacromial breadth
  const sh = ctrl.find(c => c.key === 'shoulder')!
  sh.C = perimeter(cm(shoulderCm) / 2, (cm(shoulderCm) / 2) * sh.k, sh.n)
  const ys = ctrl.map(c => c.y), Cs = ctrl.map(c => c.C), ks = ctrl.map(c => c.k), ns = ctrl.map(c => c.n)
  const torso: Section[] = []
  const steps = 180 // ~5 mm rings: keeps garment necklines smooth
  const yAll = new Set<number>(ys)
  for (let i = 0; i <= steps; i++) yAll.add(ys[0] + (ys[ys.length - 1] - ys[0]) * (i / steps))
  for (const y of [...yAll].sort((p, q) => p - q)) {
    const C = hermite(ys, Cs, y), k = hermite(ys, ks, y), n = hermite(ys, ns, y)
    const { a, b } = axesFor(C, k, n)
    const key = ctrl.find(c => Math.abs(c.y - y) < 1e-9)?.key
    // slight forward offset at bust, backward at seat, upright neck
    const cz = 0.012 * Math.exp(-(((y - L.bust) / (0.06 * H)) ** 2)) - 0.01 * Math.exp(-(((y - L.hip) / (0.05 * H)) ** 2))
    torso.push({ c: [0, y, cz], t: [0, 1, 0], u: [1, 0, 0], a, b, n, key })
  }

  // ---- legs ----
  const hipSec = torso.find(s => s.key === 'hip')!
  const legX = hipSec.a * 0.47
  const legs = ([-1, 1] as const).map(side => limb(
    [[side * legX, L.crotch + 0.02 * H, 0], [side * legX * 0.82, L.knee, 0.005], [side * legX * 0.78, L.ankle, -0.005]],
    [{ at: 0, C: cm(thighCm) * 1.03 }, { at: 0.06, C: cm(thighCm), key: 'thigh' }, { at: 0.55, C: cm(thighCm) * 0.66 }, { at: 0.72, C: cm(thighCm) * 0.64 }, { at: 1, C: cm(thighCm) * 0.4 }],
    0.92, 2.1, 40, [1, 0, 0])) as [Section[], Section[]]

  // ---- arms (relaxed A-pose, ~11° from vertical) ----
  const shoulderSec = torso.find(s => s.key === 'shoulder')!
  const armLen = cm(sleeveCm) // shoulder point → wrist
  const ang = (11 * Math.PI) / 180
  const arms = ([-1, 1] as const).map(side => {
    const s0: Vec3 = [side * (shoulderSec.a - 0.025), L.shoulder - 0.03 * H, -0.005]
    const elbow: Vec3 = [s0[0] + side * Math.sin(ang) * armLen * 0.56, s0[1] - Math.cos(ang) * armLen * 0.56, -0.01]
    const wrist: Vec3 = [elbow[0] + side * Math.sin(ang * 0.6) * armLen * 0.44, elbow[1] - Math.cos(ang * 0.6) * armLen * 0.44, 0.03]
    const upper = cm(m.bustCm) * 0.31
    return limb([s0, elbow, wrist], [{ at: 0, C: upper * 1.12 }, { at: 0.12, C: upper }, { at: 0.56, C: upper * 0.8 }, { at: 0.8, C: upper * 0.82 }, { at: 1, C: upper * 0.56 }], 0.9, 2, 28, [0, 0, 1])
  }) as [Section[], Section[]]

  // ---- head (stylised) ----
  const realHeadR = 0.062 * H
  const r = realHeadR * HEAD_SCALE
  const head = { c: [0, L.neckTop + r * 0.82, 0.01] as Vec3, r }

  return { torso, legs, arms, head, neckTopY: L.neckTop, landmarks: L, derived }
}

/** Perimeter (m) of a section, for verification. */
export const sectionPerimeter = (s: Section) => perimeter(s.a, s.b, s.n)
export const SEGMENTS = SEG
