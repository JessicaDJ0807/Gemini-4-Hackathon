// "Old Montréal" street set — real 3D geometry (navigable 360°), procedurally built and lit like the reference photo:
// grey limestone & red-brick facades, mansard slate roofs, orange awnings, flags, cobblestones, low warm sun.
import { useMemo } from 'react'
import * as THREE from 'three'
import { Environment, Lightformer, Sky } from '@react-three/drei'
import { cobbleTexture, facadeTexture, pavementTexture, slateTexture, tiled } from '../textures'

export type TimeOfDay = 'golden' | 'midday'
export const SUN: Record<TimeOfDay, { pos: [number, number, number]; color: string; intensity: number; hemi: number; fog: string }> = {
  golden: { pos: [-9, 6.5, 5], color: '#ffd3a1', intensity: 3.1, hemi: 0.75, fog: '#e9cfae' },
  midday: { pos: [-4, 14, 6], color: '#fff6e8', intensity: 3.4, hemi: 1.0, fog: '#cfe0ee' },
}

type Bldg = { x: number; z: number; w: number; d: number; h: number; kind: 'stone' | 'brick'; facing: 1 | -1 }

function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 } }

function Building({ b }: { b: Bldg }) {
  const floors = Math.round(b.h / 3.3)
  const bays = Math.max(2, Math.round(b.d / 2.4))
  const front = useMemo(() => facadeTexture(b.kind, floors, bays), [b.kind, floors, bays])
  const side = useMemo(() => facadeTexture(b.kind, floors, Math.max(2, Math.round(b.w / 2.4))), [b.kind, floors, b.w])
  const slate = useMemo(() => slateTexture(), [])
  const plain = b.kind === 'stone' ? '#9a948a' : '#8f4532'
  // BoxGeometry material order: +x, -x, +y, -y, +z, -z. Street faces are ±x.
  const mats = [
    new THREE.MeshStandardMaterial({ map: b.facing === -1 ? front : null, color: b.facing === -1 ? '#ffffff' : plain, roughness: 0.92 }),
    new THREE.MeshStandardMaterial({ map: b.facing === 1 ? front : null, color: b.facing === 1 ? '#ffffff' : plain, roughness: 0.92 }),
    new THREE.MeshStandardMaterial({ color: '#4a4c52' }), new THREE.MeshStandardMaterial({ color: '#333' }),
    new THREE.MeshStandardMaterial({ map: side, roughness: 0.92 }), new THREE.MeshStandardMaterial({ map: side, roughness: 0.92 }),
  ]
  const streetX = b.x - (b.facing * b.w) / 2 // x of the street-facing wall
  const awnings = Array.from({ length: bays }, (_, i) => -b.d / 2 + (b.d / bays) * (i + 0.5)).filter((_, i) => i % 3 !== 1)
  return <group>
    <mesh position={[b.x, b.h / 2, b.z]} material={mats} castShadow receiveShadow><boxGeometry args={[b.w, b.h, b.d]} /></mesh>
    {/* mansard roof */}
    <mesh position={[b.x, b.h + 1.1, b.z]} castShadow><boxGeometry args={[b.w * 0.86, 2.2, b.d * 0.94]} /><meshStandardMaterial map={slate} color="#ffffff" roughness={0.7} /></mesh>
    <mesh position={[b.x, b.h + 0.12, b.z]}><boxGeometry args={[b.w + 0.25, 0.24, b.d + 0.25]} /><meshStandardMaterial color="#d8d2c6" /></mesh>
    {/* dormers */}
    {Array.from({ length: bays }, (_, i) => <mesh key={i} position={[streetX + b.facing * 0.55, b.h + 1.2, b.z - b.d / 2 + (b.d / bays) * (i + 0.5)]} castShadow><boxGeometry args={[0.8, 1.0, 0.9]} /><meshStandardMaterial color="#e8e4da" /></mesh>)}
    {/* awnings: sloped canvas + scalloped valance, projecting toward the street */}
    {awnings.map((dz, i) => <group key={i} position={[streetX, 0, b.z + dz]} rotation={[0, b.facing === -1 ? 0 : Math.PI, 0]}>
      <mesh position={[0.5, 3.12, 0]} rotation={[0, 0, -0.5]} castShadow><boxGeometry args={[1.12, 0.03, (b.d / bays) * 0.66]} /><meshStandardMaterial color="#d8603a" roughness={0.85} /></mesh>
      <mesh position={[0.98, 2.78, 0]} castShadow><boxGeometry args={[0.03, 0.2, (b.d / bays) * 0.66]} /><meshStandardMaterial color="#c4532f" roughness={0.85} /></mesh>
    </group>)}
  </group>
}

function Lamp({ x, z }: { x: number; z: number }) {
  return <group position={[x, 0.12, z]}>
    <mesh position={[0, 1.7, 0]} castShadow><cylinderGeometry args={[0.04, 0.06, 3.4, 12]} /><meshStandardMaterial color="#1b1d1f" metalness={0.6} roughness={0.4} /></mesh>
    <mesh position={[0, 3.5, 0]}><cylinderGeometry args={[0.14, 0.09, 0.42, 6]} /><meshStandardMaterial color="#fff1cf" emissive="#ffcf7a" emissiveIntensity={0.6} /></mesh>
    <mesh position={[0, 3.76, 0]}><coneGeometry args={[0.2, 0.18, 6]} /><meshStandardMaterial color="#1b1d1f" /></mesh>
  </group>
}

