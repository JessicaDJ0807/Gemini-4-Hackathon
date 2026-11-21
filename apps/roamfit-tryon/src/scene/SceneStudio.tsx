// Simplified Roamfit studio: pick outfit + destination → one full-scene try-on photo → optional paid rotating video.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { SceneViewer, type SceneView } from './SceneViewer'
import { buildGarmentIndex, resolveDailyOutfit } from '../integration/teamAdapter'
import type { TeamDailyOutfit, TeamDestination, TeamWardrobeItem } from '../integration/teamContracts'
import { matchDestination } from '../integration/backgrounds'
import { rewriteTeamFixtureUrl, teamPlanRequest, teamPlanResponse } from '../integration/fixtures'
import '../studio2/studio2.css'
import './scene.css'

type Mode = 'little-self' | 'real-me'
type Method = 'text' | 'photo'
type Bg = { id: string; name: string; title: string; url: string; credit: string }
type Garment = { id: string; name: string; category: string; thumb: string }
type Look = { id: string; name: string; garmentIds: string[]; note: string; unavailable?: number }
/** A selectable piece. `payload` is what the API receives: a built-in id, or a team garment object. */
type Piece = Garment & { payload: string | { id: string; name: string; category: string; imageUrl: string; color?: string }; disabled?: string }
export type SceneStudioProps = {
  /** Team contracts. When given, these replace the built-in demo pieces and looks. */
  wardrobe?: TeamWardrobeItem[]; outfits?: TeamDailyOutfit[]; destination?: TeamDestination
  /** Rewrite team imageUrls to URLs this server may read (see TRYON_MEDIA_ALLOWED_HOSTS). Identity by default. */
  resolveImageUrl?: (url: string) => string
}
type Config = { gemini: boolean; backgrounds: Bg[]; garments: Garment[]; looks: Look[]; video: { model: string; seconds: number; costEstimateUsd: number } }
type Result = { key: string; mode: Mode; input: Method; garmentIds: string[]; backgroundId: string; destination: string
  still: { url: string; createdAt: string; totalMs?: number; notes?: string[]; review?: { verdict?: string; notes?: string[] } }
  video?: { url: string; frames: string[]; frameCount: number; label: string; createdAt: string; costEstimateUsd: number }
  trace: { role: string; model: string; generation?: string; latencyMs?: number }[] }
type Job = { id: string; kind: 'still' | 'video'; key: string; status: 'running' | 'done' | 'failed'; step: string; startedAt: number; error?: { message: string } }

const COPY: Record<Mode, { title: string; sub: string }> = {
  'little-self': { title: 'My Little Self', sub: 'Cozy clay mini-me' },
  'real-me': { title: 'Real Me', sub: 'Photo-based try-on' },
}
const api = async <T,>(url: string, init?: RequestInit): Promise<T> => { const r = await fetch(url, init); const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.error || `HTTP ${r.status}`); return b }
const post = <T,>(url: string, body: unknown) => api<T>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const toDataUrl = (f: File) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = no; r.readAsDataURL(f) })
const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join()

const FIXTURE_WARDROBE = (teamPlanRequest as unknown as { wardrobe: TeamWardrobeItem[] }).wardrobe ?? []

