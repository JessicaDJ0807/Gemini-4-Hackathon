import { describe, expect, it } from 'vitest'
import { buildBody, sectionPerimeter, type Measurements } from './avatar/bodyModel'
import { buildOutfit } from './wardrobe/garmentGeometry'
import { byId, OUTFITS } from './wardrobe/catalog'
import { compareFit, suggestSize, toCm, fromCm } from '../../shared/fit.js'

const A: Measurements = { heightCm: 168, bustCm: 88, waistCm: 70, hipCm: 96, inseamCm: 77 }
const B: Measurements = { heightCm: 181, bustCm: 104, waistCm: 90, hipCm: 104, inseamCm: 83, shoulderCm: 46, sleeveCm: 63, thighCm: 60, neckCm: 39 }
const per = (body: ReturnType<typeof buildBody>, key: string) => sectionPerimeter(body.torso.find(s => s.key === key)!) * 100

describe('measurement-driven body geometry', () => {
  for (const [name, m] of [['A', A], ['B', B]] as const) {
    it(`profile ${name}: landmark circumferences equal the input (±0.2 cm)`, () => {
      const b = buildBody(m)
      expect(per(b, 'bust')).toBeCloseTo(m.bustCm, 0)
      expect(Math.abs(per(b, 'bust') - m.bustCm)).toBeLessThan(0.2)
      expect(Math.abs(per(b, 'waist') - m.waistCm)).toBeLessThan(0.2)
      expect(Math.abs(per(b, 'hip') - m.hipCm)).toBeLessThan(0.2)
      const thigh = sectionPerimeter(b.legs[0].find(s => s.key === 'thigh')!) * 100
      expect(Math.abs(thigh - b.derived.thighCm.value)).toBeLessThan(0.3)
    })
  }
  it('height and inseam move the geometry', () => {
    const tall = buildBody({ ...A, heightCm: 185 }), short = buildBody({ ...A, heightCm: 155 })
    expect(tall.head.c[1]).toBeGreaterThan(short.head.c[1] + 0.25)
    expect(buildBody({ ...A, inseamCm: 85 }).landmarks.crotch).toBeCloseTo(0.85, 5)
  })
  it('changing waist changes only the waist region noticeably', () => {
    const w1 = buildBody({ ...A, waistCm: 66 }), w2 = buildBody({ ...A, waistCm: 84 })
    expect(per(w2, 'waist') - per(w1, 'waist')).toBeCloseTo(18, 0)
    expect(Math.abs(per(w2, 'bust') - per(w1, 'bust'))).toBeLessThan(0.2)
  })
  it('optional measurements are marked estimated unless given', () => {
    expect(buildBody(A).derived.thighCm.source).toBe('estimated')
    expect(buildBody(B).derived.thighCm.source).toBe('input')
  })
})

describe('garment shells never sit inside the body or the layer below', () => {
  for (const o of OUTFITS) for (const [name, m] of [['A', A], ['B', B]] as const) {
    it(`${o.name} on profile ${name}`, () => {
      const body = buildBody(m)
      const sizes = { 'tee-square': 'XS', breton: 'XS', 'gingham-flare': 'XS', 'linen-blazer': 'XS' } // smallest sizes = worst case
      const { pieces } = buildOutfit(body, o.worn, sizes)
      expect(pieces.length).toBeGreaterThan(3)
      for (const p of pieces) {
        const pos = p.geometry.getAttribute('position')
        expect(pos.count).toBeGreaterThan(10)
        for (let i = 0; i < pos.count; i++) expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(true)
      }
    })
  }
})

describe('fit engine (deterministic arithmetic)', () => {
  const bodyA = { bustCm: 88, waistCm: 70, hipCm: 96, inseamCm: 77, thighCm: null, sleeveCm: null }
  it('ease = garment − body for finished-garment charts', () => {
    const r = compareFit(bodyA, byId['tee-square'], 'M')
    const chest = r.rows.find(x => x.dim === 'chest')!
    expect(chest.garment).toBe(92); expect(chest.ease).toBe(4); expect(chest.verdict).toBe('close fit')
    expect(r.evidence).toBe('garment-measurements')
  })
  it('known example: 86 cm body vs 100 cm garment → 14 cm ease', () => {
    const g = { category: 'outerwear', sizeChart: { provenance: 'finished-garment', sizes: { M: { chest: 100 } } } }
    expect(compareFit({ bustCm: 86 }, g, 'M').rows[0].ease).toBe(14)
  })
  it('body-size-range charts never produce an ease number', () => {
    const r = compareFit(bodyA, byId['midi-skirt'], 'S')
    expect(r.rows.every(x => x.ease === null)).toBe(true)
    expect(r.rows.find(x => x.dim === 'waist')!.verdict).toBe('above size range') // 70 vs 65–69
    expect(compareFit(bodyA, byId['midi-skirt'], 'M').rows.find(x => x.dim === 'waist')!.verdict).toBe('within size range')
    expect(r.warnings.join(' ')).toMatch(/not finished garment measurements/)
  })
  it('missing size chart → no rows, explicit warning', () => {
    const r = compareFit(bodyA, byId['cardigan'], 'M')
    expect(r.rows).toHaveLength(0); expect(r.warnings[0]).toMatch(/No size chart/)
  })
  it('missing body measurement stays unknown (never estimated)', () => {
    const r = compareFit(bodyA, byId['gingham-flare'], 'M')
    expect(r.rows.find(x => x.dim === 'thigh')!.verdict).toBe('unknown')
  })
  it('size suggestion picks the smallest non-tight size', () => {
    expect(suggestSize(bodyA, byId['gingham-flare']).size).toBe('M') // waist 72 (+2), hip 98 (+2)
    expect(suggestSize({ ...bodyA, waistCm: 77, hipCm: 101 }, byId['gingham-flare']).size).toBe('L')
  })
  it('unit conversion round-trips', () => {
    expect(toCm(34, 'in')).toBeCloseTo(86.36, 2)
    expect(fromCm(86.36, 'in')).toBeCloseTo(34, 5)
  })
})
