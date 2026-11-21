import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TurnaroundViewer, type Destination, type TurnaroundAsset, type ViewerHandle } from './TurnaroundViewer'
import './studio2.css'

type Mode = 'little-self' | 'real-me'
type Method = 'text' | 'photo'
type Turn = { base: string; frameCount: number; views?: { label: string; angle: number; origin: string }[]; verified?: boolean; checks?: Record<string, unknown>; qa?: { rotation?: string; verdict?: string }; createdAt: string }
type Asset = { key: string; mode: Mode; outfitId: string; outfitName: string; approved: boolean
  source?: { url: string; qa?: { verdict?: string }; createdAt: string; input?: Method; notes?: string[] }
  turnaround: { views?: Turn; video?: Turn }; trace: { role: string; model: string; generation?: string; latencyMs?: number }[] }
type Caps = { gemini: boolean; outfits: { id: string; name: string; label: string }[]; video: { model: string; seconds: number; costEstimateUsd: number; note: string } }
type Job = { id: string; kind: string; key: string; status: 'running' | 'done' | 'failed'; step: string; error?: { message: string } }

const DESTINATIONS: Destination[] = [
  { id: 'montreal', name: 'Old Montréal', url: '/demo/montreal.jpg', focal: [0.5, 0.86], ground: { x: 0.42, y: 0.935, height: 0.6 }, sun: 'left', tint: '#ffd9ad' },
]
const THUMBS: Record<string, string[]> = {
  stroll: ['/media/garment_white_squareneck_tee.png', '/media/garment_gingham_flare_trousers.png'],
  layered: ['/media/garment_black_cropped_cardigan.png', '/media/garment_white_squareneck_tee.png', '/media/garment_gingham_flare_trousers.png'],
}
const COPY: Record<Mode, { title: string; sub: string; still: string }> = {
  'little-self': { title: 'My Little Self', sub: 'Cozy clay mini-me', still: 'character' },
  'real-me': { title: 'Real Me', sub: 'Photo-based preview', still: 'try-on photo' },
}
const api = async <T,>(url: string, init?: RequestInit): Promise<T> => { const r = await fetch(url, init); const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.error || `HTTP ${r.status}`); return b }
const post = <T,>(url: string, body: unknown) => api<T>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const toDataUrl = (f: File) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = no; r.readAsDataURL(f) })

