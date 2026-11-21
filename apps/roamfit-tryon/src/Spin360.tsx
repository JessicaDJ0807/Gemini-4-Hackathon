// Drag-to-rotate "360 spin" built from frames of the generated turnaround video (product-spin technique).
// No geometry: each angle is a generated video frame, so side/back views are model-inferred.
import { useEffect, useRef, useState } from 'react'

type Props = { frameUrl: (i: number) => string; count: number; pxPerFrame?: number }

export function Spin360({ frameUrl, count, pxPerFrame = 8 }: Props) {
  const [index, setIndex] = useState(0)
  const [loaded, setLoaded] = useState(0)
  const [auto, setAuto] = useState(false)
  const images = useRef<HTMLImageElement[]>([])
  const drag = useRef<{ x: number; start: number } | null>(null)

  // Preload every frame so scrubbing never flashes.
  useEffect(() => {
    let done = 0
    images.current = Array.from({ length: count }, (_, i) => { const im = new Image(); im.onload = () => setLoaded(++done); im.src = frameUrl(i); return im })
  }, [count, frameUrl])

  useEffect(() => { if (!auto) return; const id = setInterval(() => setIndex(i => (i + 1) % count), 70); return () => clearInterval(id) }, [auto, count])

  const wrap = (i: number) => ((i % count) + count) % count
  const onDown = (e: React.PointerEvent) => { setAuto(false); drag.current = { x: e.clientX, start: index }; (e.currentTarget as Element).setPointerCapture(e.pointerId) }
  const onMove = (e: React.PointerEvent) => { if (drag.current) setIndex(wrap(drag.current.start + Math.round((e.clientX - drag.current.x) / pxPerFrame))) }
  const onUp = () => { drag.current = null }
  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'ArrowLeft') setIndex(i => wrap(i - 1)); if (e.key === 'ArrowRight') setIndex(i => wrap(i + 1)) }

  return <div className="spin" tabIndex={0} onKeyDown={onKey} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} aria-label="Drag left or right to rotate">
    <img src={frameUrl(index)} alt={`Turnaround frame ${index + 1} of ${count}`} draggable={false} />
    {loaded < count && <div className="spin-loading">Loading frames {loaded}/{count}</div>}
    <div className="spin-hud">
      <button onPointerDown={e => e.stopPropagation()} onClick={() => setAuto(a => !a)}>{auto ? 'Stop' : 'Auto-spin'}</button>
      <input type="range" min={0} max={count - 1} value={index} onPointerDown={e => e.stopPropagation()} onChange={e => { setAuto(false); setIndex(Number(e.target.value)) }} aria-label="Rotation" />
    </div>
  </div>
}
