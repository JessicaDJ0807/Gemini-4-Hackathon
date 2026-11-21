// Integration-ready Roamfit Try-On Studio (#/tryon).
// Consumes team WardrobeItem[] + DailyOutfit[] (props, or recorded team fixtures by default), keeps ONE SelectedLook,
// builds TryOnPreviewRequestV1 only on an explicit Generate, and renders the result in the existing TurnaroundViewer.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { TryOnGarment, TryOnPreviewJobV1, TurnaroundManifestV1 } from '../../shared/tryon/contract.js'
import { DESTINATIONS, findBackground, matchDestination, toViewerDestination } from '../integration/backgrounds'
import { roamfitFixtureOutfits, roamfitWardrobe, rewriteTeamFixtureUrl, TEAM_FIXTURE_SOURCE, teamPlanRequest, teamPlanResponse } from '../integration/fixtures'
import { buildPreviewRequest, type AvatarInput } from '../integration/previewRequest'
import { acceptJobUpdate, emptyStore, isTerminal, manifestToAsset, startRequest, type PreviewStoreState } from '../integration/previewStore'
import { addGarment, applyLook, emptySelection, setTopLayering, toggleGarment, type SelectionResult, type SelectionState } from '../integration/selection'
import { buildGarmentIndex, resolveDailyOutfit } from '../integration/teamAdapter'
import type { TeamDailyOutfit, TeamDestination, TeamOutfitPlanResponse, TeamWardrobeItem } from '../integration/teamContracts'
import { TurnaroundViewer, type ViewerHandle } from '../studio2/TurnaroundViewer'
import { WardrobeSidebar } from './WardrobeSidebar'
import '../studio2/studio2.css'
import './tryon.css'

export type TryOnStudioData = {
  wardrobe: TeamWardrobeItem[]
  outfitPlan?: Pick<TeamOutfitPlanResponse, 'outfits' | 'warnings' | 'shoppingGaps'>
  destination?: TeamDestination
  /** Rewrites team image URLs to ones the browser and Roamfit server can read. */
  resolveImageUrl?: (url: string) => string
  isFixture?: boolean
  sourceLabel?: string
}

const fixtureData = (): TryOnStudioData => ({
  wardrobe: [...teamPlanRequest.wardrobe, ...roamfitWardrobe], outfitPlan: { ...teamPlanResponse, outfits: [...teamPlanResponse.outfits, ...roamfitFixtureOutfits] },
  destination: teamPlanRequest.trip.destination, resolveImageUrl: rewriteTeamFixtureUrl, isFixture: true,
  sourceLabel: `Team fixture: recorded outfit plan (${TEAM_FIXTURE_SOURCE.split(':')[0]})`,
})

const MODE = { stylized: { title: 'My Little Self', sub: 'Cozy minimal character' }, realistic: { title: 'Real Me', sub: 'Photo-real try-on' } } as const
const PROVENANCE: Record<string, { tone: string; text: string }> = {
  fixture: { tone: 'warn', text: 'FIXTURE: not your outfit' },
  'approved-asset': { tone: 'ok', text: 'Previously generated, approved asset' },
  cache: { tone: 'ok', text: 'Cached preview' },
  'generated-live': { tone: 'ok', text: 'Generated for you' },
}
const STATE_TEXT: Record<string, string> = { queued: 'Queued', 'generating-image': 'Generating image', 'awaiting-approval': 'Approve the image to continue', 'generating-views': 'Generating views',
  'generating-video': 'Generating video', 'extracting-frames': 'Extracting frames', validating: 'Validating', ready: 'Ready', failed: 'Failed' }
const toDataUrl = (f: File) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = no; r.readAsDataURL(f) })
const session = Math.random().toString(36).slice(2, 8)

type Sel = { state: SelectionState; notice?: string }
type SelAction = { t: 'apply'; r: SelectionResult }
const selReducer = (s: Sel, a: SelAction): Sel => (a.r.changed ? { state: a.r.state, notice: a.r.notice } : { ...s, notice: a.r.notice ?? s.notice })

