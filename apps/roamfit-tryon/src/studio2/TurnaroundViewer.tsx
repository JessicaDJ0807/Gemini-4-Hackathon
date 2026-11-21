// Image-based turnaround viewer. Rotating = choosing among pre-generated views/frames; it is NOT a 3D model.
// The destination photo never moves; only the character frame changes. Shadows and tint are 2D compositing.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'

export type TurnaroundAsset = {
  id: string; avatarMode: 'stylized' | 'realistic'; outfitId: string
  frames: string[]; frameCount: number
  coverageDegrees: number | null; verifiedFullRotation: boolean
  method: 'video' | 'views' | 'still'
  views?: { label: string; angle: number; origin: string }[]   // for sparse view sets
}
export type Destination = { id: string; name: string; url: string; focal: [number, number]; ground: { x: number; y: number; height: number }; sun: 'left' | 'right'; tint: string }
export type Placement = { dx: number; dy: number; scale: number }
export type ViewerHandle = { snapshot: () => Promise<string>; setAngle: (deg: number) => void }

type Props = { asset: TurnaroundAsset | null; destination: Destination; placement: Placement; zoom: number; autoplay: boolean; focus: boolean
  onInteract?: () => void; onAngle?: (deg: number) => void; empty?: React.ReactNode; badge?: React.ReactNode }

const wrap = (d: number) => ((d % 360) + 360) % 360

