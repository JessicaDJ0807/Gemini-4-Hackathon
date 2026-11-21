// Shared viewer for both modes: a stationary destination PHOTO with a transparent WebGL canvas on top.
// Only the avatar rotates (drag); the camera and background never move, which is honest for a single 2D photo.
import { Component, Suspense, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef, type ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer, useGLTF } from '@react-three/drei'
import * as THREE from 'three'

export type Destination = { id: string; name: string; url: string; focal: [number, number]; light: { dir: [number, number, number]; color: string; intensity: number; ambient: number }; ground: { x: number; y: number; scale: number } }
export type ViewerHandle = { snapshot: () => Promise<string> }
type Props = { modelUrl: string | null; fallbackImage?: string | null; fallbackLabel?: string; destination: Destination; placement: { x: number; y: number; scale: number }; badge?: ReactNode; onError?: (m: string) => void }

const CAM = { pos: new THREE.Vector3(0, 1.0, 6.2), target: new THREE.Vector3(0, 0.86, 0), fov: 26 }

function Model({ url, yaw }: { url: string; yaw: React.MutableRefObject<{ cur: number; goal: number }> }) {
  const { scene } = useGLTF(url)
  const g = useRef<THREE.Group>(null)
  const obj = useMemo(() => {
    const root = scene.clone(true)
    root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3())
    // Upright check: if the model's tallest axis isn't Y, rotate it up.
    if (size.z > size.y * 1.2) root.rotation.x = -Math.PI / 2
    else if (size.x > size.y * 1.2) root.rotation.z = Math.PI / 2
    root.updateMatrixWorld(true)
    const b2 = new THREE.Box3().setFromObject(root), s2 = b2.getSize(new THREE.Vector3()), c2 = b2.getCenter(new THREE.Vector3())
    const wrap = new THREE.Group(); const k = 1.7 / (s2.y || 1)
    root.position.sub(new THREE.Vector3(c2.x, b2.min.y, c2.z)); wrap.add(root); wrap.scale.setScalar(k)
    wrap.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true } })
    void c; void size
    return wrap
  }, [scene])
  useFrame((_, dt) => {
    const y = yaw.current; y.cur += (y.goal - y.cur) * Math.min(1, dt * 10)
    if (g.current) g.current.rotation.y = y.cur
  })
  return <group ref={g}><primitive object={obj} /></group>
}

function Snapshot({ api }: { api: React.MutableRefObject<(() => HTMLCanvasElement) | null> }) {
  const { gl, scene, camera } = useThree()
  useEffect(() => { api.current = () => { gl.render(scene, camera); return gl.domElement } }, [gl, scene, camera, api])
  return null
}

function Zoom({ zoom }: { zoom: number }) {
  const { camera } = useThree()
  useEffect(() => { (camera as THREE.PerspectiveCamera).zoom = zoom; camera.updateProjectionMatrix() }, [zoom, camera])
  return null
}

class Boundary extends Component<{ children: ReactNode; onError: (m: string) => void; resetKey: string }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(e: Error) { this.props.onError(e.message) }
  componentDidUpdate(p: { resetKey: string }) { if (p.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false }) }
  render() { return this.state.failed ? null : this.props.children }
}

