// Deterministic, explainable fit comparison. Pure arithmetic — no model ever produces these numbers.
// Works in centimetres internally. Used by the browser studio and by the server.

export const CM_PER_IN = 2.54
export const toCm = (v, unit) => (v == null || v === '' ? null : unit === 'in' ? Number(v) * CM_PER_IN : Number(v))
export const fromCm = (v, unit) => (v == null ? null : unit === 'in' ? v / CM_PER_IN : v)
export const round1 = v => Math.round(v * 10) / 10

// Which body measurement a garment dimension is comparable with. Only circumference↔circumference
// and length↔length pairs are compared; anything else is reported as not comparable.
export const COMPARABLE = {
  chest: { body: 'bustCm', kind: 'circumference', label: 'Chest / bust' },
  waist: { body: 'waistCm', kind: 'circumference', label: 'Waist' },
  hip: { body: 'hipCm', kind: 'circumference', label: 'Hip' },
  thigh: { body: 'thighCm', kind: 'circumference', label: 'Thigh' },
  inseam: { body: 'inseamCm', kind: 'length', label: 'Inseam' },
  sleeve: { body: 'sleeveCm', kind: 'length', label: 'Sleeve' },
}

// Ease bands (garment − body, cm) per category & dimension. Interpretive guidance, not a fit guarantee.
const BANDS = {
  top: { chest: [[-Infinity, 0, 'tighter than body', 'Smaller than your bust: only wearable if the fabric stretches.'], [0, 5, 'close fit', 'Skims the body.'], [5, 12, 'regular fit', 'Comfortable movement room.'], [12, Infinity, 'relaxed / oversized', 'Noticeably roomy.']] },
  outerwear: { chest: [[-Infinity, 4, 'too tight to layer', 'Little or no room over a top.'], [4, 10, 'trim fit', 'Room for a thin layer.'], [10, 18, 'regular fit', 'Room for a knit underneath.'], [18, Infinity, 'oversized', 'Very roomy.']] },
  bottom: {
    waist: [[-Infinity, -1, 'tighter than body', 'Smaller than your waist: needs stretch or a different size.'], [-1, 3, 'snug', 'Close at the waist.'], [3, 7, 'comfortable', 'Some room at the waist.'], [7, Infinity, 'loose', 'May need a belt.']],
    hip: [[-Infinity, 0, 'tighter than body', 'Smaller than your hip: needs stretch.'], [0, 4, 'close fit', 'Fitted through the hip.'], [4, 10, 'regular fit', 'Comfortable through the hip.'], [10, Infinity, 'relaxed', 'Roomy through the hip.']],
    thigh: [[-Infinity, 0, 'tighter than body', 'Smaller than your thigh: needs stretch.'], [0, 3, 'close fit', 'Fitted through the thigh.'], [3, 8, 'regular fit', 'Some room through the thigh.'], [8, Infinity, 'relaxed', 'Roomy through the thigh.']],
    inseam: [[-Infinity, -4, 'shorter', 'Hem lands noticeably above your ankle.'], [-4, 3, 'about right', 'Hem near the ankle.'], [3, Infinity, 'longer', 'Extra length; may pool or need hemming.']],
  },
}

function band(category, dim, ease) {
  const table = BANDS[category]?.[dim]
  if (!table) return { verdict: 'compared', note: '' }
  const [, , verdict, note] = table.find(([lo, hi]) => ease >= lo && ease < hi)
  return { verdict, note }
}

/**
 * body: { bustCm, waistCm, hipCm, inseamCm, ... } (null/undefined = not provided)
 * garment: { category, sizeChart: { provenance: 'finished-garment'|'body-size-range'|'none', unit, sizes: { M: { chest: 92, ... } } } }
 * Returns rows + warnings. Unknown stays unknown.
 */
export function compareFit(body, garment, size) {
  const chart = garment.sizeChart || { provenance: 'none', sizes: {} }
  const warnings = []
  if (chart.provenance === 'none' || !chart.sizes?.[size]) {
    warnings.push('No size chart for this item: fit cannot be compared. Showing an illustrative silhouette only.')
    return { size, provenance: chart.provenance, rows: [], warnings, evidence: 'none' }
  }
  const dims = chart.sizes[size]
  const rows = []
  for (const [dim, raw] of Object.entries(dims)) {
    const map = COMPARABLE[dim]
    if (!map) continue
    const bodyVal = body[map.body] ?? null
    if (chart.provenance === 'body-size-range') {
      // Brand chart lists BODY ranges the size is meant for — no ease can be computed from it.
      const [lo, hi] = Array.isArray(raw) ? raw : [raw, raw]
      const inRange = bodyVal == null ? null : bodyVal >= lo && bodyVal <= hi
      rows.push({ dim, label: map.label, body: bodyVal, garment: null, range: [lo, hi], ease: null,
        verdict: bodyVal == null ? 'unknown' : inRange ? 'within size range' : bodyVal < lo ? 'below size range' : 'above size range',
        note: bodyVal == null ? `Add your ${map.label.toLowerCase()} to compare.` : 'Brand body-size range, not a garment measurement: no ease estimate.' })
      continue
    }
    const g = Number(raw)
    if (bodyVal == null) { rows.push({ dim, label: map.label, body: null, garment: g, ease: null, verdict: 'unknown', note: `Add your ${map.label.toLowerCase()} to compare.` }); continue }
    const ease = round1(g - bodyVal)
    rows.push({ dim, label: map.label, body: bodyVal, garment: g, ease, ...band(garment.category, dim, ease) })
  }
  if (chart.provenance === 'body-size-range') warnings.push('This chart gives body-size ranges, not finished garment measurements, so ease cannot be calculated.')
  if (garment.stretch === 'unknown') warnings.push('Fabric stretch is not stated; negative ease may or may not be wearable.')
  const missing = rows.filter(r => r.verdict === 'unknown').map(r => r.label)
  if (missing.length) warnings.push(`Missing body measurements: ${missing.join(', ')}.`)
  return { size, provenance: chart.provenance, rows, warnings, evidence: chart.provenance === 'finished-garment' ? 'garment-measurements' : 'body-size-range' }
}

const GOOD = new Set(['close fit', 'regular fit', 'comfortable', 'snug', 'about right', 'trim fit', 'within size range', 'relaxed', 'relaxed / oversized'])
const BAD = new Set(['tighter than body', 'too tight to layer', 'below size range', 'above size range'])

/** Deterministic size suggestion: the smallest size with no "tight/out of range" rows and the most "good" rows. */
export function suggestSize(body, garment) {
  const sizes = Object.keys(garment.sizeChart?.sizes || {})
  if (!sizes.length || garment.sizeChart.provenance === 'none') return { size: null, reason: 'No size chart available.' }
  const scored = sizes.map((s, i) => {
    const r = compareFit(body, garment, s)
    const known = r.rows.filter(x => x.verdict !== 'unknown')
    return { s, i, bad: known.filter(x => BAD.has(x.verdict)).length, good: known.filter(x => GOOD.has(x.verdict)).length, known: known.length }
  })
  if (!scored.some(x => x.known)) return { size: null, reason: 'Add body measurements to get a size suggestion.' }
  const ok = scored.filter(x => x.bad === 0)
  const pick = (ok.length ? ok : scored).sort((a, b) => a.bad - b.bad || b.good - a.good || a.i - b.i)[0]
  return { size: pick.s, reason: pick.bad ? 'No size avoids every tight dimension; this is the closest.' : 'Smallest size with no tight dimensions.' }
}
