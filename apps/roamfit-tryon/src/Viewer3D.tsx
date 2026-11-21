// Interactive 3D preview: a reconstructed (SAM 3D) person GLB standing in front of a destination photo.
// The camera is fixed (the backdrop is a single 2D photo); dragging spins the PERSON in place, which is the
// only honest 360 we can offer with one background photo. Unseen sides of the person are model-inferred.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { ContactShadows, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { Spin360 } from './Spin360'

const SPIN_COUNT = 72
const spinFrame = (i: number) => `/demo/spin/f_${String(i + 1).padStart(3, '0')}.jpg`

type Props = { glbUrl: string; backdropUrl: string; fallbackVideoUrl?: string }

function Person({ url, yaw, fixRotX }: { url: string; yaw: React.MutableRefObject<number>; fixRotX: number }) {
  const { scene } = useGLTF(url)
  const group = useRef<THREE.Group>(null)
  // Normalise: unknown source scale/orientation → 1.70 m tall, feet on y=0, centred on x/z.
  const model = useMemo(() => {
    const root = scene.clone(true)
    root.rotation.x = fixRotX
    root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3())
    const s = 1.7 / (size.y || 1)
    const wrap = new THREE.Group()
    root.position.set(-centre.x, -box.min.y, -centre.z)
    wrap.add(root); wrap.scale.setScalar(s)
    wrap.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true } })
    return wrap
  }, [scene, fixRotX])
  useFrame(() => { if (group.current) group.current.rotation.y += (yaw.current - group.current.rotation.y) * 0.18 })
  return <group ref={group}><primitive object={model} /></group>
}

export function Viewer3D({ glbUrl, backdropUrl, fallbackVideoUrl }: Props) {
  const yaw = useRef(0)
  const drag = useRef<{ x: number; yaw: number } | null>(null)
  const [mode, setMode] = useState<'spin' | '3d' | 'video'>('spin')
  const [spin, setSpin] = useState(false)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [fixRotX, setFixRotX] = useState(0)

  useEffect(() => { fetch(glbUrl, { method: 'HEAD' }).then(r => setAvailable(r.ok && !/text\/html/.test(r.headers.get('content-type') || ''))).catch(() => setAvailable(false)) }, [glbUrl])
  useEffect(() => { if (!spin) return; const id = setInterval(() => { yaw.current += 0.03 }, 16); return () => clearInterval(id) }, [spin])

  const onDown = (e: React.PointerEvent) => { drag.current = { x: e.clientX, yaw: yaw.current }; (e.target as Element).setPointerCapture(e.pointerId); setSpin(false) }
  const onMove = (e: React.PointerEvent) => { if (drag.current) yaw.current = drag.current.yaw + (e.clientX - drag.current.x) * 0.012 }
  const onUp = () => { drag.current = null }
  const face = (deg: number) => { setSpin(false); const target = (deg * Math.PI) / 180; const turns = Math.round((yaw.current - target) / (2 * Math.PI)); yaw.current = target + turns * 2 * Math.PI }

  return <div className="v3d">
    <div className={`v3d-stage ${mode !== '3d' ? 'flat' : ''}`} style={mode === '3d' ? { backgroundImage: `url(${backdropUrl})` } : undefined} onPointerDown={mode === '3d' ? onDown : undefined} onPointerMove={mode === '3d' ? onMove : undefined} onPointerUp={onUp} onPointerLeave={onUp}>
      {mode === 'spin'
        ? <Spin360 frameUrl={spinFrame} count={SPIN_COUNT} />
        : mode === 'video' && fallbackVideoUrl
        ? <video src={fallbackVideoUrl} autoPlay loop muted playsInline controls className="v3d-video" />
        : available === false
          ? <div className="v3d-empty">No 3D asset yet at <code>{glbUrl}</code>. Run the SAM 3D step, or use the turnaround video.</div>
          : <Canvas shadows camera={{ position: [0, 0.55, 4.2], fov: 30 }} gl={{ alpha: true, antialias: true }} onCreated={({ camera }) => camera.lookAt(0, 0.95, 0)}>
              {/* Scene light matched to the Montréal photo: low warm sun from upper-left, cool sky fill. */}
              <hemisphereLight args={['#bcd4ff', '#8a6a4a', 0.9]} />
              <directionalLight position={[-3, 4, 2.5]} intensity={2.6} color="#ffe2b8" castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-2} shadow-camera-right={2} shadow-camera-top={3} shadow-camera-bottom={-1} />
              <mesh rotation-x={-Math.PI / 2} receiveShadow><planeGeometry args={[10, 10]} /><shadowMaterial opacity={0.38} /></mesh>
              <ContactShadows position={[0, 0.002, 0]} opacity={0.55} scale={2.2} blur={2.2} far={1} />
              <Suspense fallback={null}><Person url={glbUrl} yaw={yaw} fixRotX={fixRotX} /></Suspense>
            </Canvas>}
    </div>
    <div className="v3d-bar">
      <div className="v3d-group">
        <button className={mode === 'spin' ? 'on' : ''} onClick={() => setMode('spin')}>360 spin (drag)</button>
        <button className={mode === '3d' ? 'on' : ''} onClick={() => setMode('3d')}>3D model{available === false ? ' (not generated)' : ''}</button>
        {fallbackVideoUrl && <button className={mode === 'video' ? 'on' : ''} onClick={() => setMode('video')}>Turnaround video</button>}
      </div>
      {mode === '3d' && <div className="v3d-group">
        <button onClick={() => face(0)}>Front</button><button onClick={() => face(90)}>Side</button><button onClick={() => face(180)}>Back</button>
        <button className={spin ? 'on' : ''} onClick={() => setSpin(s => !s)}>{spin ? 'Stop' : 'Auto-spin'}</button>
        <button title="Fix model orientation if it imports lying down" onClick={() => setFixRotX(r => r - Math.PI / 2)}>↻ upright</button>
      </div>}
    </div>
    <p className="v3d-truth">Made from one front photo: in every mode the sides and back are AI-inferred, not scanned. The 360 spin is frames of a generated video, not a 3D model. The background is a single 2D photo, so the person turns in place and the camera stays fixed. This is a visual preview only, not a size or fit guarantee.</p>
  </div>
}