export const AvatarViewer = forwardRef<ViewerHandle, Props & { yawGoal: number; zoom: number; onYaw: (deg: number) => void }>(function AvatarViewer(p, ref) {
  const yaw = useRef({ cur: 0, goal: 0 })
  const drag = useRef<{ x: number; start: number } | null>(null)
  const glApi = useRef<(() => HTMLCanvasElement) | null>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => { yaw.current.goal = (p.yawGoal * Math.PI) / 180 }, [p.yawGoal])
  useEffect(() => { if (p.modelUrl) setLoading(true) }, [p.modelUrl])

  useImperativeHandle(ref, () => ({
    // Composite: background photo (same cover crop as on screen) + transparent WebGL layer.
    snapshot: async () => {
      const el = stage.current!, W = el.clientWidth, H = el.clientHeight
      const out = document.createElement('canvas'); out.width = W * 2; out.height = H * 2
      const ctx = out.getContext('2d')!; ctx.scale(2, 2)
      const bg = await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = p.destination.url })
      const s = Math.max(W / bg.width, H / bg.height), dw = bg.width * s, dh = bg.height * s
      const [fx, fy] = p.destination.focal
      ctx.drawImage(bg, (W - dw) * fx, (H - dh) * fy, dw, dh)
      const glc = glApi.current?.()
      if (glc && p.modelUrl) ctx.drawImage(glc, 0, 0, W, H)
      else if (p.fallbackImage) { const im = el.querySelector('.av-flat img') as HTMLImageElement | null; if (im) { const r = im.getBoundingClientRect(), o = el.getBoundingClientRect(); ctx.drawImage(im, r.left - o.left, r.top - o.top, r.width, r.height) } }
      return out.toDataURL('image/png')
    },
  }), [p.destination, p.modelUrl, p.fallbackImage])

  const L = p.destination.light, pl = p.placement
  return <div ref={stage} className="av-stage" style={{ backgroundImage: `url(${p.destination.url})`, backgroundPosition: `${p.destination.focal[0] * 100}% ${p.destination.focal[1] * 100}%` }}
    onPointerDown={e => { if (!p.modelUrl) return; drag.current = { x: e.clientX, start: yaw.current.goal }; (e.currentTarget as Element).setPointerCapture(e.pointerId) }}
    onPointerMove={e => { if (drag.current) { yaw.current.goal = drag.current.start + (e.clientX - drag.current.x) * 0.011; p.onYaw((yaw.current.goal * 180) / Math.PI) } }}
    onPointerUp={() => { drag.current = null }}>
    {p.modelUrl ? <Canvas shadows dpr={[1, 2]} camera={{ position: CAM.pos.toArray(), fov: CAM.fov, near: 0.05, far: 50 }} gl={{ alpha: true, preserveDrawingBuffer: true, antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
        onCreated={({ camera, gl }) => { camera.lookAt(CAM.target); gl.setClearColor(0x000000, 0) }}>
        <Zoom zoom={p.zoom} />
        <hemisphereLight args={['#dfe8ff', '#9c7b5c', L.ambient]} />
        <directionalLight position={L.dir} intensity={L.intensity} color={L.color} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-3} shadow-camera-right={3} shadow-camera-top={3} shadow-camera-bottom={-1} shadow-bias={-0.0005} />
        <Environment resolution={128} frames={1}>
          <Lightformer form="rect" intensity={1.4} color={L.color} position={[-4, 3, 3]} scale={[5, 3, 1]} />
          <Lightformer form="rect" intensity={0.7} color="#d7e3ff" position={[4, 4, -3]} scale={[8, 5, 1]} />
          <Lightformer form="rect" intensity={0.5} color="#f3e6d6" position={[0, 2, 6]} scale={[6, 4, 1]} />
        </Environment>
        <group position={[pl.x, pl.y, 0]} scale={pl.scale}>
          <Boundary resetKey={p.modelUrl} onError={m => { setLoading(false); p.onError?.(m) }}>
            <Suspense fallback={null}><Model url={p.modelUrl} yaw={yaw} /><Loaded onLoaded={() => setLoading(false)} /></Suspense>
          </Boundary>
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.001, 0]} receiveShadow><planeGeometry args={[6, 6]} /><shadowMaterial opacity={0.32} /></mesh>
          <ContactShadows position={[0, 0.002, 0]} opacity={0.6} scale={1.6} blur={2.2} far={0.8} resolution={512} />
        </group>
        <Snapshot api={glApi} />
      </Canvas>
      : p.fallbackImage ? <div className="av-flat" style={{ left: `${50 + pl.x * 8}%`, bottom: `${8 - pl.y * 10}%`, height: `${78 * pl.scale}%` }}><img src={p.fallbackImage} alt={p.fallbackLabel} /></div> : null}
    {loading && p.modelUrl && <div className="av-loading">Loading 3D model…</div>}
    {p.badge}
  </div>
})

function Loaded({ onLoaded }: { onLoaded: () => void }) { useEffect(() => { onLoaded() }, [onLoaded]); return null }
