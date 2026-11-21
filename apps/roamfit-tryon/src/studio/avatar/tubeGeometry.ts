// Turns a stack of Sections into a closed-around, open-ended tube BufferGeometry with world-scale UVs
// (u, v in metres) so fabric patterns keep a constant physical size.
import * as THREE from 'three'
import { shapePoint, type Section, type Vec3 } from './bodyModel'

const cross = (p: Vec3, q: Vec3): Vec3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]]

export type VertexMod = (p: THREE.Vector3, theta: number, sectionIndex: number) => void

export function tubeGeometry(sections: Section[], opts: { segments?: number; capStart?: boolean; capEnd?: boolean; mod?: VertexMod } = {}) {
  const seg = opts.segments ?? 64
  const pos: number[] = [], uv: number[] = [], idx: number[] = []
  let vAcc = 0
  const p = new THREE.Vector3()
  sections.forEach((s, i) => {
    if (i > 0) { const q = sections[i - 1].c; vAcc += Math.hypot(s.c[0] - q[0], s.c[1] - q[1], s.c[2] - q[2]) }
    const w = cross(s.t, s.u) // depth axis
    let uAcc = 0, prev: [number, number] | null = null
    for (let j = 0; j <= seg; j++) {
      // theta = 0 points along +u; +PI/2 points along depth axis (front for torso/legs)
      const th = (j / seg) * Math.PI * 2
      const [x, z] = shapePoint(s.a, s.b, s.n, th)
      if (prev) uAcc += Math.hypot(x - prev[0], z - prev[1]); prev = [x, z]
      p.set(s.c[0] + s.u[0] * x + w[0] * z, s.c[1] + s.u[1] * x + w[1] * z, s.c[2] + s.u[2] * x + w[2] * z)
      opts.mod?.(p, th, i)
      pos.push(p.x, p.y, p.z); uv.push(uAcc, vAcc)
    }
  })
  const row = seg + 1
  // Pick winding so normals face outward (frames differ between torso / legs / arms).
  const V = (k: number) => new THREE.Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2])
  const a0 = V(0), b0 = V(1), c0 = V(row)
  const n0 = new THREE.Vector3().subVectors(c0, a0).cross(new THREE.Vector3().subVectors(b0, a0))
  const outward = n0.dot(new THREE.Vector3().subVectors(a0, new THREE.Vector3(...sections[0].c))) > 0
  for (let i = 0; i < sections.length - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * row + j, b = a + 1, c = a + row, d = c + 1
    outward ? idx.push(a, c, b, b, c, d) : idx.push(a, b, c, b, d, c)
  }
  const cap = (si: number, flip: boolean) => {
    const s = sections[si], centre = pos.length / 3
    pos.push(...s.c); uv.push(0, 0)
    for (let j = 0; j < seg; j++) { const a = si * row + j, b = a + 1; flip ? idx.push(centre, a, b) : idx.push(centre, b, a) }
  }
  if (opts.capStart) cap(0, false)
  if (opts.capEnd) cap(sections.length - 1, true)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** Copy of sections with each circumference grown to a target perimeter (keeps centre, axes ratio, exponent). */
export function scaleSections(sections: Section[], perimeterAt: (s: Section, i: number) => number, basePerimeter: (s: Section) => number): Section[] {
  return sections.map((s, i) => { const f = perimeterAt(s, i) / basePerimeter(s); return { ...s, a: s.a * f, b: s.b * f } })
}
