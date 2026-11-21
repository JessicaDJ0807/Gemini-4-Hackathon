import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AvatarViewer, type Destination, type ViewerHandle } from './AvatarViewer'
import './studio2.css'

type Mode = 'little-self' | 'real-me'
type Asset = { key: string; mode: Mode; outfitId: string; outfitName: string; source?: { url: string; qa?: Record<string, unknown> & { verdict?: string }; createdAt: string; live: boolean; input?: 'photo' | 'text'; description?: string; notes?: string[]; defaults?: string[] }; models: Record<string, { url: string; model: string; label: string; latencyMs: number; createdAt: string; note?: string }>; trace: { role: string; model: string; generation?: string; latencyMs?: number }[] }
type Caps = { gemini: boolean; fal: boolean; outfits: { id: string; name: string; label: string }[]; providers: { id: string; label: string; endpoint: string }[]; defaults: Record<Mode, string> }
type Job = { id: string; kind: string; key: string; status: 'running' | 'done' | 'failed'; step: string; error?: { message: string } }

const DESTINATIONS: Destination[] = [
  { id: 'montreal', name: 'Old Montréal', url: '/demo/montreal.jpg', focal: [0.56, 0.9], light: { dir: [-4, 5, 3], color: '#ffd9ad', intensity: 2.6, ambient: 0.9 }, ground: { x: 0, y: 0, scale: 1 } },
]
const GARMENT_THUMBS: Record<string, string[]> = {
  stroll: ['/media/garment_white_squareneck_tee.png', '/media/garment_gingham_flare_trousers.png'],
  layered: ['/media/garment_black_cropped_cardigan.png', '/media/garment_white_squareneck_tee.png', '/media/garment_gingham_flare_trousers.png'],
}
const MODE_COPY: Record<Mode, { title: string; sub: string; source: string; provider: string }> = {
  'little-self': { title: 'My Little Self', sub: 'Your cozy clay mini-me', source: 'Character concept', provider: 'Tripo H3.1' },
  'real-me': { title: 'Real Me', sub: 'Photo-based 3D preview', source: 'Try-on photo', provider: 'Hunyuan3D 3.1 Pro' },
}
const DEFAULT_PLACEMENT = { x: 0.35, y: 0, scale: 0.62 }
const fixture = new URLSearchParams(location.hash.split('?')[1] || '').has('fixture')

const api = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const r = await fetch(url, init); const b = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(b.error || `HTTP ${r.status}`); return b
}