export const TurnaroundViewer = forwardRef<ViewerHandle, Props>(function TurnaroundViewer(p, ref) {
  const [angle, setAngle] = useState(0)
  const [loaded, setLoaded] = useState(0)
  const drag = useRef<{ x: number; a: number } | null>(null)
  const stage = useRef<HTMLDivElement>(null)
  const figRef = useRef<HTMLImageElement>(null)
  const a = p.asset

  // Angle → frame. Sparse view sets snap to the nearest real view (with a short cross-fade); dense video frames map linearly.
  const angles = useMemo(() => a ? (a.views?.map(v => v.angle) ?? a.frames.map((_, i) => (i * 360) / a.frameCount)) : [], [a])
  const index = useMemo(() => {
    if (!a || !angles.length) return 0
    let best = 0, bd = 999
    angles.forEach((t, i) => { const d = Math.min(Math.abs(wrap(angle) - t), 360 - Math.abs(wrap(angle) - t)); if (d < bd) { bd = d; best = i } })
    return best
  }, [a, angles, angle])
  const sparse = !!a?.views

  useEffect(() => { setAngle(0); setLoaded(0) }, [a?.id])
  useEffect(() => { p.onAngle?.(wrap(angle)) }, [angle]) // eslint-disable-line react-hooks/exhaustive-deps
  // Preload every frame (≤ 48 small WebPs) so dragging never flashes.
  useEffect(() => {
    if (!a) return
    let n = 0; const imgs = a.frames.map(src => { const im = new Image(); im.onload = im.onerror = () => setLoaded(++n); im.src = src; return im })
    return () => { imgs.forEach(im => { im.onload = im.onerror = null }) }
  }, [a])
  // Autoplay: dense → continuous; sparse → step through real views. Stops as soon as the user interacts (parent flips the flag).
  useEffect(() => {
    if (!p.autoplay || !a || a.method === 'still') return
    const t = setInterval(() => setAngle(x => sparse ? angles[(angles.indexOf(angles[index]) + 1) % angles.length] : x + 360 / a.frameCount), sparse ? 1100 : 70)
    return () => clearInterval(t)
  }, [p.autoplay, a, sparse, angles, index])

  useImperativeHandle(ref, () => ({
    setAngle: d => setAngle(d),
    snapshot: async () => {
      const el = stage.current!, W = el.clientWidth, H = el.clientHeight, k = 2
      const c = document.createElement('canvas'); c.width = W * k; c.height = H * k
      const g = c.getContext('2d')!; g.scale(k, k)
      const load = (src: string) => new Promise<HTMLImageElement>((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = src })
      const bg = await load(p.destination.url)
      const s = Math.max(W / bg.width, H / bg.height), dw = bg.width * s, dh = bg.height * s
      if (p.focus) g.filter = 'blur(2px)'
      g.drawImage(bg, (W - dw) * p.destination.focal[0], (H - dh) * p.destination.focal[1], dw, dh); g.filter = 'none'
      const fig = figRef.current
      if (fig && a) {
        const r = fig.getBoundingClientRect(), o = el.getBoundingClientRect(), x = r.left - o.left, y = r.top - o.top
        g.save(); g.globalAlpha = 0.5; const grd = g.createRadialGradient(x + r.width / 2, y + r.height * 0.985, 1, x + r.width / 2, y + r.height * 0.985, r.width * 0.32)
        grd.addColorStop(0, 'rgba(30,20,10,0.55)'); grd.addColorStop(1, 'rgba(30,20,10,0)'); g.fillStyle = grd
        g.beginPath(); g.ellipse(x + r.width / 2, y + r.height * 0.985, r.width * 0.32, r.height * 0.025, 0, 0, Math.PI * 2); g.fill(); g.restore()
        g.filter = 'sepia(0.08) saturate(1.04)'; g.drawImage(await load(fig.currentSrc || fig.src), x, y, r.width, r.height); g.filter = 'none'
      }
      return c.toDataURL('image/png')
    },
  }), [a, p.destination, p.focus])

  const step = (d: number) => { p.onInteract?.(); setAngle(x => sparse ? angles[(index + (d > 0 ? 1 : -1) + angles.length) % angles.length] : x + d * (360 / (a?.frameCount || 36))) }
  const D = p.destination, pl = p.placement
  const figH = D.ground.height * pl.scale * p.zoom
  const frame = a?.frames[index]
  const prev = useRef(frame); const [fade, setFade] = useState<string | undefined>()
  useEffect(() => { if (sparse && prev.current && prev.current !== frame) { setFade(prev.current); const t = setTimeout(() => setFade(undefined), 220); prev.current = frame; return () => clearTimeout(t) } prev.current = frame }, [frame, sparse])

  return <div ref={stage} className={`tv-stage ${a && a.method !== 'still' ? 'draggable' : ''}`} tabIndex={0} role="application"
    aria-label={a ? `Turnaround viewer, ${Math.round(wrap(angle))} degrees. Use left and right arrow keys to rotate.` : 'Turnaround viewer'}
    onKeyDown={e => { if (!a || a.method === 'still') return; if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1) } if (e.key === 'ArrowRight') { e.preventDefault(); step(1) } }}
    onPointerDown={e => { if (!a || a.method === 'still') return; p.onInteract?.(); drag.current = { x: e.clientX, a: angle }; (e.currentTarget as Element).setPointerCapture(e.pointerId) }}
    onPointerMove={e => { if (!drag.current || !a) return; const dx = e.clientX - drag.current.x; setAngle(drag.current.a - dx * (sparse ? 0.55 : 0.75)) }}
    onPointerUp={() => { drag.current = null; if (sparse) setAngle(angles[index]) }} onPointerCancel={() => { drag.current = null }}>
    <div className={`tv-bg ${p.focus ? 'focus' : ''}`} style={{ backgroundImage: `url(${D.url})`, backgroundPosition: `${D.focal[0] * 100}% ${D.focal[1] * 100}%` }} />
    <div className="tv-grade" />
    {a && frame && <div className="tv-fig" style={{ left: `calc(${D.ground.x * 100}% + ${pl.dx}px)`, top: `calc(${D.ground.y * 100}% + ${pl.dy}px)`, height: `${figH * 100}%` }}>
      <div className="tv-contact" />
      <img className={`tv-cast ${D.sun}`} src={frame} alt="" aria-hidden draggable={false} />
      {fade && <img className="tv-img tv-fadeout" src={fade} alt="" aria-hidden draggable={false} />}
      <img ref={figRef} className="tv-img" src={frame} alt={a.views ? `${a.views[index]?.label} view` : `Turnaround frame ${index + 1} of ${a.frameCount}`} draggable={false} />
    </div>}
    {a && loaded < a.frames.length && <div className="tv-loading">Loading views {loaded}/{a.frames.length}</div>}
    {!a && p.empty}
    {p.badge}
  </div>
})
