import { Suspense, useEffect, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { AvatarModel, type Appearance } from './avatar/AvatarModel'
import type { Measurements } from './avatar/bodyModel'
import type { Worn } from './wardrobe/catalog'
import { VacationScene, type TimeOfDay } from './travel/VacationScene'

export type Framing = 'full' | 'upper' | 'shoes' | 'wide'
type OrbitImpl = React.ComponentRef<typeof OrbitControls>
const FRAMES: Record<Framing, { pos: [number, number, number]; target: [number, number, number] }> = {
  full: { pos: [1.7, 1.1, 5.4], target: [0, 0.82, 0] },
  upper: { pos: [0.55, 1.5, 1.75], target: [0, 1.38, 0] },
  shoes: { pos: [0.7, 0.45, 1.5], target: [0, 0.22, 0] },
  wide: { pos: [3.6, 2.4, 8.5], target: [0, 1.4, -2] },
}

function CameraRig({ framing, nonce, controls }: { framing: Framing; nonce: number; controls: React.RefObject<OrbitImpl | null> }) {
  const { camera } = useThree()
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null)
  useEffect(() => { const f = FRAMES[framing]; goal.current = { pos: new THREE.Vector3(...f.pos), target: new THREE.Vector3(...f.target) } }, [framing, nonce])
  useFrame(() => {
    const c = controls.current; if (!goal.current || !c) return
    camera.position.lerp(goal.current.pos, 0.09); c.target.lerp(goal.current.target, 0.09); c.update()
    if (camera.position.distanceTo(goal.current.pos) < 0.01) goal.current = null
  })
  return null
}

function CaptureBridge({ register }: { register: (fn: () => string) => void }) {
  const { gl, scene, camera } = useThree()
  useEffect(() => register(() => { gl.render(scene, camera); return gl.domElement.toDataURL('image/png') }), [gl, scene, camera, register])
  useEffect(() => { if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__rf = { camera, scene } }, [camera, scene])
  return null
}

function Turntable({ yaw, spin, children }: { yaw: number; spin: boolean; children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null), extra = useRef(0)
  useFrame((_, dt) => { if (spin) extra.current += dt * 0.6; if (g.current) g.current.rotation.y = (yaw * Math.PI) / 180 + extra.current })
  return <group ref={g}>{children}</group>
}

export function Stage(p: {
  measurements: Measurements; look: Appearance; worn: Worn; sizes: Record<string, string>; tints: Record<string, string>
  time: TimeOfDay; framing: Framing; framingNonce: number; yaw: number; spin: boolean; orbit: boolean
  onNotes: (n: string[]) => void; registerCapture: (fn: () => string) => void
}) {
  const controls = useRef<OrbitImpl | null>(null)
  return <Canvas shadows dpr={[1, 2]} camera={{ position: FRAMES.full.pos, fov: 32, near: 0.05, far: 300 }} gl={{ preserveDrawingBuffer: true, antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
    onCreated={({ gl }) => { gl.shadowMap.type = THREE.PCFSoftShadowMap }}>
    <Suspense fallback={null}>
      <VacationScene time={p.time} />
      <Turntable yaw={p.yaw} spin={p.spin}>
        <AvatarModel measurements={p.measurements} look={p.look} worn={p.worn} sizes={p.sizes} tints={p.tints} onNotes={p.onNotes} />
      </Turntable>
      <ContactShadows position={[0, 0.003, 0]} opacity={0.5} scale={2.4} blur={2.4} far={1.2} resolution={512} />
    </Suspense>
    <OrbitControls ref={controls} makeDefault target={FRAMES.full.target} enablePan={false} minDistance={0.8} maxDistance={14} maxPolarAngle={1.53} autoRotate={p.orbit} autoRotateSpeed={1.1} enableDamping />
    <CameraRig framing={p.framing} nonce={p.framingNonce} controls={controls} />
    <CaptureBridge register={p.registerCapture} />
  </Canvas>
}