export default function TwoModeStudio() {
  const [mode, setMode] = useState<Mode>('little-self')
  const [outfitId, setOutfitId] = useState('stroll')
  const [caps, setCaps] = useState<Caps | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [consentG, setConsentG] = useState(false)
  const [consentF, setConsentF] = useState(false)
  const [consentL, setConsentL] = useState(false)
  const [desc, setDesc] = useState('')
  const [input, setInput] = useState<'photo' | 'text'>('photo')
  const [yaw, setYaw] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [placement, setPlacement] = useState(DEFAULT_PLACEMENT)
  const [error, setError] = useState('')
  const [shot, setShot] = useState<string | null>(null)
  const [showTrace, setShowTrace] = useState(false)
  const viewer = useRef<ViewerHandle>(null)
  const dest = DESTINATIONS[0]

  const refresh = useCallback(() => api<Asset[]>('/api/studio/assets').then(setAssets).catch(e => setError(`Assets: ${e.message}`)), [])
  useEffect(() => { api<Caps>('/api/studio/capabilities').then(setCaps).catch(e => setError(`API not reachable: ${e.message}. Start it with npm run dev.`)); refresh() }, [refresh])
  // poll running jobs
  useEffect(() => {
    if (!jobs.some(j => j.status === 'running')) return
    const t = setInterval(async () => {
      const next = await Promise.all(jobs.map(j => j.status === 'running' ? api<Job>(`/api/studio/jobs/${j.id}`).catch(() => j) : j))
      setJobs(next)
      if (next.some((j, i) => j.status !== jobs[i].status)) refresh()
    }, 1500)
    return () => clearInterval(t)
  }, [jobs, refresh])

  const profileOf = (m: Mode) => (m === 'little-self' && input === 'text' ? 'described' : 'demo')
  const key = `${profileOf(mode)}__${mode}__${outfitId}`
  const entry = assets.find(a => a.key === key)
  const modelEntry = entry && (entry.models[caps?.defaults[mode] ?? ''] || Object.values(entry.models)[0])
  const modelUrl = fixture ? '/fixtures/CesiumMan.glb' : modelEntry?.url ?? null
  const activeJob = jobs.find(j => j.key === key && j.status === 'running')
  const lastJob = [...jobs].reverse().find(j => j.key === key)
  const outfit = caps?.outfits.find(o => o.id === outfitId)
  const textMode = mode === 'little-self' && input === 'text'

  const run = async (kind: 'source' | 'model3d', provider?: string) => {
    setError('')
    try { const j = await api<Job>(`/api/studio/${kind}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode, outfitId, provider, consent: kind === 'source' ? consentG : provider === 'local-relief' ? consentL : consentF, description: desc, input: textMode ? 'text' : 'photo' }) }); setJobs(js => [...js, j]) }
    catch (e) { setError((e as Error).message) }
  }
  const status = useMemo(() => {
    if (fixture) return { tone: 'warn', text: 'Viewer test fixture: Khronos CesiumMan (CC-BY 4.0). This is not your avatar.' }
    if (activeJob) return { tone: 'busy', text: `Generating… ${activeJob.step}` }
    if (modelEntry) return { tone: 'ok', text: `Live 3D · ${modelEntry.label}` }
    if (entry?.source) return { tone: 'warn', text: `2D ${MODE_COPY[mode].source.toLowerCase()} only: 3D not generated yet` }
    return { tone: 'idle', text: 'Nothing generated for this look yet' }
  }, [activeJob, modelEntry, entry, mode])

  return <div className="s2">
    <header className="s2-head">
      <div className="s2-brand">ROAM<span>FIT</span></div>
      <p className="s2-tag">See your little self, dressed for wherever you're going.</p>
      <div className="s2-modes" role="tablist">{(Object.keys(MODE_COPY) as Mode[]).map(m => <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => { setMode(m); setYaw(0) }}><strong>{MODE_COPY[m].title}</strong><small>{MODE_COPY[m].sub}</small></button>)}</div>
      <div className={`s2-status ${status.tone}`}><i />{status.text}</div>
    </header>

    <aside className="s2-left">
      <section>
        <h4>You</h4>
        {mode === 'little-self' && <div className="s2-input" role="tablist">{([['photo', 'Use my photo'], ['text', 'Describe in words']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={input === k} className={input === k ? 'on' : ''} onClick={() => setInput(k)}>{l}</button>)}</div>}
        {textMode
          ? <p className="s2-fine">No photo needed: your photo is not sent anywhere. Gemini 4 turns your words into hair, accessory and build settings. Anything you leave out gets a neutral default, and the generation record lists which defaults were used.</p>
          : <><p className="s2-fine">Your photo is the main reference. Anything you write only fills in details the photo does not show. If your text conflicts with the photo, the photo wins and the conflict is noted.</p><div className="s2-you"><div className="s2-avatar-dot">Demo<br />photo</div><div><b>Demo person photo</b><small>assets/figure_test.png · front, full body</small></div></div></>}
        <label className="s2-label">Describe yourself <small>{textMode ? '(required)' : '(optional: adds details the photo does not show)'}</small></label>
        <textarea value={desc} maxLength={500} onChange={e => setDesc(e.target.value)} placeholder={textMode ? 'e.g. long wavy honey-brown hair with a centre parting, round gold glasses, small hoop earrings, slim build' : 'e.g. my hair is in a low bun at the back, I usually wear small gold hoops'} rows={textMode ? 4 : 2} />
        {textMode && <small className="s2-count">{desc.length}/500</small>}
        {mode === 'little-self' && <div className="s2-style"><img src="/media/style_cozy_clay_traveler.png" alt="Style reference" /><div><b>Style: Cozy Clay Traveler</b><small>Your reference image. Every Little Self is drawn in this style.</small></div></div>}
      </section>
      <section>
        <h4>1 · {MODE_COPY[mode].source}</h4>
        <p className="s2-fine">{mode === 'little-self' ? `Gemini 4 Neon reads ${textMode ? 'your description' : 'your visible hair and accessories'}. The image model then draws your clay character in the chosen outfit, and Gemini 4 Carbon checks style, pose and garments${textMode ? ' and whether it matches your words' : ''}.` : 'Gemini 4 Neon reads the garments. The image model dresses you in a clean A-pose studio photo, and Gemini 4 Carbon checks identity and garment fidelity.'}</p>
        <label className="s2-check"><input type="checkbox" checked={consentG} onChange={e => setConsentG(e.target.checked)} /> Send my {textMode ? 'description' : 'photo'} and the garment images to Google Gemini API</label>
        <button className="s2-btn" disabled={!caps?.gemini || !consentG || !!activeJob || (textMode && desc.trim().length < 3)} onClick={() => run('source')}>{entry?.source ? 'Regenerate' : 'Generate'} {MODE_COPY[mode].source.toLowerCase()}</button>
        {entry?.source && <div className="s2-src"><img src={entry.source.url} alt="2D source" /><div><b>{entry.source.qa?.verdict ? `QA: ${entry.source.qa.verdict}` : 'QA pending'}</b><small>Made from {entry.source.input === 'text' ? 'a text description, no photo' : 'your photo'} · Gemini 4 Carbon check · {new Date(entry.source.createdAt).toLocaleString()}</small></div></div>}
        {!!entry?.source?.notes?.length && <ul className="s2-notes">{entry.source.notes.map(n => <li key={n}>{n}</li>)}</ul>}
        {!!entry?.source?.defaults?.length && <p className="s2-fine">Defaults used (not in your description): {entry.source.defaults.join(', ')}</p>}
      </section>
      <section>
        <h4>2 · Make it 3D</h4>
        {mode === 'little-self' && <div className="s2-free">
          <b>Free local 3D</b>
          <p className="s2-fine">Gemini draws the back view of your character, then this computer estimates depth (Depth Anything V2 Small) and stitches the front and back into a rotatable model. No paid 3D API. The sides are interpolated, so seams can show at 90°.</p>
          <label className="s2-check"><input type="checkbox" checked={consentL} onChange={e => setConsentL(e.target.checked)} /> Send the character concept to Google Gemini API for the back view</label>
          <button className="s2-btn" disabled={!caps?.gemini || !consentL || !entry?.source || !!activeJob} onClick={() => run('model3d', 'local-relief')}>{entry?.models['local-relief'] ? 'Rebuild' : 'Build'} free 3D model</button>
        </div>}
        <p className="s2-fine">{mode === 'little-self' ? 'Higher quality: ' : ''}{MODE_COPY[mode].provider} (via fal.ai) turns the 2D image into a textured GLB model. The back and sides are AI-inferred.</p>
        <label className="s2-check"><input type="checkbox" checked={consentF} onChange={e => setConsentF(e.target.checked)} /> Send the {MODE_COPY[mode].source.toLowerCase()} to fal.ai</label>
        <button className="s2-btn" disabled={!caps?.fal || !consentF || !entry?.source || !!activeJob} onClick={() => run('model3d')}>Generate 3D model</button>
        {caps && !caps.fal && <p className="s2-warn">3D generation unavailable: <code>FAL_KEY</code> is not set in <code>.env</code>.</p>}
      </section>
      {(error || lastJob?.error) && <p className="s2-err">{error || lastJob?.error?.message}</p>}
    </aside>

    <main className="s2-center">
      <AvatarViewer ref={viewer} modelUrl={modelUrl} fallbackImage={entry?.source?.url} fallbackLabel="2D concept" destination={dest} placement={placement}
        yawGoal={yaw} zoom={zoom} onYaw={setYaw} onError={m => setError(`3D model failed to load: ${m}`)}
        badge={!modelUrl && entry?.source ? <div className="s2-flatbadge">2D {MODE_COPY[mode].source.toLowerCase()}: not rotatable until the 3D model is generated</div> : !entry?.source && !modelUrl ? <div className="s2-empty"><strong>{MODE_COPY[mode].title}</strong><span>Generate a {MODE_COPY[mode].source.toLowerCase()} to begin.</span></div> : null} />
      <div className="s2-place"><span>DESTINATION</span><strong>{dest.name}</strong><small>Real photo · only the avatar rotates</small></div>
      <div className="s2-hud">
        <div className="s2-seg">{[['Front', 0], ['Side', 90], ['Back', 180], ['Side', 270]].map(([l, d], i) => <button key={i} disabled={!modelUrl} onClick={() => setYaw(Number(d) + Math.round(yaw / 360) * 360)}>{l}</button>)}</div>
        <label>Zoom <input type="range" min={0.8} max={2.4} step={0.05} value={zoom} onChange={e => setZoom(Number(e.target.value))} /></label>
        <label>Size <input type="range" min={0.6} max={1.5} step={0.01} value={placement.scale} onChange={e => setPlacement(p => ({ ...p, scale: Number(e.target.value) }))} /></label>
        <label>Position <input type="range" min={-2} max={2} step={0.02} value={placement.x} onChange={e => setPlacement(p => ({ ...p, x: Number(e.target.value) }))} /></label>
        <button onClick={() => { setYaw(0); setZoom(1); setPlacement(DEFAULT_PLACEMENT) }}>Reset</button>
        <button className="s2-cta" onClick={async () => setShot(await viewer.current!.snapshot())}>Save postcard</button>
      </div>
      {shot && <div className="s2-shot" onClick={() => setShot(null)}><figure onClick={e => e.stopPropagation()}><img src={shot} alt="Postcard" /><figcaption>{fixture ? 'Viewer test fixture (CesiumMan, CC-BY 4.0), not your avatar,' : modelUrl ? 'AI-generated 3D preview' : '2D concept'} composited on a real photo. Illustrative, not a fit guarantee. <a href={shot} download="roamfit-postcard.png">Download</a> · <button onClick={() => setShot(null)}>Close</button></figcaption></figure></div>}
    </main>

    <aside className="s2-right">
      <h3>Outfits</h3>
      {caps?.outfits.map(o => {
        const e = assets.find(a => a.key === `${profileOf(mode)}__${mode}__${o.id}`)
        const st = e && Object.keys(e.models).length ? '3D ready' : e?.source ? '2D only' : 'not generated'
        return <button key={o.id} className={`s2-outfit ${outfitId === o.id ? 'on' : ''}`} onClick={() => { setOutfitId(o.id); setYaw(0) }}>
          <div className="s2-thumbs">{GARMENT_THUMBS[o.id]?.map(t => <img key={t} src={t} alt="" />)}</div>
          <strong>{o.name}</strong><small>{o.label}</small><em className={{ '3D ready': 'st-ready', '2D only': 'st-2d', 'not generated': 'st-none' }[st]}>{st}</em>
        </button>
      })}
      <p className="s2-fine">Each outfit is a separate generated model, cached per avatar. Switching outfits swaps the whole character. This is not cloth simulation. Changing the destination never regenerates anything.</p>
      <h4>Add a garment</h4>
      <div className="s2-disabled"><input placeholder="Paste a product URL" disabled /><small>Product import and Shopify recommendations are not connected yet.</small></div>
      <button className="s2-link" onClick={() => setShowTrace(s => !s)}>{showTrace ? 'Hide' : 'Show'} how this look was made</button>
      {showTrace && <div className="s2-trace">{entry?.trace.length ? entry.trace.map((t, i) => <div key={i}><b>{t.role}</b><span>{t.model}{t.generation ? ` · ${t.generation}` : ''}{t.latencyMs ? ` · ${(t.latencyMs / 1000).toFixed(1)}s` : ''}</span></div>) : <small>No generation recorded for this look.</small>}</div>}
    </aside>
  </div>
}