function Flag({ x, y, z, dir, colors }: { x: number; y: number; z: number; dir: 1 | -1; colors: [string, string] }) {
  return <group position={[x, y, z]} rotation={[0, 0, dir * 0.6]}>
    <mesh position={[0, 0.9, 0]}><cylinderGeometry args={[0.02, 0.02, 1.9, 8]} /><meshStandardMaterial color="#e8e8e8" /></mesh>
    <mesh position={[dir * -0.0, 1.45, 0.42]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[0.85, 0.55]} /><meshStandardMaterial color={colors[0]} side={THREE.DoubleSide} /></mesh>
    <mesh position={[dir * 0.002, 1.45, 0.42]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[0.85, 0.12]} /><meshStandardMaterial color={colors[1]} side={THREE.DoubleSide} /></mesh>
  </group>
}

export function VacationScene({ time }: { time: TimeOfDay }) {
  const sun = SUN[time]
  const cobble = useMemo(() => tiled(cobbleTexture(), 11.2, 120, 1.6), [])
  const pave = useMemo(() => tiled(pavementTexture(), 2.2, 120, 2), [])
  const buildings = useMemo(() => {
    const r = rng(7), out: Bldg[] = []
    for (const side of [-1, 1] as const) {
      let z = -46
      while (z < 40) {
        const d = 8 + r() * 6
        if (z < -12 || z > -6) out.push({ x: side * (5.6 + 4), z: z + d / 2, w: 8, d, h: 10 + Math.round(r() * 3) * 3.3, kind: r() > 0.42 ? 'stone' : 'brick', facing: side === -1 ? -1 : 1 })
        z += d
      }
    }
    return out
  }, [])
  const flagColors: [string, string][] = [['#1f5fbf', '#ffffff'], ['#c8102e', '#ffffff'], ['#1f7a3f', '#f2f2f2'], ['#e2b007', '#c8102e']]
  return <group>
    <Sky sunPosition={sun.pos} turbidity={time === 'golden' ? 6 : 3} rayleigh={time === 'golden' ? 2.2 : 0.8} mieCoefficient={0.006} mieDirectionalG={0.86} />
    <fog attach="fog" args={[sun.fog, 22, 80]} />
    <hemisphereLight args={['#c9dcff', '#a07850', sun.hemi]} />
    <directionalLight position={sun.pos} intensity={sun.intensity} color={sun.color} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02}
      shadow-camera-left={-9} shadow-camera-right={9} shadow-camera-top={9} shadow-camera-bottom={-9} shadow-camera-near={0.5} shadow-camera-far={40} />
    <Environment resolution={128} frames={1}>
      <Lightformer form="rect" intensity={1.2} color={sun.color} position={[-5, 4, 3]} scale={[6, 3, 1]} />
      <Lightformer form="rect" intensity={0.6} color="#bcd4ff" position={[4, 6, -4]} scale={[10, 6, 1]} />
      <Lightformer form="rect" intensity={0.35} color="#d8b48c" position={[0, -2, 0]} rotation-x={Math.PI / 2} scale={[20, 20, 1]} />
    </Environment>
    {/* street + sidewalks */}
    <mesh rotation-x={-Math.PI / 2} receiveShadow><planeGeometry args={[11.2, 120]} /><meshStandardMaterial map={cobble} color="#ffffff" roughness={0.95} /></mesh>
    {[-1, 1].map(s => <mesh key={s} position={[s * 4.6, 0.06, 0]} receiveShadow castShadow><boxGeometry args={[2.2, 0.12, 120]} /><meshStandardMaterial map={pave} roughness={0.95} /></mesh>)}
    <mesh rotation-x={-Math.PI / 2} position={[0, -0.01, 0]} receiveShadow><planeGeometry args={[200, 200]} /><meshStandardMaterial color="#6e6055" /></mesh>
    {buildings.map((b, i) => <Building key={i} b={b} />)}
    {[-18, -2, 8, 22].map(z => [<Lamp key={`l${z}`} x={-4.0} z={z} />, <Lamp key={`r${z}`} x={4.0} z={z + 5} />])}
    {buildings.filter((_, i) => i % 2 === 0).slice(0, 8).map((b, i) => <Flag key={i} x={b.x - (b.facing * b.w) / 2} y={6.6} z={b.z} dir={b.facing === 1 ? -1 : 1} colors={flagColors[i % flagColors.length]} />)}
    {/* hanging flower baskets on wall brackets */}
    {buildings.slice(0, 10).map((b, i) => { const wx = b.x - (b.facing * b.w) / 2, dir = -b.facing; return <group key={i} position={[wx, 2.55, b.z + 1.2]}>
      <mesh position={[dir * 0.22, 0.12, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.012, 0.012, 0.44, 6]} /><meshStandardMaterial color="#1d1d1d" /></mesh>
      <mesh position={[dir * 0.4, -0.08, 0]} castShadow><cylinderGeometry args={[0.17, 0.11, 0.16, 16]} /><meshStandardMaterial color="#3b2a1e" roughness={0.9} /></mesh>
      <mesh position={[dir * 0.4, 0.04, 0]} scale={[1, 0.6, 1]} castShadow><sphereGeometry args={[0.22, 14, 10]} /><meshStandardMaterial color={i % 2 ? '#6f8f35' : '#5f7f30'} roughness={0.95} /></mesh>
      {[0, 1, 2, 3, 4].map(k => <mesh key={k} position={[dir * 0.4 + Math.cos(k * 1.3) * 0.16, 0.1 + (k % 2) * 0.04, Math.sin(k * 1.3) * 0.16]}><sphereGeometry args={[0.045, 8, 6]} /><meshStandardMaterial color={i % 2 ? '#e04d6c' : '#f2a03d'} /></mesh>)}
    </group> })}
  </group>
}
