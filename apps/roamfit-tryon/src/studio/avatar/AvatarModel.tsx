// "Soft Editorial Doll": measured body (from bodyModel) + stylised head, hair, face, shoes and garment shells.
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { RoundedBox } from '@react-three/drei'
import { buildBody, type Measurements } from './bodyModel'
import { tubeGeometry } from './tubeGeometry'
import { buildOutfit } from '../wardrobe/garmentGeometry'
import { byId, type Garment, type Worn } from '../wardrobe/catalog'
import { fabricTexture } from '../textures'

export type HairStyle = 'long' | 'bob' | 'bun' | 'short' | 'curly'
export type Appearance = { skin: string; hairStyle: HairStyle; hairColor: string; fringe: boolean; glasses: boolean; earrings: boolean; eyeColor: string }
export const DEFAULT_LOOK: Appearance = { skin: '#e9c2a4', hairStyle: 'long', hairColor: '#8a5a3b', fringe: false, glasses: false, earrings: true, eyeColor: '#3b2a22' }

function useDispose<T extends { dispose: () => void }>(items: T[]) { useEffect(() => () => items.forEach(i => i.dispose()), [items]) }

function garmentMaterial(g: Garment, tint: string) {
  const map = fabricTexture(g.pattern)
  return new THREE.MeshPhysicalMaterial({
    map: map ?? null, color: map ? new THREE.Color(tint) : new THREE.Color(g.pattern.a).multiply(new THREE.Color(tint)),
    roughness: g.roughness, sheen: g.sheen, sheenRoughness: 0.75, sheenColor: new THREE.Color('#ffffff'), side: THREE.DoubleSide,
  })
}

function Shoe({ g, x, y, z, footLen, tint }: { g: Garment; x: number; y: number; z: number; footLen: number; tint: string }) {
  const main = new THREE.Color(g.pattern.a).multiply(new THREE.Color(tint)), accent = g.pattern.b ?? '#222'
  if (g.style === 'boot') return <group position={[x, 0, z + footLen * 0.18]}>
    <RoundedBox args={[0.1, 0.05, footLen * 1.02]} radius={0.02} position={[0, 0.025, 0]} castShadow><meshPhysicalMaterial color={accent} roughness={0.8} /></RoundedBox>
    <RoundedBox args={[0.092, 0.085, footLen * 0.95]} radius={0.035} position={[0, 0.085, 0.004]} castShadow><meshPhysicalMaterial color={main} roughness={g.roughness} clearcoat={0.9} clearcoatRoughness={0.15} /></RoundedBox>
    <mesh position={[0, Math.max(0.16, y * 0.9), -footLen * 0.22]} castShadow><cylinderGeometry args={[0.052, 0.056, Math.max(0.16, y * 1.8), 28]} /><meshPhysicalMaterial color={main} roughness={g.roughness} clearcoat={0.9} clearcoatRoughness={0.15} /></mesh>
  </group>
  return <group position={[x, 0, z + footLen * 0.18]}>
    <RoundedBox args={[0.094, 0.032, footLen]} radius={0.014} position={[0, 0.016, 0]} castShadow><meshPhysicalMaterial color="#fbfbf8" roughness={0.6} /></RoundedBox>
    <RoundedBox args={[0.086, 0.06, footLen * 0.9]} radius={0.028} position={[0, 0.055, -0.004]} castShadow><meshPhysicalMaterial color={main} roughness={g.roughness} /></RoundedBox>
    <RoundedBox args={[0.05, 0.035, 0.02]} radius={0.008} position={[0, 0.07, -footLen * 0.47]}><meshPhysicalMaterial color={accent} roughness={0.5} /></RoundedBox>
    {[0, 1, 2].map(i => <mesh key={i} position={[0, 0.088 - i * 0.004, footLen * (0.05 + i * 0.07)]} rotation={[-0.25, 0, 0]}><boxGeometry args={[0.045, 0.004, 0.006]} /><meshStandardMaterial color="#dcdcd6" /></mesh>)}
  </group>
}

