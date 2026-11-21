import { useEffect, useState } from 'react'
import { ExploreScene } from './ExploreScene'
import { createTryOn, getProducts } from './api'
import { outfits } from './data'
import type { DestinationId, ProductRecommendation, TryOnResult } from './types'
import './styles.css'

const destinations: {id:DestinationId;name:string;eyebrow:string}[] = [
  {id:'amalfi',name:'Amalfi Coast',eyebrow:'Salt air · Golden hour'},
  {id:'tokyo',name:'Tokyo After Dark',eyebrow:'Neon rain · Night market'},
]

export default function App() {
  const [outfitIndex,setOutfitIndex]=useState(0), [destination,setDestination]=useState<DestinationId>('amalfi')
  const [products,setProducts]=useState<ProductRecommendation[]>([]), [shopMode,setShopMode]=useState('demo')
  const [photo,setPhoto]=useState<string>(''), [result,setResult]=useState<TryOnResult|null>(null), [loading,setLoading]=useState(false), [error,setError]=useState('')
  const outfit=outfits[outfitIndex], place=destinations.find(d=>d.id===destination)!
  useEffect(()=>{ getProducts(outfit.id,destination).then(r=>{setProducts(r.products);setShopMode(r.mode)}).catch(e=>setError(e.message)) },[outfit.id,destination])
  function upload(file?:File){ if(!file)return; const reader=new FileReader();reader.onload=()=>setPhoto(String(reader.result));reader.readAsDataURL(file) }
  async function generate(){setLoading(true);setError('');try{setResult(await createTryOn({personImage:photo||'demo',outfitId:outfit.id,destinationId:destination,productIds:products.map(p=>p.id)}))}catch(e){setError(e instanceof Error?e.message:'Generation failed')}finally{setLoading(false)}}
  return <main>
    <header><a className="brand">ROAM<span>FIT</span></a><nav><button className="active">Explore</button><button onClick={()=>document.querySelector('#tryon')?.scrollIntoView({behavior:'smooth'})}>AI postcard</button></nav><div className="live"><i/> Hackathon build</div></header>
    <section className="hero">
      <div className="scene"><ExploreScene outfit={outfit}/><div className="scene-label"><span>EXPLORE MODE</span><strong>{place.name}</strong><small>Drag to orbit · Scroll to zoom</small></div></div>
      <aside className="panel">
        <p className="kicker">Dress for where you're going</p><h1>See the trip.<br/><em>Wear the feeling.</em></h1><p className="lede">Explore a curated destination in 3D, then step into a photorealistic travel moment with an outfit you can actually shop.</p>
        <label>Destination</label><div className="destinations">{destinations.map(d=><button key={d.id} className={destination===d.id?'selected':''} onClick={()=>setDestination(d.id)}><small>{d.eyebrow}</small>{d.name}</button>)}</div>
        <label>Authored 3D outfit <b>{outfitIndex+1} / {outfits.length}</b></label><div className="outfit-card"><button aria-label="Previous outfit" onClick={()=>setOutfitIndex((outfitIndex+1)%2)}>‹</button><div className="swatch" style={{background:`linear-gradient(135deg,${outfit.colors.top} 50%,${outfit.colors.bottom} 50%)`}}/><div><strong>{outfit.name}</strong><small>{outfit.note}</small></div><button aria-label="Next outfit" onClick={()=>setOutfitIndex((outfitIndex+1)%2)}>›</button></div>
        <button className="primary" onClick={()=>document.querySelector('#tryon')?.scrollIntoView({behavior:'smooth'})}>Create destination look</button><p className="truth">3D looks are pre-authored for this avatar — product photos are recommendation references, not auto-generated GLB garments.</p>
      </aside>
    </section>
    <section id="tryon" className="studio"><div><p className="kicker">Photorealistic mode</p><h2>Your vacation, before takeoff.</h2><p>Upload a front-facing photo. Gemini plans the styling, edits the destination portrait, then runs an identity and garment fidelity check.</p><label className="upload">{photo?<img src={photo}/>:<><b>＋</b><span>Add a clear, front-facing photo</span><small>JPG or PNG · demo mode works without one</small></>}<input type="file" accept="image/*" onChange={e=>upload(e.target.files?.[0])}/></label><button className="primary" onClick={generate} disabled={loading}>{loading?'Building your travel moment…':'Generate AI destination try-on'}</button>{error&&<p className="error">{error}</p>}</div>
      <div className="result">{result?<><img src={result.imageUrl}/><div className="score"><b>{result.mode==='demo'?'DEMO RESULT':'LIVE RESULT'}</b><span>Identity {Math.round(result.qa.identity*100)}%</span><span>Garment {Math.round(result.qa.garment*100)}%</span><span>Scene {Math.round(result.qa.background*100)}%</span></div></>:<div className="placeholder"><span>AI</span><p>Your generated destination portrait appears here</p></div>}</div>
    </section>
    <section className="shop"><div className="section-head"><div><p className="kicker">Shop the edit</p><h2>Pieces that travel well.</h2></div><span>{shopMode==='live'?'Live Shopify Storefront API':'Demo catalog · connect shop.dev'}</span></div><div className="products">{products.map(p=><article key={p.id}>{p.imageUrl?<img src={p.imageUrl}/>:<div className="product-art"/>}<small>{p.reason}</small><h3>{p.title}</h3><p>{p.currency} {p.price}</p>{p.productUrl&&<a href={p.productUrl} target="_blank">View in store</a>}</article>)}</div></section>
    <footer><strong>ROAMFIT</strong><span>3D to imagine · AI to see yourself · Shopify to make it real</span></footer>
  </main>
}
