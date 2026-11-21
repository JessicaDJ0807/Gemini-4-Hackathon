// Shows one full-scene try-on result: the still photo, drag-to-rotate over plain video frames, or the original video.
// Frames are untouched video frames (no cut-outs). It is an AI video preview, not a 3D model.
import { useEffect, useRef, useState } from 'react'

export type SceneView = 'photo' | 'rotate' | 'video'
type Props = { still?: string; frames?: string[]; video?: string; view: SceneView; busy?: string; empty?: React.ReactNode; badge?: React.ReactNode }

export function SceneViewer({ still, frames = [], video, view, busy, empty, badge }: Props) {
  const [i, setI] = useState(0)
  const [loaded, setLoaded] = useState(0)
  const drag = useRef<{ x: number; i: number } | null>(null)
  const n = frames.length
  useEffect(() => { setI(0); setLoaded(0); if (!n) return
    let c = 0; const ims = frames.map(src => { const im = new Image(); im.onload = im.onerror = () => setLoaded(++c); im.src = src; return im })
    return () => ims.forEach(im => { im.onload = im.onerror = null }) }, [frames]) // eslint-disable-line react-hooks/exhaustive-deps
  const wrap = (k: number) => ((k % n) + n) % n

  const showRotate = view === 'rotate' && n > 0, showVideo = view === 'video' && !!video
  const src = showRotate ? frames[wrap(i)] : still
  return <div className={`sv-stage ${showRotate ? 'draggable' : ''}`} tabIndex={0} role="application"
    aria-label={showRotate ? `Rotating preview, frame ${wrap(i) + 1} of ${n}. Drag or use arrow keys.` : 'Try-on preview'}
    onKeyDown={e => { if (!showRotate) return; if (e.key === 'ArrowLeft') { e.preventDefault(); setI(x => x - 1) } if (e.key === 'ArrowRight') { e.preventDefault(); setI(x => x + 1) } }}
    onPointerDown={e => { if (!showRotate) return; drag.current = { x: e.clientX, i }; e.currentTarget.setPointerCapture(e.pointerId) }}
    onPointerMove={e => { if (drag.current) setI(drag.current.i + Math.round((e.clientX - drag.current.x) / 9)) }}
    onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
    {(src || showVideo) && <div className="sv-fill" style={{ backgroundImage: `url(${still ?? src})` }} />}
    {showVideo ? <video key={video} className="sv-media" src={video} poster={still} controls autoPlay loop muted playsInline />
      : src ? <img className="sv-media" src={src} alt={showRotate ? `Rotating preview frame ${wrap(i) + 1}` : 'Generated try-on photo'} draggable={false} /> : empty}
    {showRotate && <div className="sv-scrub" onPointerDown={e => e.stopPropagation()}>
      <span>◀ drag to turn ▶</span>
      <input type="range" min={0} max={n - 1} value={wrap(i)} onChange={e => setI(Number(e.target.value))} aria-label="Frame" />
      <small>{wrap(i) + 1}/{n}</small></div>}
    {showRotate && loaded < n && <div className="sv-pill">Loading frames {loaded}/{n}</div>}
    {busy && <div className="sv-busy"><i />{busy}</div>}
    {badge}
  </div>
}