export default function TurnaroundStudio() {
  const [mode, setMode] = useState<Mode>('little-self')
  const [method, setMethod] = useState<Method>('text')
  const [desc, setDesc] = useState('')
  const [personId, setPersonId] = useState<string | null>(null)
  const [personPreview, setPersonPreview] = useState<string | null>(null)
  const [garments, setGarments] = useState<{ outfitId: string; preview: string }[]>([])
  const [outfitId, setOutfitId] = useState('stroll')
  const [caps, setCaps] = useState<Caps | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [consent, setConsent] = useState(false)
  const [consentViews, setConsentViews] = useState(false)
  const [authorizeVideo, setAuthorizeVideo] = useState(false)
  const [error, setError] = useState('')
  const [autoplay, setAutoplay] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [placement, setPlacement] = useState({ dx: 0, dy: 0, scale: 1 })
  const [focus, setFocus] = useState(true)
  const [angle, setAngle] = useState(0)
  const [shot, setShot] = useState<string | null>(null)
  const [showTrace, setShowTrace] = useState(false)
  const [destId, setDestId] = useState('montreal')
  const viewer = useRef<ViewerHandle>(null)
  const dest = DESTINATIONS.find(d => d.id === destId)!

  const refresh = useCallback(() => api<Asset[]>('/api/studio/assets').then(setAssets).catch(e => setError(`API: ${e.message}`)), [])
  useEffect(() => { api<Caps>('/api/studio/capabilities').then(setCaps).catch(e => setError(`API not reachable (${e.message}). Restart npm run dev.`)); refresh() }, [refresh])
  useEffect(() => {
    if (!jobs.some(j => j.status === 'running')) return
    const t = setInterval(async () => {
      const next = await Promise.all(jobs.map(j => j.status === 'running' ? api<Job>(`/api/studio/jobs/${j.id}`).catch(() => j) : j))
      if (next.some((j, i) => j.status !== jobs[i].status || j.step !== jobs[i].step)) { setJobs(next); refresh() }
    }, 1500)
    return () => clearInterval(t)
  }, [jobs, refresh])

  const realMe = mode === 'real-me'
  const textOnly = !realMe && method === 'text'
  const profile = textOnly ? 'described' : personId ? personId.replace(/\..*$/, '') : 'demo'
  const keyFor = (o: string) => `${profile}__${mode}__${o}`
  const key = keyFor(outfitId)
  const entry = assets.find(a => a.key === key)
  const job = [...jobs].reverse().find(j => j.key === key)
  const running = job?.status === 'running' ? job : undefined

  const asset: TurnaroundAsset | null = useMemo(() => {
    const t = entry?.turnaround; if (!t) return null
    const am = mode === 'little-self' ? 'stylized' : 'realistic'
    const frames = (tt: Turn) => Array.from({ length: tt.frameCount }, (_, i) => `${tt.base}${String(i).padStart(3, '0')}.webp?v=${encodeURIComponent(tt.createdAt)}`)
    if (t.video?.verified) return { id: `${key}:video:${t.video.createdAt}`, avatarMode: am, outfitId, frames: frames(t.video), frameCount: t.video.frameCount, coverageDegrees: 360, verifiedFullRotation: true, method: 'video' }
    if (t.views) return { id: `${key}:views:${t.views.createdAt}`, avatarMode: am, outfitId, frames: frames(t.views), frameCount: t.views.frameCount, coverageDegrees: null, verifiedFullRotation: false, method: 'views', views: t.views.views }
    return null
  }, [entry, key, mode, outfitId])

  const state = running ? (running.kind === 'source' ? 'generating-image' : running.step.startsWith('local') ? (running.kind === 'turnaround-video' ? 'validating' : 'extracting-frames') : running.kind === 'turnaround-video' ? 'generating-video' : 'generating-views')
    : !entry?.source ? 'idle' : !entry.approved ? 'awaiting-approval' : asset ? 'ready' : 'approved'
  const stateText: Record<string, string> = { idle: 'No look yet', 'awaiting-approval': 'Awaiting your approval', approved: 'Approved: ready for a turnaround', ready: asset?.method === 'video' ? 'Verified 360° turntable' : `${asset?.frameCount ?? 0}-view turnaround` }

  const run = async (url: string, body: Record<string, unknown>) => { setError(''); try { const j = await post<Job>(url, body); setJobs(js => [...js, j]) } catch (e) { setError((e as Error).message) } }
  const generate = () => run('/api/studio/source', { mode, outfitId, consent, description: desc, input: textOnly ? 'text' : 'photo', personId })
  const upload = async (kind: 'person' | 'garment', f?: File) => {
    if (!f) return; setError('')
    try {
      const dataUrl = await toDataUrl(f)
      const r = await post<{ id: string; outfitId?: string }>('/api/studio/upload', { kind, dataUrl })
      if (kind === 'person') { setPersonId(r.id); setPersonPreview(dataUrl) } else { setGarments(g => [...g, { outfitId: r.outfitId!, preview: dataUrl }]); setOutfitId(r.outfitId!) }
    } catch (e) { setError((e as Error).message) }
  }
  const approve = async (ok: boolean) => { await post('/api/studio/approve', { key, approved: ok }).catch(e => setError(e.message)); refresh() }
  const presets: { label: string; angle: number; origin?: string }[] = asset?.views ?? (asset?.verifiedFullRotation ? [{ label: 'front', angle: 0 }, { label: 'left', angle: 90 }, { label: 'back', angle: 180 }, { label: 'right', angle: 270 }] : [])
  const outfits = [...(caps?.outfits ?? []), ...garments.map(g => ({ id: g.outfitId, name: 'Your garment', label: 'Uploaded garment photo' }))]

  return <div className="s2">
    <header className="s2-head">
      <div className="s2-brand">ROAM<span>FIT</span></div>
      <div className="s2-modes" role="tablist">{(Object.keys(COPY) as Mode[]).map(m => <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}><strong>{COPY[m].title}</strong><small>{COPY[m].sub}</small></button>)}</div>
      <p className="s2-tag">See your little self, dressed for wherever you're going.</p>
      <label className="s2-dest">Destination <select value={destId} onChange={e => setDestId(e.target.value)}>{DESTINATIONS.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <div className={`s2-status st-${state}`}><i />{running ? running.step : stateText[state]}</div>
    </header>

    <aside className="s2-left">
      <section>
        <h4>1 · Create {realMe ? 'your try-on' : 'your character'}</h4>
        {!realMe && <div className="s2-input" role="tablist">{([['text', 'Describe myself'], ['photo', 'Upload my photo']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={method === k} className={method === k ? 'on' : ''} onClick={() => setMethod(k)}>{l}</button>)}</div>}
        {(realMe || method === 'photo') && <div className="s2-upload">
          {personPreview ? <img src={personPreview} alt="Your photo" /> : <div className="s2-ph">Demo<br />photo</div>}
          <div><b>{personId ? 'Your photo' : 'Using the demo photo'}</b><small>{realMe ? 'Full body, front-facing works best.' : 'Your photo is the main reference; your notes fill in details.'}</small>
            <label className="s2-filebtn">Upload photo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => upload('person', e.target.files?.[0])} /></label>
            {personId && <button className="s2-mini" onClick={async () => { await api(`/api/studio/upload/${personId}`, { method: 'DELETE' }); setPersonId(null); setPersonPreview(null) }}>Remove</button>}</div>
        </div>}
        <label className="s2-label">{textOnly ? 'Describe yourself' : 'Notes'} <small>{textOnly ? '(required, no photo is used)' : '(optional)'}</small></label>
        <textarea value={desc} maxLength={500} onChange={e => setDesc(e.target.value)} rows={textOnly ? 4 : 2}
          placeholder={textOnly ? 'e.g. shoulder-length black hair, round glasses, freckles, cozy minimal style' : realMe ? 'e.g. prefers trousers at full length' : 'e.g. I usually wear small gold hoops'} />
        {!realMe && <div className="s2-style"><img src="/media/style_cozy_clay_traveler.png" alt="Style reference" /><div><b>Cozy Clay Traveler</b><small>Your style reference image. Every Little Self is drawn in this style.</small></div></div>}
        <label className="s2-check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> Send my {textOnly ? 'description' : 'photo'} and the garment images to Google Gemini API</label>
        <button className="s2-btn" disabled={!caps?.gemini || !consent || !!running || (textOnly && desc.trim().length < 3)} onClick={generate}>{entry?.source ? 'Regenerate' : 'Generate'} {COPY[mode].still}</button>
      </section>

      {entry?.source && <section className={`s2-approve ${entry.approved ? 'ok' : ''}`}>
        <h4>2 · Approve</h4>
        <div className="s2-src"><img src={entry.source.url} alt="Generated 2D" /><div>
          <b>{entry.approved ? 'Approved ✓' : 'Check this image'}</b>
          <small>{entry.source.input === 'text' ? 'From your description' : 'From your photo'} · Gemini 4 QA: {entry.source.qa?.verdict ?? 'n/a'}</small>
          {!entry.approved ? <div className="s2-row"><button className="s2-mini on" onClick={() => approve(true)}>Approve</button><button className="s2-mini" disabled={!consent || !!running} onClick={generate}>Regenerate</button></div>
            : <button className="s2-mini" onClick={() => approve(false)}>Back to editing</button>}
        </div></div>
        {!!entry.source.notes?.length && <ul className="s2-notes">{entry.source.notes.map(n => <li key={n}>{n}</li>)}</ul>}
      </section>}

      {entry?.approved && <section>
        <h4>3 · Turnaround</h4>
        <div className="s2-free"><b>Multi-view turnaround</b>
          <p className="s2-fine">Gemini draws a matching side view and back view, then this computer cuts out and aligns them. You get 4 real views; the 4th is a mirrored side and is labelled as such. Costs only two image generations.</p>
          <label className="s2-check"><input type="checkbox" checked={consentViews} onChange={e => setConsentViews(e.target.checked)} /> Send the approved {COPY[mode].still} to Google Gemini API</label>
          <button className="s2-btn" disabled={!consentViews || !!running} onClick={() => run('/api/studio/turnaround', { key, method: 'views', consent: consentViews })}>{entry.turnaround.views ? 'Rebuild' : 'Build'} 4-view turnaround</button></div>
        <div className="s2-free paid"><b>AI turntable video <em>paid</em></b>
          <p className="s2-fine">{caps?.video.model} makes a {caps?.video.seconds}s spin video (about <b>${caps?.video.costEstimateUsd}</b> per attempt, never retried automatically). It's checked locally and by Gemini 4; anything that isn't one clean full turn is rejected. {caps?.video.note}</p>
          <label className="s2-check"><input type="checkbox" checked={authorizeVideo} onChange={e => setAuthorizeVideo(e.target.checked)} /> I authorise one charge of about ${caps?.video.costEstimateUsd}</label>
          <button className="s2-btn" disabled={!authorizeVideo || !!running} onClick={() => { setAuthorizeVideo(false); run('/api/studio/turnaround', { key, method: 'video', authorizeCost: true }) }}>Generate turntable video</button>
          {entry.turnaround.video && <p className={entry.turnaround.video.verified ? 's2-ok' : 's2-err'}>{entry.turnaround.video.verified ? 'Accepted: verified full rotation.' : `Rejected: rotation ${entry.turnaround.video.qa?.rotation ?? '?'}. Checks: ${JSON.stringify(entry.turnaround.video.checks)}`}</p>}
        </div>
      </section>}
      {(error || job?.error) && <p className="s2-err">{error || job?.error?.message}</p>}
    </aside>

    <main className="s2-center">
      <TurnaroundViewer ref={viewer} asset={asset} destination={dest} placement={placement} zoom={zoom} autoplay={autoplay} focus={focus}
        onInteract={() => setAutoplay(false)} onAngle={setAngle}
        empty={entry?.source ? <div className="s2-polaroid"><img src={entry.source.url} alt="2D preview" /><span>2D {COPY[mode].still}: {entry.approved ? 'build a turnaround to rotate it' : 'approve it to continue'}</span></div>
          : <div className="s2-empty"><strong>{COPY[mode].title}</strong><span>{realMe ? 'Upload your photo, pick an outfit and generate a try-on.' : 'Describe yourself or upload a photo to begin.'}</span></div>}
        badge={asset && <div className={`s2-cov ${asset.verifiedFullRotation ? 'ok' : ''}`}>{asset.method === 'video' ? `Verified 360° · ${asset.frameCount} frames from AI video` : `${asset.views?.filter(v => v.origin === 'generated').length} AI views + ${asset.views?.filter(v => v.origin !== 'generated').length} mirrored · not continuous 360°`}</div>} />
      <div className="s2-place"><span>DESTINATION · REAL PHOTO</span><strong>{dest.name}</strong><small>The background stays still; only the character turns. Image-based preview, not 3D.</small></div>
      <div className="s2-hud">
        <div className="s2-seg">{presets.map(v => <button key={v.angle} className={Math.round(angle) % 360 === v.angle ? 'on' : ''} onClick={() => { setAutoplay(false); viewer.current?.setAngle(v.angle) }} title={v.origin && v.origin !== 'generated' ? v.origin : ''}>{v.label.replace(' profile', '')}{v.origin && v.origin !== 'generated' ? '*' : ''}</button>)}</div>
        <button disabled={!asset} className={autoplay ? 'on' : ''} onClick={() => setAutoplay(a => !a)}>{autoplay ? 'Pause' : 'Play'}</button>
        <label>Zoom <input type="range" min={0.8} max={1.5} step={0.02} value={zoom} onChange={e => setZoom(Number(e.target.value))} /></label>
        <label>Size <input type="range" min={0.6} max={1.4} step={0.01} value={placement.scale} onChange={e => setPlacement(p => ({ ...p, scale: Number(e.target.value) }))} /></label>
        <label>Move <input type="range" min={-400} max={400} step={2} value={placement.dx} onChange={e => setPlacement(p => ({ ...p, dx: Number(e.target.value) }))} /></label>
        <button className={focus ? 'on' : ''} onClick={() => setFocus(f => !f)} title="Soft background blur">Focus</button>
        <button onClick={() => { viewer.current?.setAngle(0); setZoom(1); setPlacement({ dx: 0, dy: 0, scale: 1 }); setAutoplay(false) }}>Reset</button>
        <button className="s2-cta" onClick={async () => setShot(await viewer.current!.snapshot())}>Save postcard</button>
      </div>
      {shot && <div className="s2-shot" onClick={() => setShot(null)}><figure onClick={e => e.stopPropagation()}><img src={shot} alt="Postcard" /><figcaption>AI-generated {asset ? (asset.method === 'video' ? 'turntable frame' : 'view') : '2D image'} composited on a real photo. Illustrative, not a fit guarantee. <a href={shot} download="roamfit-postcard.png">Download</a> · <button onClick={() => setShot(null)}>Close</button></figcaption></figure></div>}
    </main>

    <aside className="s2-right">
      <h3>Outfits</h3>
      {outfits.map(o => {
        const e = assets.find(a => a.key === keyFor(o.id))
        const st = e?.turnaround.video?.verified ? '360° ready' : e?.turnaround.views ? 'turnaround' : e?.approved ? 'approved' : e?.source ? '2D only' : 'new'
        return <button key={o.id} className={`s2-outfit ${outfitId === o.id ? 'on' : ''}`} onClick={() => setOutfitId(o.id)}>
          <div className="s2-thumbs">{(THUMBS[o.id] ?? [garments.find(g => g.outfitId === o.id)?.preview ?? '']).map(t => <img key={t} src={t} alt="" />)}</div>
          <strong>{o.name}</strong><small>{o.label}</small><em className={`st-${st.replace(/[^a-z0-9]+/gi, '-')}`}>{st}</em></button>
      })}
      <label className="s2-filebtn wide">+ Upload a garment photo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => upload('garment', e.target.files?.[0])} /></label>
      <p className="s2-fine">Each outfit has its own cached turnaround. Switching to a generated outfit is instant; a new outfit has to be generated first. This is not cloth simulation, and changing the destination never regenerates anything.</p>
      <h4>Shop the look</h4>
      <div className="s2-disabled"><input placeholder="Paste a product URL" disabled /><small>Product import and Shopify recommendations are not connected (no store credentials).</small></div>
      <button className="s2-link" onClick={() => setShowTrace(s => !s)}>{showTrace ? 'Hide' : 'Show'} how this look was made</button>
      {showTrace && <div className="s2-trace">{entry?.trace.length ? entry.trace.map((t, i) => <div key={i}><b>{t.role}</b><span>{t.model}{t.generation ? ` · ${t.generation}` : ''}{t.latencyMs ? ` · ${(t.latencyMs / 1000).toFixed(1)}s` : ''}</span></div>) : <small>No generation recorded for this look.</small>}</div>}
    </aside>
  </div>
}
