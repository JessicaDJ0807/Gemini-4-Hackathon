import { useCallback, useMemo, useRef, useState } from 'react'
import { Stage, type Framing } from './Stage'
import { DEFAULT_LOOK, type Appearance, type HairStyle } from './avatar/AvatarModel'
import { buildBody, DEFAULTS, type Measurements } from './avatar/bodyModel'
import { byId, GARMENTS, OUTFITS, type Slot, type Worn } from './wardrobe/catalog'
import type { TimeOfDay } from './travel/VacationScene'
import { compareFit, suggestSize, toCm, fromCm, round1 } from '../../shared/fit.js'
import './studio.css'

type Unit = 'cm' | 'in'
type FieldKey = keyof Measurements
const FIELDS: { key: FieldKey; label: string; min: number; max: number; advanced?: boolean }[] = [
  { key: 'heightCm', label: 'Height', min: 140, max: 205 },
  { key: 'bustCm', label: 'Chest / bust', min: 70, max: 140 },
  { key: 'waistCm', label: 'Waist', min: 55, max: 130 },
  { key: 'hipCm', label: 'Hip', min: 75, max: 145 },
  { key: 'inseamCm', label: 'Inseam', min: 60, max: 95 },
  { key: 'shoulderCm', label: 'Shoulder width', min: 32, max: 52, advanced: true },
  { key: 'sleeveCm', label: 'Sleeve (shoulder→wrist)', min: 48, max: 70, advanced: true },
  { key: 'thighCm', label: 'Thigh', min: 40, max: 80, advanced: true },
  { key: 'neckCm', label: 'Neck', min: 28, max: 46, advanced: true },
]
const PROFILES: { name: string; m: Measurements }[] = [
  { name: 'Profile A', m: { heightCm: 168, bustCm: 88, waistCm: 70, hipCm: 96, inseamCm: 77, shoulderCm: null, sleeveCm: null, thighCm: null, neckCm: null } },
  { name: 'Profile B', m: { heightCm: 181, bustCm: 104, waistCm: 90, hipCm: 104, inseamCm: 83, shoulderCm: 46, sleeveCm: 63, thighCm: 60, neckCm: 39 } },
]
const SKINS = ['#f6d9c4', '#ecc4a6', '#d9a47f', '#c08560', '#9b6643', '#7a4b31', '#5a3523', '#3f2518']
const HAIR_COLORS = ['#1e1a18', '#4a3022', '#8a5a3b', '#c48a52', '#e2c08a', '#b6462e', '#9c9c9c', '#e9e4dc']
const HAIR_STYLES: HairStyle[] = ['long', 'bob', 'bun', 'short', 'curly']
const TINTS = ['#ffffff', '#f0d7c8', '#cfe0d6', '#d6dcef', '#efe2b8']
const SLOT_LABEL: Record<Slot, string> = { top: 'Top', bottom: 'Bottom', outer: 'Layer', shoes: 'Shoes' }

function initialSizes(m: Measurements) {
  return Object.fromEntries(GARMENTS.filter(g => Object.keys(g.sizeChart.sizes).length).map(g => [g.id, suggestSize(fitBody(m), g).size ?? 'M']))
}
/** Only measurements the user actually provided go to the fit engine — estimated values never do. */
function fitBody(m: Measurements) {
  return { bustCm: m.bustCm ?? null, waistCm: m.waistCm ?? null, hipCm: m.hipCm ?? null, inseamCm: m.inseamCm ?? null, thighCm: m.thighCm ?? null, sleeveCm: m.sleeveCm ?? null }
}