function Hair({ style, color, r, fringe }: { style: HairStyle; color: string; r: number; fringe: boolean }) {
  const mat = useMemo(() => new THREE.MeshPhysicalMaterial({ color, roughness: 0.48, sheen: 1, sheenColor: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.35), sheenRoughness: 0.35, side: THREE.DoubleSide }), [color])
  const curls = useMemo(() => {
    if (style !== 'curly') return []
    const pts: [number, number, number][] = []
    for (let i = 0; i < 260; i++) {
      const u = Math.random(), v = Math.random(), th = 2 * Math.PI * u, ph = Math.acos(2 * v - 1)
      const p = new THREE.Vector3(Math.sin(ph) * Math.sin(th), Math.cos(ph), Math.sin(ph) * Math.cos(th))
      if (p.y < -0.25 || (p.z > 0.35 && p.y < 0.45)) continue // keep face clear
      pts.push([p.x * r * 1.07, p.y * r * 1.07, p.z * r * 1.07])
    }
    return pts
  }, [style, r])
  const cap = <mesh material={mat} rotation={[-0.32, 0, 0]} castShadow><sphereGeometry args={[r * (style === 'short' ? 1.045 : 1.065), 48, 32, 0, Math.PI * 2, 0, Math.PI * 0.52]} /></mesh>
  return <group>
    {style !== 'curly' && cap}
    {style === 'long' && <mesh material={mat} position={[0, -r * 1.25, -r * 0.08]} castShadow><cylinderGeometry args={[r * 1.07, r * 1.0, r * 2.5, 48, 1, true, Math.PI * 0.32, Math.PI * 1.36]} /></mesh>}
    {style === 'bob' && <mesh material={mat} position={[0, -r * 0.45, -r * 0.02]} castShadow><cylinderGeometry args={[r * 1.08, r * 1.16, r * 1.0, 48, 1, true, Math.PI * 0.3, Math.PI * 1.4]} /></mesh>}
    {style === 'bun' && <mesh material={mat} position={[0, r * 0.62, -r * 0.62]} castShadow><sphereGeometry args={[r * 0.42, 32, 24]} /></mesh>}
    {style === 'curly' && curls.map((p, i) => <mesh key={i} material={mat} position={p} castShadow><sphereGeometry args={[r * 0.2, 12, 10]} /></mesh>)}
    {fringe && style !== 'curly' && <mesh material={mat} position={[0, r * 0.52, r * 0.74]} rotation={[0.55, 0, 0]} scale={[1, 0.32, 0.45]}><sphereGeometry args={[r * 0.82, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>}
  </group>
}

function Face({ r, look }: { r: number; look: Appearance }) {
  const onSurface = (x: number, y: number, k = 0.985): [number, number, number] => [x * r, y * r, Math.sqrt(Math.max(0, 1 - x * x - y * y)) * r * k]
  return <group>
    {[-1, 1].map(s => <group key={s}>
      <mesh position={onSurface(s * 0.34, 0.0, 0.93)} scale={[1, 1.18, 0.6]}><sphereGeometry args={[r * 0.11, 24, 16]} /><meshPhysicalMaterial color={look.eyeColor} roughness={0.15} clearcoat={1} /></mesh>
      <mesh position={onSurface(s * 0.31, 0.05, 1.005)}><sphereGeometry args={[r * 0.03, 10, 8]} /><meshBasicMaterial color="#ffffff" /></mesh>
      <mesh position={onSurface(s * 0.35, 0.24, 0.985)} rotation={[0, 0, s * -0.12]}><capsuleGeometry args={[r * 0.022, r * 0.16, 4, 8]} /><meshStandardMaterial color={look.hairColor} /></mesh>
      <mesh position={onSurface(s * 0.5, -0.22, 0.99)} rotation={[0, s * 0.5, 0]}><circleGeometry args={[r * 0.13, 24]} /><meshBasicMaterial color="#f08a7e" transparent opacity={0.28} depthWrite={false} /></mesh>
      <mesh position={[s * r * 0.98, -r * 0.05, -r * 0.02]} scale={[0.45, 1, 0.7]}><sphereGeometry args={[r * 0.17, 16, 12]} /><meshPhysicalMaterial color={look.skin} roughness={0.6} /></mesh>
      {look.earrings && <mesh position={[s * r * 1.0, -r * 0.3, 0]}><sphereGeometry args={[r * 0.05, 16, 12]} /><meshPhysicalMaterial color="#d9b25f" metalness={1} roughness={0.25} /></mesh>}
      {look.glasses && <mesh position={onSurface(s * 0.34, 0.0, 1.08)}><torusGeometry args={[r * 0.17, r * 0.018, 10, 32]} /><meshPhysicalMaterial color="#c8a25a" metalness={1} roughness={0.3} /></mesh>}
    </group>)}
    {look.glasses && <mesh position={onSurface(0, 0.02, 1.1)} rotation={[0, 0, Math.PI / 2]}><capsuleGeometry args={[r * 0.012, r * 0.18, 4, 8]} /><meshPhysicalMaterial color="#c8a25a" metalness={1} roughness={0.3} /></mesh>}
    <mesh position={onSurface(0, -0.16, 1.0)} scale={[1, 0.8, 0.8]}><sphereGeometry args={[r * 0.06, 16, 12]} /><meshPhysicalMaterial color={look.skin} roughness={0.55} /></mesh>
    <mesh position={onSurface(0, -0.36, 0.995)} rotation={[0, 0, Math.PI]}><torusGeometry args={[r * 0.09, r * 0.018, 8, 20, Math.PI]} /><meshStandardMaterial color="#b2524a" /></mesh>
  </group>
}

export function AvatarModel({ measurements, look, worn, sizes, tints, onNotes }: {
  measurements: Measurements; look: Appearance; worn: Worn; sizes: Record<string, string>; tints: Record<string, string>; onNotes?: (n: string[]) => void
}) {
  const body = useMemo(() => buildBody(measurements), [measurements])
  const skinMat = useMemo(() => new THREE.MeshPhysicalMaterial({ color: look.skin, roughness: 0.52, sheen: 0.4, sheenColor: new THREE.Color('#ffd9cc'), side: THREE.DoubleSide }), [look.skin])
  const bodyGeos = useMemo(() => [
    tubeGeometry(body.torso, { capStart: true }),
    ...body.legs.map(l => tubeGeometry(l, { capEnd: true })),
    ...body.arms.map(a => tubeGeometry(a, { capEnd: true })),
  ], [body])
  useDispose(bodyGeos)
  const outfit = useMemo(() => buildOutfit(body, worn, sizes), [body, worn, sizes])
  useDispose(outfit.pieces.map(p => p.geometry))
  const mats = useMemo(() => Object.fromEntries(outfit.pieces.map(p => [p.garment.id, garmentMaterial(p.garment, tints[p.garment.id] ?? '#ffffff')])), [outfit, tints])
  useEffect(() => { onNotes?.(outfit.notes) }, [outfit, onNotes])

  const H = measurements.heightCm / 100
  const footLen = 0.152 * H
  const shoes = worn.shoes ? byId[worn.shoes] : null
  const trouserHidesShaft = !!worn.bottom && byId[worn.bottom]?.style === 'trouser-flare'
  const hands = body.arms.map(a => { const s = a[a.length - 1]; return [s.c[0] + s.t[0] * 0.05, s.c[1] + s.t[1] * 0.05, s.c[2] + s.t[2] * 0.05] as [number, number, number] })
  const ankles = body.legs.map(l => l[l.length - 1].c)

  return <group>
    {bodyGeos.map((g, i) => <mesh key={i} geometry={g} material={skinMat} castShadow receiveShadow />)}
    {hands.map((p, i) => <mesh key={i} position={p} scale={[0.75, 1.3, 1]} material={skinMat} castShadow><sphereGeometry args={[0.038 * H / 1.68, 20, 16]} /></mesh>)}
    {/* head */}
    <group position={body.head.c}>
      <mesh material={skinMat} scale={[0.96, 1.04, 0.98]} castShadow><sphereGeometry args={[body.head.r, 48, 40]} /></mesh>
      <Face r={body.head.r} look={look} />
      <Hair style={look.hairStyle} color={look.hairColor} r={body.head.r} fringe={look.fringe} />
    </group>
    {/* garments */}
    {outfit.pieces.map(p => <mesh key={p.key} geometry={p.geometry} material={mats[p.garment.id]} castShadow receiveShadow />)}
    {outfit.pieces.flatMap(p => (p.buttons ?? []).map((b, i) => <mesh key={`${p.key}-b${i}`} position={b}><cylinderGeometry args={[0.009, 0.009, 0.004, 16]} /><meshPhysicalMaterial color="#3a2f26" roughness={0.3} /></mesh>))}
    {/* shoes or bare feet */}
    {ankles.map((a, i) => shoes
      ? <Shoe key={i} g={shoes} x={a[0]} y={trouserHidesShaft ? 0.09 : a[1]} z={a[2]} footLen={footLen} tint={tints[shoes.id] ?? '#ffffff'} />
      : <RoundedBox key={i} args={[0.085, 0.05, footLen]} radius={0.024} position={[a[0], 0.025, a[2] + footLen * 0.2]} material={skinMat} castShadow />)}
  </group>
}

export { buildBody }
