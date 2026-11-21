import express from 'express'
import { getProducts } from './shopify.js'
import { generateImage, inspectResult, planTryOn } from './gemini.js'
import { studioRouter } from './avatar3d/routes.js'
import { previewRouter } from './preview/routes.js'
import { sceneRouter } from './scene/routes.js'

const app=express(); app.use(sceneRouter()); app.use(studioRouter()); app.use(previewRouter()); app.use(express.json({limit:'15mb'}))
app.get('/api/health',(_,res)=>res.json({ok:true,gemini:Boolean(process.env.GEMINI_API_KEY),shopify:Boolean(process.env.SHOPIFY_STORE_DOMAIN&&process.env.SHOPIFY_STOREFRONT_TOKEN)}))
app.get('/api/products',async(req,res)=>{try{res.json(await getProducts(req.query.outfitId,req.query.destinationId))}catch(e){res.status(502).json({error:e.message})}})
app.post('/api/try-on',async(req,res)=>{try{
  const {personImage='demo',outfitId,destinationId}=req.body
  if(!['coastal-linen','city-night'].includes(outfitId)||!['amalfi','tokyo'].includes(destinationId)) return res.status(400).json({error:'Invalid outfit or destination'})
  if(!process.env.GEMINI_API_KEY) return res.json({imageUrl:personImage==='demo'?'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=85':personImage,mode:'demo',plan:{stylingIntent:`A ${outfitId} editorial in ${destinationId}`,preserve:['identity','body proportions','garment silhouette'],avoid:['identity drift','fake fit claims']},qa:{pass:true,identity:.91,garment:.86,background:.94,notes:['Demo scores are fixtures, not model measurements']},trace:[{role:'Gemini 4 styling planner',model:'demo fixture',latencyMs:0},{role:'Gemini image editor',model:'demo fixture',latencyMs:0},{role:'Gemini 4 visual QA judge',model:'demo fixture',latencyMs:0}]})
  const products=(await getProducts(outfitId,destinationId)).products
  const plan=await planTryOn({outfitId,destinationId,products})
  const generated=await generateImage({personImage,plan:plan.value,destinationId,outfitId})
  const qa=await inspectResult({personImage,resultImage:generated.imageUrl,outfitId,destinationId})
  res.json({imageUrl:generated.imageUrl,mode:'live',plan:plan.value,qa:qa.value,trace:[plan.trace,generated.trace,qa.trace]})
}catch(e){res.status(502).json({error:e.message})}})
app.listen(Number(process.env.PORT||8787),()=>console.log(`API listening on http://localhost:${process.env.PORT||8787}`))
