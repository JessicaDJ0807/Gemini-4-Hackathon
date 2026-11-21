// Roamfit sample wardrobe: our own procedural 3D garments ("Level A" assets — the 3D model IS the item).
// Size charts here are the spec of these sample garments, not data about any real retail product.
export type Slot = 'top' | 'bottom' | 'outer' | 'shoes'
export type Provenance = 'finished-garment' | 'body-size-range' | 'none'
export type Pattern = { kind: 'solid' | 'gingham' | 'stripes' | 'rib' | 'linen' | 'pleats'; a: string; b?: string; scaleM?: number }
export type Garment = {
  id: string; slot: Slot; name: string; blurb: string
  category: 'top' | 'bottom' | 'outerwear' | 'shoes'
  style: 'tee' | 'longsleeve' | 'trouser-flare' | 'skirt-midi' | 'blazer' | 'cardigan' | 'sneaker' | 'boot'
  pattern: Pattern; roughness: number; sheen: number
  neckline?: 'crew' | 'square' | 'v' | 'boat'
  stretch: 'none' | 'moderate' | 'high' | 'unknown'
  material: string
  sizeChart: { provenance: Provenance; source: string; sizes: Record<string, Record<string, number | [number, number]>> }
  // geometry defaults used when a dimension isn't in the chart (illustrative only)
  geo: { lengthCm?: number; sleeveCm?: number; easeCm?: number; hemFlare?: number }
}

const sizes = (keys: string[], rows: Record<string, (number | [number, number])[]>) =>
  Object.fromEntries(keys.map((k, i) => [k, Object.fromEntries(Object.entries(rows).map(([d, v]) => [d, v[i]]))]))
const XS_XL = ['XS', 'S', 'M', 'L', 'XL']