export default function SceneStudio(props: SceneStudioProps = {}) {
  const external = !!props.wardrobe
  const [source, setSource] = useState<'demo' | 'team'>(external ? 'team' : 'demo')
  const [cfg, setCfg] = useState<Config | null>(null)
  const [mode, setMode] = useState<Mode>('little-self')
  const [method, setMethod] = useState<Method>('text')
  const [desc, setDesc] = useState('')
  const [personId, setPersonId] = useState<string | null>(null)
  const [personPreview, setPersonPreview] = useState<string | null>(null)
  const [uploads, setUploads] = useState<Garment[]>([])
  const [garmentIds, setGarmentIds] = useState<string[]>(['tee', 'trousers'])
  const [bgId, setBgId] = useState('bg-montreal-old-port-street-v1')
  const [consent, setConsent] = useState(false)
  const [results, setResults] = useState<Result[]>([])
  const [current, setCurrent] = useState<Result | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [view, setView] = useState<SceneView>('photo')
  const [confirmVideo, setConfirmVideo] = useState(false)
  const [error, setError] = useState('')
  const [showTrace, setShowTrace] = useState(false)
  const [, tick] = useState(0)

  const textOnly = mode === 'little-self' && method === 'text'
  // Pieces + looks: built-in demo items, or the team's WardrobeItem[] / DailyOutfit[] (props, else the recorded team fixture).
  const team = useMemo(() => {
    const wardrobe = props.wardrobe ?? FIXTURE_WARDROBE
    const outfits = props.outfits ?? teamPlanResponse.outfits
    const { index } = buildGarmentIndex(wardrobe, { resolveImageUrl: props.resolveImageUrl ?? (external ? undefined : rewriteTeamFixtureUrl) })
    const pieces: Piece[] = [...index.values()].map(g => ({ id: g.id, name: g.name, category: g.category, thumb: g.imageUrl,
      payload: { id: g.id, name: g.name, category: g.category, imageUrl: g.imageUrl, color: g.color },
      disabled: g.imageStatus && g.imageStatus !== 'ok' ? (g.imageStatus === 'missing' ? 'no image' : 'SVG: preview only') : undefined }))
    const looks: Look[] = outfits.map(o => resolveDailyOutfit(o, index)).map(l => ({ id: l.id, name: l.name, garmentIds: l.garmentIds.filter(id => !pieces.find(p => p.id === id)?.disabled), note: l.rationale, unavailable: l.unavailableIds.length }))
    return { pieces, looks, destination: props.destination ?? (external ? undefined : teamPlanRequest.trip?.destination) }
  }, [props.wardrobe, props.outfits, props.destination, props.resolveImageUrl, external])
  const pieces: Piece[] = source === 'team' ? [...team.pieces, ...uploads.map(u => ({ ...u, payload: u.id }))]
    : [...(cfg?.garments ?? []), ...uploads].map(g => ({ ...g, payload: g.id }))
  const looks: Look[] = source === 'team' ? team.looks : cfg?.looks ?? []
  const switchSource = (s: 'demo' | 'team') => changeSel(() => { setSource(s); const l = s === 'team' ? team.looks[0] : cfg?.looks[0]; setGarmentIds(l?.garmentIds ?? [])
    const d = s === 'team' ? matchDestination(team.destination) : undefined; if (d) setBgId(d.backgrounds[0].id) })
  useEffect(() => { if (external) switchSource('team') }, [external, team]) // eslint-disable-line react-hooks/exhaustive-deps
  const payloads = garmentIds.map(id => pieces.find(p => p.id === id)?.payload ?? id)
  const selection = useMemo(() => ({ mode, input: textOnly ? 'text' : 'photo', description: desc, personId: textOnly ? null : personId, garments: payloads, backgroundId: bgId }), [mode, textOnly, desc, personId, JSON.stringify(payloads), bgId]) // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = useCallback(() => api<Result[]>('/api/scene/results').then(setResults).catch(() => {}), [])
  useEffect(() => { api<Config>('/api/scene/config').then(setCfg).catch(e => setError(`API not reachable (${e.message}). Restart npm run dev.`)); refresh() }, [refresh])

  // Selection → cached result (no generation calls).
  const [lookupKey, setLookupKey] = useState<string | null>(null)
  useEffect(() => {
    if (pinned) return
    const t = setTimeout(() => post<{ key: string | null; result: Result | null }>('/api/scene/lookup', selection).then(r => { setLookupKey(r.key); setCurrent(r.result) }).catch(() => {}), 250)
    return () => clearTimeout(t)
  }, [selection, pinned, results])
  const activeKey = pinned ?? lookupKey
  useEffect(() => { if (pinned) setCurrent(results.find(r => r.key === pinned) ?? null) }, [pinned, results])

  // Poll running jobs.
  useEffect(() => {
    if (!jobs.some(j => j.status === 'running')) return
    const t = setInterval(async () => {
      tick(x => x + 1)
      const next = await Promise.all(jobs.map(j => j.status === 'running' ? api<Job>(`/api/scene/jobs/${j.id}`).catch(() => j) : j))
      if (next.some((j, i) => j.status !== jobs[i].status || j.step !== jobs[i].step)) {
        setJobs(next); refresh()
        next.forEach((j, i) => { if (j.status === 'done' && jobs[i].status === 'running' && j.kind === 'video' && j.key === activeKey) setView('rotate') })
      }
    }, 1500)
    return () => clearInterval(t)
  }, [jobs, refresh, activeKey])
  // The Model B review lands a few seconds after the still; refresh once more.
  useEffect(() => { if (current?.still && !current.still.review) { const t = setTimeout(refresh, 8000); return () => clearTimeout(t) } }, [current, refresh])

  const stillJob = jobs.find(j => j.status === 'running' && j.kind === 'still' && j.key === activeKey)
  const videoJob = jobs.find(j => j.status === 'running' && j.kind === 'video' && j.key === activeKey)
  const lastFailed = [...jobs].reverse().find(j => j.key === activeKey && j.status === 'failed')
  const secs = (j?: Job) => j ? ` · ${Math.round((Date.now() - j.startedAt) / 1000)}s` : ''

  const changeSel = (f: () => void) => { setPinned(null); setView('photo'); setConfirmVideo(false); f() }
  // One per category (accessories up to 3, uploads stack); a dress replaces top + bottom and vice versa.
  const toggleGarment = (g: Garment) => changeSel(() => setGarmentIds(ids => {
    if (ids.includes(g.id)) return ids.filter(x => x !== g.id)
    const cat = (x: string) => pieces.find(p => p.id === x)?.category
    const clash = (c?: string) => c !== 'garment' && (g.category === 'accessory' ? false : c === g.category || (g.category === 'dress' && (c === 'top' || c === 'bottom')) || (c === 'dress' && (g.category === 'top' || g.category === 'bottom')))
    const kept = ids.filter(x => !clash(cat(x)))
    return g.category === 'accessory' && kept.filter(x => cat(x) === 'accessory').length >= 3 ? kept : [...kept, g.id]
  }))
  const generate = async (regenerate = false) => {
    setError('')
    try {
      const r = await post<Job & { cached?: boolean }>('/api/scene/tryon', { ...selection, consent, regenerate })
      if (r.cached) { setPinned(null); refresh(); return }
      setJobs(js => [...js, r]); setView('photo')
    } catch (e) { setError((e as Error).message) }
  }
  const makeVideo = async () => {
    setError(''); setConfirmVideo(false)
    try { const j = await post<Job>('/api/scene/video', { key: activeKey, authorizeCost: true }); setJobs(js => [...js, j]) } catch (e) { setError((e as Error).message) }
  }
  const upload = async (kind: 'person' | 'garment', f?: File) => {
    if (!f) return; setError('')
    try {
      const dataUrl = await toDataUrl(f)
      const r = await post<{ id: string; outfitId?: string }>('/api/studio/upload', { kind, dataUrl })
      if (kind === 'person') { setPersonId(r.id); setPersonPreview(dataUrl); setPinned(null) }
      else { const g = { id: r.outfitId!, name: 'Your garment', category: 'garment', thumb: dataUrl }; setUploads(u => [...u, g]); changeSel(() => setGarmentIds(ids => [...ids, g.id])) }
    } catch (e) { setError((e as Error).message) }
  }

  const bg = cfg?.backgrounds.find(b => b.id === bgId)
  const look = looks.find(l => same(l.garmentIds, garmentIds))
  const canGenerate = !!cfg?.gemini && consent && garmentIds.length > 0 && !stillJob && !(textOnly && desc.trim().length < 3)
  const myResults = results.filter(r => r.mode === mode).sort((a, b) => b.still.createdAt.localeCompare(a.still.createdAt))
  const hasVideo = !!current?.video
  const status = stillJob ? `${stillJob.step}${secs(stillJob)}` : videoJob ? `${videoJob.step}${secs(videoJob)}` : current ? (hasVideo ? 'Photo + rotating preview ready' : 'Try-on photo ready') : 'Pick an outfit and a destination'

  return <div className="s2 sc">
    <header className="s2-head">
      <div className="s2-brand">ROAM<span>FIT</span></div>
      <div className="s2-modes" role="tablist">{(Object.keys(COPY) as Mode[]).map(m => <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => changeSel(() => setMode(m))}><strong>{COPY[m].title}</strong><small>{COPY[m].sub}</small></button>)}</div>
      <p className="s2-tag">See yourself, dressed for wherever you're going.</p>
      <div className={`s2-status ${stillJob || videoJob ? 'busy' : current ? 'ok' : ''}`}><i />{status}</div>
    </header>

    <aside className="s2-left">
      <section>
        <h4>1 · {mode === 'real-me' ? 'Your photo' : 'Your little self'}</h4>
        {mode === 'little-self' && <div className="s2-input" role="tablist">{([['text', 'Describe myself'], ['photo', 'Use my photo']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={method === k} className={method === k ? 'on' : ''} onClick={() => changeSel(() => setMethod(k))}>{l}</button>)}</div>}
        {!textOnly && <div className="s2-upload">
          {personPreview ? <img src={personPreview} alt="Your photo" /> : <div className="s2-ph">Demo<br />photo</div>}
          <div><b>{personId ? 'Your photo' : 'Using the demo photo'}</b><small>{mode === 'real-me' ? 'Full body, front-facing works best.' : 'Your photo leads; notes fill in details.'}</small>
            <label className="s2-filebtn">Upload photo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => upload('person', e.target.files?.[0])} /></label>
            {personId && <button className="s2-mini" onClick={async () => { await api(`/api/studio/upload/${personId}`, { method: 'DELETE' }); setPersonId(null); setPersonPreview(null) }}>Remove</button>}</div>
        </div>}
        <textarea value={desc} maxLength={500} onChange={e => changeSel(() => setDesc(e.target.value))} rows={textOnly ? 3 : 2} aria-label="Description"
          placeholder={textOnly ? 'Describe yourself: e.g. shoulder-length black hair, round glasses, small gold hoops' : 'Optional notes, e.g. I usually wear small gold hoops'} />
        {mode === 'little-self' && <div className="s2-style"><img src="/media/style_cozy_clay_traveler.png" alt="Style reference" /><div><b>Cozy Clay Traveler</b><small>Every Little Self is drawn in this style.</small></div></div>}
      </section>

      <section>
        <h4>2 · Destination</h4>
        <div className="sc-dests">{cfg?.backgrounds.map(b => <button key={b.id} className={bgId === b.id ? 'on' : ''} onClick={() => changeSel(() => setBgId(b.id))}>
          <img src={b.url} alt="" /><span><b>{b.name}</b><small>{b.title}</small></span></button>)}</div>
      </section>

      <section>
        <h4>3 · Try it on</h4>
        <p className="sc-summary">{look ? <b>{look.name}</b> : <b>{garmentIds.length} item{garmentIds.length === 1 ? '' : 's'}</b>} in <b>{bg?.name}</b></p>
        {!current && <label className="s2-check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> Send my {textOnly ? 'description' : 'photo'}, the garments and the destination photo to Google Gemini API</label>}
        {current ? <div className="s2-row"><span className="sc-cached">✓ Saved look, shown instantly</span>
          <label className="s2-check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> OK to send inputs to Gemini again</label>
          <button className="s2-mini" disabled={!canGenerate} onClick={() => generate(true)}>Regenerate photo</button></div>
          : <button className="s2-btn sc-go" disabled={!canGenerate} onClick={() => generate()}>{stillJob ? 'Generating…' : 'Generate Try-On'}</button>}
        {!current && !stillJob && <p className="s2-fine">One image, usually under a minute. Nothing is generated until you click.</p>}
      </section>

      {current && <section>
        <h4>4 · 360° preview <em className="sc-opt">optional</em></h4>
        {hasVideo ? <p className="s2-fine">Rotating preview ready: drag the photo or play the video.</p>
          : <p className="s2-fine">{cfg?.video.model} turns {mode === 'real-me' ? 'you' : 'your little self'} in place while the street stays still ({cfg?.video.seconds}s video, about <b>US${cfg?.video.costEstimateUsd}</b>, takes about a minute). You keep seeing the photo while it works.</p>}
        {videoJob ? <button className="s2-btn" disabled>Generating… {secs(videoJob).slice(3)}</button>
          : !confirmVideo ? <button className={hasVideo ? 's2-mini' : 's2-btn'} onClick={() => setConfirmVideo(true)}>{hasVideo ? 'Make a new video' : 'Generate 360° Preview'}</button>
          : <div className="sc-confirm"><span>Charge about US${cfg?.video.costEstimateUsd} for one video? No automatic retries.</span>
            <div className="s2-row"><button className="s2-mini on" onClick={makeVideo}>Yes, generate</button><button className="s2-mini" onClick={() => setConfirmVideo(false)}>Cancel</button></div></div>}
      </section>}
      {(error || lastFailed) && <p className="s2-err">{error || lastFailed?.error?.message}</p>}
    </aside>

    <main className="s2-center sc-center">
      <div className="sc-tabs" role="tablist">
        {([['photo', 'Photo'], ['rotate', 'Drag to rotate'], ['video', 'Play video']] as const).map(([k, l]) =>
          <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} disabled={k !== 'photo' && !hasVideo} onClick={() => setView(k)}>{l}</button>)}
      </div>
      <div className="sc-frame">
        <SceneViewer view={view} still={current?.still.url} frames={current?.video?.frames} video={current?.video?.url}
          busy={stillJob ? `${stillJob.step}…${secs(stillJob)}` : videoJob ? `Making your rotating preview${secs(videoJob)}. The photo stays here meanwhile.` : undefined}
          empty={<div className="sc-empty" style={{ backgroundImage: bg ? `url(${bg.url})` : undefined }}><div><strong>{COPY[mode].title}</strong>
            <span>{stillJob ? 'Generating your try-on photo…' : 'Choose garments on the right, a destination on the left, then Generate Try-On.'}</span></div></div>}
          badge={current && <div className="sc-badge">{view === 'photo' ? 'AI-generated try-on photo' : current.video?.label ?? ''}</div>} />
      </div>
      <div className="sc-caption">
        <span>{current ? `${current.destination} · ${bg?.title ?? ''}` : bg ? `${bg.name} · ${bg.title}` : ''}</span>
        <small>{bg?.credit} · AI image/video simulation: not a 3D model and not a fit guarantee.</small>
        {current?.still.review?.notes?.length ? <small className="sc-review">Gemini 4 review ({current.still.review.verdict}): {current.still.review.notes.join(' · ')}</small> : null}
      </div>
    </main>

    <aside className="s2-right">
      <h3>Outfits</h3>
      {!external && <div className="s2-input" role="tablist" aria-label="Wardrobe source">{([['demo', 'Roamfit demo'], ['team', 'Team plan (fixture)']] as const).map(([k, l]) =>
        <button key={k} role="tab" aria-selected={source === k} className={source === k ? 'on' : ''} onClick={() => switchSource(k)}>{l}</button>)}</div>}
      {source === 'team' && !external && <p className="s2-fine">Recorded team outfit plan (fixture), not your wardrobe.</p>}
      <h4>Recommended looks</h4>
      {looks.map(l => <button key={l.id} className={`s2-outfit ${same(l.garmentIds, garmentIds) ? 'on' : ''}`} onClick={() => changeSel(() => setGarmentIds(l.garmentIds))}>
        <div className="s2-thumbs">{l.garmentIds.map(id => <img key={id} src={pieces.find(g => g.id === id)?.thumb} alt="" />)}</div>
        <strong>{l.name}</strong><small className="sc-note">{l.note}</small>{!!l.unavailable && <small>{l.unavailable} item(s) not in the wardrobe</small>}</button>)}
      <h4>Pieces</h4>
      <div className="sc-pieces">{pieces.map(g => <button key={g.id} className={garmentIds.includes(g.id) ? 'on' : ''} aria-pressed={garmentIds.includes(g.id)} disabled={!!g.disabled} title={g.disabled} onClick={() => toggleGarment(g)}>
        <img src={g.thumb} alt="" /><b>{g.name}</b><small>{g.disabled ?? g.category}</small></button>)}
        <label className="sc-add">+<small>Upload garment</small><input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => upload('garment', e.target.files?.[0])} /></label></div>
      {myResults.length > 0 && <><h4>Your looks</h4>
        <div className="sc-history">{myResults.map(r => <button key={r.key} className={r.key === activeKey ? 'on' : ''} title={`${r.destination}${r.video ? ' · has 360° preview' : ''}`}
          onClick={() => { setPinned(r.key); setGarmentIds(r.garmentIds); setBgId(r.backgroundId); setView('photo'); setConfirmVideo(false) }}>
          <img src={r.still.url} alt="" />{r.video && <em>360°</em>}</button>)}</div></>}
      <h4>Shop the look</h4>
      <div className="s2-disabled"><input placeholder="Paste a product URL" disabled /><small>Shopify is not connected (no store credentials).</small></div>
      <button className="s2-link" onClick={() => setShowTrace(s => !s)}>{showTrace ? 'Hide' : 'Show'} how this look was made</button>
      {showTrace && <div className="s2-trace">{current?.trace.length ? current.trace.map((t, i) => <div key={i}><b>{t.role}</b><span>{t.model}{t.generation ? ` · ${t.generation}` : ''}{t.latencyMs ? ` · ${(t.latencyMs / 1000).toFixed(1)}s` : ''}</span></div>) : <small>No generation recorded for this look.</small>}</div>}
    </aside>
  </div>
}