export default function StudioApp() {
  const [m, setM] = useState<Measurements>(PROFILES[0].m)
  const [unit, setUnit] = useState<Unit>('cm')
  const [showAdv, setShowAdv] = useState(false)
  const [leftTab, setLeftTab] = useState<'body' | 'look'>('body')
  const [look, setLook] = useState<Appearance>(DEFAULT_LOOK)
  const [worn, setWorn] = useState<Worn>(OUTFITS[0].worn)
  const [sizes, setSizes] = useState<Record<string, string>>(() => initialSizes(PROFILES[0].m))
  const [tints, setTints] = useState<Record<string, string>>({})
  const [time, setTime] = useState<TimeOfDay>('golden')
  const [framing, setFraming] = useState<Framing>('full')
  const [nonce, setNonce] = useState(0)
  const [yaw, setYaw] = useState(0)
  const [spin, setSpin] = useState(false)
  const [orbit, setOrbit] = useState(false)
  const [notes, setNotes] = useState<string[]>([])
  const [focus, setFocus] = useState<string>(OUTFITS[0].worn.bottom!)
  const [shot, setShot] = useState<string | null>(null)
  const capture = useRef<() => string>(() => '')
  const registerCapture = useCallback((fn: () => string) => { capture.current = fn }, [])
  const onNotes = useCallback((n: string[]) => setNotes(n), [])

  const derived = useMemo(() => buildBody(m).derived, [m])
  const body = fitBody(m)
  const setField = (k: FieldKey, raw: string) => {
    const v = raw === '' ? null : toCm(Number(raw), unit)
    setM(prev => ({ ...prev, [k]: v == null ? (FIELDS.find(f => f.key === k)!.advanced ? null : prev[k]) : Math.round(v * 10) / 10 }))
  }
  const show = (v: number | null | undefined) => (v == null ? '' : String(round1(fromCm(v, unit))))
  const wearOutfit = (o: typeof OUTFITS[number]) => { setWorn(o.worn); setFocus(o.worn.bottom ?? o.worn.top ?? '') }
  const toggle = (slot: Slot, id: string) => { setWorn(w => ({ ...w, [slot]: w[slot] === id && (slot === 'outer' || slot === 'shoes') ? null : id })); setFocus(id) }
  const focusG = byId[focus]
  const fit = focusG ? compareFit(body, focusG, sizes[focusG.id]) : null
  const suggestion = focusG ? suggestSize(body, focusG) : null
  const reset = () => { setFraming('full'); setNonce(n => n + 1); setYaw(0); setSpin(false); setOrbit(false) }

  return <div className="rf-studio">
    <header className="st-head">
      <div className="st-brand">ROAM<span>FIT</span><em>Fitting Room</em></div>
      <p className="st-promise">See your little self, dressed for wherever you're going.</p>
      <div className="st-status"><i /> Live 3D · all assets procedural · no photos sent</div>
    </header>

    <aside className="st-left">
      <div className="st-tabs"><button className={leftTab === 'body' ? 'on' : ''} onClick={() => setLeftTab('body')}>Body</button><button className={leftTab === 'look' ? 'on' : ''} onClick={() => setLeftTab('look')}>Look</button></div>
      {leftTab === 'body' ? <>
        <div className="st-row"><div className="st-chips">{PROFILES.map(p => <button key={p.name} onClick={() => { setM(p.m); setSizes(initialSizes(p.m)) }}>{p.name}</button>)}</div>
          <div className="st-unit">{(['cm', 'in'] as Unit[]).map(u => <button key={u} className={unit === u ? 'on' : ''} onClick={() => setUnit(u)}>{u}</button>)}</div></div>
        {FIELDS.filter(f => !f.advanced || showAdv).map(f => {
          const val = m[f.key] as number | null | undefined
          const est = derived[f.key as string]
          return <label key={f.key} className="st-field">
            <span>{f.label}<b title="Changes the 3D geometry">shapes 3D</b></span>
            <div><input type="range" min={f.min} max={f.max} step={0.5} value={val ?? est?.value ?? f.min} onChange={e => setM(prev => ({ ...prev, [f.key]: Number(e.target.value) }))} />
              <input type="number" step={0.1} value={show(val)} placeholder={est ? `≈${show(est.value)}` : ''} onChange={e => setField(f.key, e.target.value)} /><small>{unit}</small></div>
            {f.advanced && val == null && <em>estimated from your other measurements, not used in fit</em>}
          </label>
        })}
        <button className="st-link" onClick={() => setShowAdv(s => !s)}>{showAdv ? '− Fewer measurements' : '+ Shoulder, sleeve, thigh, neck'}</button>
        <p className="st-fine">Simplified body: the bust, waist, hip, thigh and neck circumferences and the height, inseam and sleeve lengths set the 3D shape. The head is stylised ×1.35. It is not a body scan.</p>
      </> : <>
        <h4>Skin tone</h4><div className="st-swatches">{SKINS.map(c => <button key={c} style={{ background: c }} className={look.skin === c ? 'on' : ''} onClick={() => setLook(l => ({ ...l, skin: c }))} aria-label={`Skin tone ${c}`} />)}</div>
        <h4>Hair</h4><div className="st-chips">{HAIR_STYLES.map(h => <button key={h} className={look.hairStyle === h ? 'on' : ''} onClick={() => setLook(l => ({ ...l, hairStyle: h }))}>{h}</button>)}</div>
        <div className="st-swatches">{HAIR_COLORS.map(c => <button key={c} style={{ background: c }} className={look.hairColor === c ? 'on' : ''} onClick={() => setLook(l => ({ ...l, hairColor: c }))} aria-label={`Hair ${c}`} />)}</div>
        <h4>Details</h4><div className="st-chips">
          {(['fringe', 'glasses', 'earrings'] as const).map(k => <button key={k} className={look[k] ? 'on' : ''} onClick={() => setLook(l => ({ ...l, [k]: !l[k] }))}>{k}</button>)}
        </div>
        <div className="st-photo"><b>Photo personalisation</b><span>Upload a photo and Gemini 4 suggests hair and accessory settings, which you can then edit. Not connected yet: it needs your consent to send the photo to Google.</span></div>
      </>}
    </aside>

    <main className="st-stage">
      <Stage measurements={m} look={look} worn={worn} sizes={sizes} tints={tints} time={time} framing={framing} framingNonce={nonce} yaw={yaw} spin={spin} orbit={orbit} onNotes={onNotes} registerCapture={registerCapture} />
      <div className="st-place"><span>DESTINATION</span><strong>Old Montréal</strong><small>3D street set · drag to orbit · scroll to zoom</small></div>
      <div className="st-hud">
        <div className="st-seg">{(['full', 'upper', 'shoes', 'wide'] as Framing[]).map(f => <button key={f} className={framing === f ? 'on' : ''} onClick={() => { setFraming(f); setNonce(n => n + 1) }}>{f}</button>)}</div>
        <label className="st-turn">Turn <input type="range" min={-180} max={180} value={yaw} onChange={e => { setSpin(false); setYaw(Number(e.target.value)) }} /></label>
        <div className="st-seg">
          <button className={spin ? 'on' : ''} onClick={() => setSpin(s => !s)}>spin</button>
          <button className={orbit ? 'on' : ''} onClick={() => setOrbit(o => !o)}>orbit</button>
          <button onClick={reset}>reset</button>
        </div>
        <div className="st-seg">{(['golden', 'midday'] as TimeOfDay[]).map(t => <button key={t} className={time === t ? 'on' : ''} onClick={() => setTime(t)}>{t}</button>)}</div>
        <button className="st-capture" onClick={() => setShot(capture.current())}>Capture postcard</button>
      </div>
      {shot && <div className="st-shot" onClick={() => setShot(null)}><figure onClick={e => e.stopPropagation()}><img src={shot} alt="Captured postcard" /><figcaption>Illustrative 3D preview, not a fit guarantee. <a href={shot} download="roamfit-montreal.png">Download PNG</a> · <button onClick={() => setShot(null)}>Close</button></figcaption></figure></div>}
    </main>

    <aside className="st-right">
      <h3>Wardrobe</h3>
      <div className="st-outfits">{OUTFITS.map(o => <button key={o.id} onClick={() => wearOutfit(o)} className={JSON.stringify(worn) === JSON.stringify(o.worn) ? 'on' : ''}><strong>{o.name}</strong><small>{o.note}</small></button>)}</div>
      {(['top', 'bottom', 'outer', 'shoes'] as Slot[]).map(slot => <div key={slot} className="st-slot">
        <h4>{SLOT_LABEL[slot]}{(slot === 'outer' || slot === 'shoes') && <small> · tap again to remove</small>}</h4>
        <div className="st-garments">{GARMENTS.filter(g => g.slot === slot).map(g => <button key={g.id} className={`${worn[slot] === g.id ? 'on' : ''} ${focus === g.id ? 'focus' : ''}`} onClick={() => toggle(slot, g.id)}>
          <i style={{ background: g.pattern.b ? `linear-gradient(135deg, ${g.pattern.a} 50%, ${g.pattern.b} 50%)` : g.pattern.a }} /><span>{g.name}<small>{g.blurb}</small></span>
        </button>)}</div>
      </div>)}

      {focusG && <div className="st-fit">
        <div className="st-fit-head"><strong>{focusG.name}</strong><span className={`prov ${focusG.sizeChart.provenance}`}>{{ 'finished-garment': 'Garment measurements', 'body-size-range': 'Body size ranges only', none: 'No size chart' }[focusG.sizeChart.provenance]}</span></div>
        {Object.keys(focusG.sizeChart.sizes).length > 0 && <div className="st-sizes">
          {Object.keys(focusG.sizeChart.sizes).map(s => <button key={s} className={sizes[focusG.id] === s ? 'on' : ''} onClick={() => setSizes(z => ({ ...z, [focusG.id]: s }))}>{s}{suggestion?.size === s && <i>★</i>}</button>)}
        </div>}
        {suggestion?.size && <p className="st-suggest">★ Suggested: <b>{suggestion.size}</b>. {suggestion.reason}</p>}
        {fit && fit.rows.length > 0 && <table><thead><tr><th></th><th>You</th><th>{fit.provenance === 'body-size-range' ? 'Size range' : 'Garment'}</th><th>Ease</th></tr></thead><tbody>
          {fit.rows.map(r => <tr key={r.dim} title={r.note}><td>{r.label}</td><td>{r.body == null ? '—' : `${show(r.body)}`}</td><td>{r.range ? `${show(r.range[0])}–${show(r.range[1])}` : show(r.garment)}</td>
            <td><span className={`v v-${String(r.verdict).replace(/[^a-z]+/g, '-')}`}>{r.ease == null ? r.verdict : `${r.ease > 0 ? '+' : ''}${show(r.ease)} · ${r.verdict}`}</span></td></tr>)}
        </tbody></table>}
        {[...(fit?.warnings ?? []), ...notes.filter(n => n.startsWith(focusG.name))].map((w: string) => <p key={w} className="st-warn">{w}</p>)}
        <div className="st-tint">{TINTS.map(c => <button key={c} style={{ background: c }} className={(tints[focusG.id] ?? '#ffffff') === c ? 'on' : ''} onClick={() => setTints(t => ({ ...t, [focusG.id]: c }))} aria-label={`Tint ${c}`} />)}<span>tint</span></div>
        <p className="st-fine">{focusG.material}. Size source: {focusG.sizeChart.source}. Ease is the garment measurement minus your body measurement, in {unit}. The 3D drape is illustrative (circumference-based, no cloth physics) and not a fit guarantee.</p>
      </div>}

      <div className="st-shop"><h4>Shop the look</h4><p>Shopify is not connected: add the store domain and token in <code>.env</code>. Only real catalogue results will be shown here, never placeholders presented as real products.</p></div>
    </aside>
  </div>
}

export { DEFAULTS }