export const GARMENTS: Garment[] = [
  { id: 'tee-square', slot: 'top', name: 'Square-Neck Tee', blurb: 'Ivory cotton-modal jersey', category: 'top', style: 'tee', neckline: 'square',
    pattern: { kind: 'rib', a: '#f3ece0', b: '#e8dfcf', scaleM: 0.006 }, roughness: 0.82, sheen: 0.5, stretch: 'moderate', material: '92% cotton, 8% elastane (sample spec)',
    sizeChart: { provenance: 'finished-garment', source: 'Roamfit sample garment spec', sizes: sizes(XS_XL, { chest: [80, 86, 92, 98, 104], waist: [76, 82, 88, 94, 100] }) },
    geo: { lengthCm: 54, sleeveCm: 13 } },
  { id: 'breton', slot: 'top', name: 'Breton Long Sleeve', blurb: 'Navy-stripe cotton knit', category: 'top', style: 'longsleeve', neckline: 'boat',
    pattern: { kind: 'stripes', a: '#f4efe4', b: '#1f2c4c', scaleM: 0.026 }, roughness: 0.85, sheen: 0.4, stretch: 'none', material: '100% cotton (sample spec)',
    sizeChart: { provenance: 'finished-garment', source: 'Roamfit sample garment spec', sizes: sizes(XS_XL, { chest: [86, 92, 98, 104, 110], waist: [84, 90, 96, 102, 108], sleeve: [57, 58, 59, 60, 61] }) },
    geo: { lengthCm: 60 } },
  { id: 'gingham-flare', slot: 'bottom', name: 'Gingham Flare Trouser', blurb: 'Black/ecru check, high rise', category: 'bottom', style: 'trouser-flare',
    pattern: { kind: 'gingham', a: '#f1ead9', b: '#1c1c1c', scaleM: 0.014 }, roughness: 0.78, sheen: 0.3, stretch: 'none', material: '68% polyester, 30% viscose, 2% elastane (sample spec)',
    sizeChart: { provenance: 'finished-garment', source: 'Roamfit sample garment spec', sizes: sizes(XS_XL, { waist: [64, 68, 72, 76, 80], hip: [90, 94, 98, 102, 106], thigh: [56, 58, 60, 62, 64], inseam: [79, 79, 80, 80, 81] }) },
    geo: { hemFlare: 1.45 } },
  { id: 'midi-skirt', slot: 'bottom', name: 'Pleated Midi Skirt', blurb: 'Terracotta crêpe pleats', category: 'bottom', style: 'skirt-midi',
    pattern: { kind: 'pleats', a: '#b65a3c', b: '#9a4a31', scaleM: 0.035 }, roughness: 0.6, sheen: 0.6, stretch: 'unknown', material: 'Polyester crêpe (stretch not stated)',
    sizeChart: { provenance: 'body-size-range', source: 'Brand-style body size guide (sample)', sizes: sizes(XS_XL, { waist: [[60, 64], [65, 69], [70, 74], [75, 79], [80, 84]], hip: [[86, 90], [91, 95], [96, 100], [101, 105], [106, 110]] }) },
    geo: { lengthCm: 74, easeCm: 4 } },
  { id: 'linen-blazer', slot: 'outer', name: 'Linen Blazer', blurb: 'Sand linen, relaxed shoulder', category: 'outerwear', style: 'blazer', neckline: 'v',
    pattern: { kind: 'linen', a: '#cdb894', b: '#bea783', scaleM: 0.05 }, roughness: 0.9, sheen: 0.2, stretch: 'none', material: '100% linen (sample spec)',
    sizeChart: { provenance: 'finished-garment', source: 'Roamfit sample garment spec', sizes: sizes(XS_XL, { chest: [94, 100, 106, 112, 118], sleeve: [58, 59, 60, 61, 62] }) },
    geo: { lengthCm: 70 } },
  { id: 'cardigan', slot: 'outer', name: 'Cropped Cardigan', blurb: 'Black fine-gauge knit', category: 'outerwear', style: 'cardigan', neckline: 'v',
    pattern: { kind: 'rib', a: '#1d1d20', b: '#2a2a2e', scaleM: 0.004 }, roughness: 0.9, sheen: 0.7, stretch: 'unknown', material: 'Knit (composition not stated)',
    sizeChart: { provenance: 'none', source: 'No size chart provided', sizes: {} },
    geo: { lengthCm: 44, easeCm: 9 } },
  { id: 'white-sneaker', slot: 'shoes', name: 'Court Sneaker', blurb: 'White leather, black heel tab', category: 'shoes', style: 'sneaker',
    pattern: { kind: 'solid', a: '#f7f6f2', b: '#151515' }, roughness: 0.55, sheen: 0, stretch: 'none', material: 'Leather (sample)', sizeChart: { provenance: 'none', source: 'Footwear sizing not modelled', sizes: {} }, geo: {} },
  { id: 'black-boot', slot: 'shoes', name: 'Chunky Boot', blurb: 'Glossy black, lug sole', category: 'shoes', style: 'boot',
    pattern: { kind: 'solid', a: '#121214', b: '#2b2b2e' }, roughness: 0.25, sheen: 0, stretch: 'none', material: 'Patent leather (sample)', sizeChart: { provenance: 'none', source: 'Footwear sizing not modelled', sizes: {} }, geo: {} },
]
export const byId = Object.fromEntries(GARMENTS.map(g => [g.id, g])) as Record<string, Garment>

export type Worn = Partial<Record<Slot, string | null>>
export const OUTFITS: { id: string; name: string; note: string; worn: Worn }[] = [
  { id: 'stroll', name: 'Old Montréal Stroll', note: 'Cobblestones by day', worn: { top: 'tee-square', bottom: 'gingham-flare', outer: null, shoes: 'white-sneaker' } },
  { id: 'port', name: 'Evening at the Old Port', note: 'Layers for the river breeze', worn: { top: 'breton', bottom: 'midi-skirt', outer: 'linen-blazer', shoes: 'black-boot' } },
]