export default function TryOnStudio({ data }: { data?: TryOnStudioData }) {
  const input = useMemo(() => data ?? fixtureData(), [data])
  const [extra, setExtra] = useState<TryOnGarment[]>([])
  const { index, issues } = useMemo(() => buildGarmentIndex(input.wardrobe, { resolveImageUrl: input.resolveImageUrl ? u => input.resolveImageUrl!(u) : undefined }, extra), [input, extra])
  const looks = useMemo(() => (input.outfitPlan?.outfits ?? []).map((o: TeamDailyOutfit) => resolveDailyOutfit(o, index, { isFixture: !!input.isFixture })), [input, index])

  const [sel, dispatch] = useReducer(selReducer, { state: emptySelection() })
  const [avatar, setAvatar] = useState<AvatarInput>({ mode: 'stylized', creationMethod: 'photo', description: 'short black hair, small gold hoop earrings', personMediaId: 'demo-person-v1' })
  const [personPreview, setPersonPreview] = useState<string | null>(null)
  const teamDest = matchDestination(input.destination)
  const [destId, setDestId] = useState(teamDest?.id ?? DESTINATIONS[0].id)
  const dest = DESTINATIONS.find(d => d.id === destId)!
  const [bgId, setBgId] = useState(dest.backgrounds[0].id)
  const bg = findBackground(bgId) ?? dest.backgrounds[0]
  const [previewMode, setPreviewMode] = useState<'turnaround' | 'photo'>('turnaround')
  const [caps, setCaps] = useState<{ providers: { live: { enabled: boolean; reasons: string[] } }; shopifyConfigured: boolean } | null>(null)
  const [consent, setConsent] = useState(false)
  const [store, setStore] = useState<PreviewStoreState>(emptyStore)
  const [pending, setPending] = useState<{ jobId: string; lookKey: string }[]>([])
  const [error, setError] = useState('')
  const [autoplay, setAutoplay] = useState(false)
  const [placement, setPlacement] = useState({ dx: 0, dy: 0, scale: 1 })
  const [angle, setAngle] = useState(0)
  const [shot, setShot] = useState<string | null>(null)
  const viewer = useRef<ViewerHandle>(null)
  const revision = useRef({ key: '', n: 0 })

  useEffect(() => { fetch('/api/v1/tryon/capabilities').then(r => r.json()).then(setCaps).catch(() => setError('Roamfit API not reachable. Start it with npm run dev.')) }, [])

  // Validation/lookKey use a placeholder identity; the real requestId/inputRevision are assigned on Generate.
  const draft = useMemo(() => buildPreviewRequest({ requestId: 'draft', inputRevision: 0, avatar, selection: sel.state, index, background: bg, previewMode,
    authorization: caps?.providers.live.enabled ? { sendToGemini: consent } : undefined }), [avatar, sel.state, index, bg, previewMode, consent, caps])
  if (draft.lookKey !== revision.current.key) revision.current = { key: draft.lookKey, n: revision.current.n + 1 }
  const entry = store.byLookKey[draft.lookKey]
  const job = entry?.job
  const running = !!pending.find(p => p.lookKey === draft.lookKey)
  const asset = useMemo(() => (entry?.manifest && job?.status === 'ready' ? manifestToAsset(entry.manifest, avatar.mode, draft.lookKey) : null), [entry, job, avatar.mode, draft.lookKey])

  // Poll every non-terminal job. acceptJobUpdate decides whether an update may affect what is on screen.
  useEffect(() => {
    if (!pending.length) return
    const t = setInterval(async () => {
      for (const p of pending) {
        try {
          const j: TryOnPreviewJobV1 = await (await fetch(`/api/v1/tryon-previews/${p.jobId}`)).json()
          let m: TurnaroundManifestV1 | undefined
          if (j.status === 'ready' && j.turnaroundManifestUrl) m = await (await fetch(j.turnaroundManifestUrl)).json()
          setStore(s => acceptJobUpdate(s, j, p.lookKey, m))
          if (isTerminal(j) || j.status === 'awaiting-approval') setPending(ps => ps.filter(x => x.jobId !== p.jobId))
        } catch { /* transient; next tick retries */ }
      }
    }, 600)
    return () => clearInterval(t)
  }, [pending])

  const generate = useCallback(async () => {
    setError('')
    const rev = revision.current.n
    const built = buildPreviewRequest({ ...{ avatar, selection: sel.state, index, background: bg, previewMode }, requestId: `rf-${session}-${rev}-${Date.now().toString(36)}`, inputRevision: rev,
      authorization: caps?.providers.live.enabled ? { sendToGemini: consent, costAcknowledged: consent } : undefined })
    if (!built.ok) return setError(built.errors[0].message)
    setStore(s => startRequest(s, { requestId: built.request.requestId, inputRevision: rev, lookKey: built.lookKey }))
    try {
      const r = await fetch('/api/v1/tryon-previews', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(built.request) })
      const j = await r.json()
      if (!r.ok) { setError(j.error?.message ?? `HTTP ${r.status}`); return }
      let m: TurnaroundManifestV1 | undefined
      if (j.status === 'ready' && j.turnaroundManifestUrl) m = await (await fetch(j.turnaroundManifestUrl)).json()
      setStore(s => acceptJobUpdate(s, j, built.lookKey, m))
      if (!isTerminal(j) && j.status !== 'awaiting-approval') setPending(ps => [...ps, { jobId: j.jobId, lookKey: built.lookKey }])
    } catch (e) { setError(`Preview service unreachable: ${(e as Error).message}`) }
  }, [avatar, sel.state, index, bg, previewMode, caps, consent])

  const approve = async () => {
    if (!job) return
    const r = await fetch(`/api/v1/tryon-previews/${job.jobId}/approve`, { method: 'POST' })
    const j = await r.json()
    if (!r.ok) return setError(j.error?.message ?? 'Approval failed')
    setStore(s => startRequest(s, { requestId: j.requestId, inputRevision: j.inputRevision, lookKey: draft.lookKey }))
    setStore(s => acceptJobUpdate(s, j, draft.lookKey))
    setPending(ps => [...ps, { jobId: j.jobId, lookKey: draft.lookKey }])
  }

  const upload = async (f?: File) => {
    if (!f) return
    setError('')
    try {
      const dataUrl = await toDataUrl(f)
      const r = await fetch('/api/studio/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'person', dataUrl }) })
      const b = await r.json()
      if (!r.ok) throw new Error(b.error)
      setAvatar(a => ({ ...a, personMediaId: b.id })); setPersonPreview(dataUrl)
    } catch (e) { setError(`Upload failed: ${(e as Error).message}`) }
  }

  const onAddShopify = (g: TryOnGarment) => {
    setExtra(x => (x.some(y => y.id === g.id) ? x : [...x, g]))
    const idx = new Map(index); idx.set(g.id, g)
    dispatch({ t: 'apply', r: addGarment(sel.state, g, idx) })
  }

  const realistic = avatar.mode === 'realistic'
  const method = realistic ? 'photo' : avatar.creationMethod
  const prov = job?.provenance ? PROVENANCE[job.provenance] : null
  const presets = asset?.views ?? (asset?.verifiedFullRotation ? [{ label: 'front', angle: 0, origin: 'generated' }, { label: 'side', angle: 90, origin: 'generated' }, { label: 'back', angle: 180, origin: 'generated' }] : [])
  const genState = !sel.state.garmentIds.length ? { label: 'Select pieces or a look', disabled: true }
    : running ? { label: `${STATE_TEXT[job?.status ?? 'queued']}…`, disabled: true }
    : job?.status === 'ready' ? { label: 'Preview ready', disabled: true, hint: 'This exact look is already loaded. Changing the background never regenerates it.' }
    : !draft.ok ? { label: 'Generate preview', disabled: true }
    : { label: job?.status === 'failed' ? 'Retry preview' : 'Generate preview', disabled: false,
      hint: caps?.providers.live.enabled ? (consent ? 'Live: sends your inputs and garment images to Google Gemini.' : 'Live generation is not authorised; you will get a labelled fixture.') : 'Live generation is off on this server; approved assets or labelled fixtures only.' }

  return <div className="s2 rf">
    <header className="s2-head">
      <div className="s2-brand">ROAM<span>FIT</span></div>
      <div className="s2-modes" role="tablist" aria-label="Avatar mode">{(['stylized', 'realistic'] as const).map(m => <button key={m} role="tab" aria-selected={avatar.mode === m} className={avatar.mode === m ? 'on' : ''}
        onClick={() => setAvatar(a => ({ ...a, mode: m, personMediaId: a.personMediaId ?? 'demo-person-v1' }))}><strong>{MODE[m].title}</strong><small>{MODE[m].sub}</small></button>)}</div>
      <p className="rf-source" title={input.sourceLabel}>{input.isFixture ? <em className="rf-tag">fixture data</em> : <em className="rf-tag live">team data</em>} {input.sourceLabel ?? ''}</p>
      <div className={`s2-status ${running ? 'busy' : prov?.tone ?? ''}`}><i />{running ? job?.step ?? STATE_TEXT[job?.status ?? 'queued'] : job?.status === 'failed' ? `Failed: ${job.error?.message}` : prov?.text ?? 'No preview for this look yet'}</div>
    </header>

    <aside className="s2-left">
      <section>
        <h4>1 · {MODE[avatar.mode].title}</h4>
        {!realistic && <div className="s2-input" role="tablist">{([['photo', 'From a photo'], ['text', 'Describe myself']] as const).map(([k, l]) =>
          <button key={k} role="tab" aria-selected={method === k} className={method === k ? 'on' : ''} onClick={() => setAvatar(a => ({ ...a, creationMethod: k }))}>{l}</button>)}</div>}
        {method === 'photo' && <div className="s2-upload">
          {personPreview ? <img src={personPreview} alt="Your photo" /> : <div className="s2-ph">Demo<br />photo</div>}
          <div><b>{avatar.personMediaId === 'demo-person-v1' ? 'Bundled demo photo' : avatar.personMediaId ? 'Your photo' : 'No photo'}</b>
            <small>{realistic ? 'Use an authorised full-body, front-facing photo.' : 'The photo guides your character; notes fill gaps.'}</small>
            <label className="s2-filebtn">Upload photo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => upload(e.target.files?.[0])} /></label>
            {avatar.personMediaId !== 'demo-person-v1' && <button className="s2-mini" onClick={() => { setAvatar(a => ({ ...a, personMediaId: 'demo-person-v1' })); setPersonPreview(null) }}>Use demo photo</button>}</div>
        </div>}
        <label className="s2-label">{method === 'text' ? 'Describe yourself' : 'Notes'} <small>{method === 'text' ? '(required)' : realistic ? '(not used by Real Me generation yet)' : '(optional)'}</small></label>
        <textarea rows={method === 'text' ? 3 : 2} maxLength={500} value={avatar.description} onChange={e => setAvatar(a => ({ ...a, description: e.target.value }))}
          placeholder={method === 'text' ? 'e.g. shoulder-length black hair, round glasses' : 'e.g. I usually wear small gold hoops'} />
        {!realistic && <div className="s2-style"><img src="/media/style_cozy_clay_traveler.png" alt="Cozy Minimal Traveler style reference" /><div><b>Cozy Minimal Traveler</b><small>Approved style reference for every Little Self.</small></div></div>}
      </section>

      <section>
        <h4>2 · Destination</h4>
        <select className="rf-select" value={destId} onChange={e => { const d = DESTINATIONS.find(x => x.id === e.target.value)!; setDestId(d.id); setBgId(d.backgrounds[0].id) }}>
          {DESTINATIONS.map(d => <option key={d.id} value={d.id}>{d.name}{teamDest?.id === d.id ? ' (your trip)' : ''}</option>)}
        </select>
        {input.destination && !teamDest && <p className="rf-warn">No approved background photo for {input.destination.name} yet.</p>}
        <div className="rf-bgs">{dest.backgrounds.map(b => <button key={b.id} className={b.id === bg.id ? 'on' : ''} onClick={() => setBgId(b.id)} title={b.title}><img src={b.imageUrl} alt={b.title} /><span>{b.title}</span></button>)}</div>
        <p className="s2-fine">Photo: {bg.credit.author}, {bg.credit.license}{bg.credit.sourceUrl ? <> · <a href={bg.credit.sourceUrl} target="_blank" rel="noreferrer">source</a></> : ''}. Changing the background is instant and never regenerates the character.</p>
      </section>

      <section>
        <h4>3 · Preview</h4>
        <div className="s2-input" role="tablist">{([['turnaround', 'Turnaround'], ['photo', 'Single photo']] as const).map(([k, l]) =>
          <button key={k} role="tab" aria-selected={previewMode === k} className={previewMode === k ? 'on' : ''} onClick={() => setPreviewMode(k)}>{l}</button>)}</div>
        {caps?.providers.live.enabled
          ? <label className="s2-check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> Send my {method === 'text' ? 'description' : 'photo'} and the garment images to Google Gemini (paid image generation)</label>
          : <p className="s2-fine">Live generation is off on this server{caps ? ` (${caps.providers.live.reasons[0]})` : ''}. You get approved previously generated assets when inputs match exactly, otherwise a clearly labelled fixture.</p>}
        {job?.status === 'awaiting-approval' && <div className="s2-src"><img src={job.previewImageUrl} alt="Generated still" /><div><b>Check this image</b><small>Approve to build the 4-view turnaround (two more image generations).</small><button className="s2-mini on" onClick={approve}>Approve</button></div></div>}
        {!!issues.length && <details className="rf-issues"><summary>{issues.length} wardrobe data notes</summary><ul>{issues.map(i => <li key={i.itemId + i.code}>{i.message}</li>)}</ul></details>}
        {error && <p className="s2-err" role="alert">{error}</p>}
      </section>
    </aside>

    <main className="s2-center">
      <TurnaroundViewer ref={viewer} asset={asset} destination={toViewerDestination(bg, dest.name)} placement={placement} zoom={1} autoplay={autoplay} focus
        onInteract={() => setAutoplay(false)} onAngle={setAngle}
        empty={<div className="s2-empty"><strong>{MODE[avatar.mode].title}</strong><span>{sel.state.garmentIds.length ? 'Press Generate preview to see this look.' : 'Pick a recommended look or individual pieces on the right.'}</span></div>}
        badge={<>
          {job?.provenance && job.status === 'ready' && <div className={`rf-prov ${job.provenance}`}><b>{prov?.text}</b><span>{job.provenanceNote}</span></div>}
          {asset && <div className={`s2-cov ${asset.verifiedFullRotation ? 'ok' : ''}`}>{asset.method === 'video' ? `Verified 360° · ${asset.frameCount} frames` : asset.method === 'still' ? 'Single image' : `${asset.views?.filter(v => v.origin === 'generated').length} AI views + ${asset.views?.filter(v => v.origin !== 'generated').length} mirrored · not continuous 360°`}</div>}
        </>} />
      <div className="s2-place"><span>DESTINATION · REAL PHOTO</span><strong>{dest.name}</strong><small>Image-based turnaround, not 3D. Illustrative, not a fit guarantee.</small></div>
      <div className="s2-hud">
        <div className="s2-seg">{presets.map(v => <button key={v.angle} className={Math.round(angle) % 360 === v.angle ? 'on' : ''} title={v.origin !== 'generated' ? v.origin : ''}
          onClick={() => { setAutoplay(false); viewer.current?.setAngle(v.angle) }}>{v.label.replace(' profile', '')}{v.origin !== 'generated' ? '*' : ''}</button>)}</div>
        <button disabled={!asset || asset.method === 'still'} className={autoplay ? 'on' : ''} onClick={() => setAutoplay(a => !a)}>{autoplay ? 'Pause' : 'Play'}</button>
        <label>Size <input type="range" min={0.6} max={1.4} step={0.01} value={placement.scale} onChange={e => setPlacement(p => ({ ...p, scale: Number(e.target.value) }))} /></label>
        <label>Move <input type="range" min={-400} max={400} step={2} value={placement.dx} onChange={e => setPlacement(p => ({ ...p, dx: Number(e.target.value) }))} /></label>
        <button onClick={() => { viewer.current?.setAngle(0); setPlacement({ dx: 0, dy: 0, scale: 1 }); setAutoplay(false) }}>Reset</button>
        <button className="s2-cta" disabled={!asset} onClick={async () => setShot(await viewer.current!.snapshot())}>Save postcard</button>
      </div>
      {shot && <div className="s2-shot" onClick={() => setShot(null)}><figure onClick={e => e.stopPropagation()}><img src={shot} alt="Postcard" />
        <figcaption>{job?.provenance === 'fixture' ? 'FIXTURE preview, not your outfit. ' : ''}AI-generated image composited on a real photo ({bg.credit.author}, {bg.credit.license}). Illustrative, not a fit guarantee. <a href={shot} download="roamfit-postcard.png">Download</a> · <button onClick={() => setShot(null)}>Close</button></figcaption></figure></div>}
    </main>

    <WardrobeSidebar index={index} looks={looks} gaps={input.outfitPlan?.shoppingGaps ?? []} selection={sel.state} notice={sel.notice}
      onToggle={g => dispatch({ t: 'apply', r: toggleGarment(sel.state, g, index) })}
      onUseLook={l => dispatch({ t: 'apply', r: applyLook(l, index) })}
      onLayering={on => dispatch({ t: 'apply', r: setTopLayering(sel.state, on, index) })}
      onAddShopify={onAddShopify}
      validation={draft.errors} generate={{ ...genState, onClick: generate }} />
  </div>
}
