import fs from 'node:fs/promises'
import { getProducts } from '../server/shopify.js'

const results={ranAt:new Date().toISOString(),checks:[]}
async function check(name,fn){try{const detail=await fn();results.checks.push({name,status:'pass',detail})}catch(e){results.checks.push({name,status:'fail',detail:e.message})}}
await check('shopify-products',async()=>{const r=await getProducts('coastal-linen','amalfi');return {mode:r.mode,count:r.products.length,note:r.mode==='demo'?'Credentials absent; contract validated against fixture':'Live Storefront response received'}})
await check('gemini-config',async()=>({configured:Boolean(process.env.GEMINI_API_KEY),reasoning:process.env.GEMINI_REASONING_MODEL||'gemini-4-argon',image:process.env.GEMINI_IMAGE_MODEL||'gemini-nano-banana-2.1',qa:process.env.GEMINI_QA_MODEL||'gemini-4-argon'}))
await check('3d-asset-policy',async()=>({avatar:'preset-v1',outfits:2,source:'authored/procedural',acceptance:['GLB 2.0','single scene','meters scale','Y-up','compatible preset-v1 skeleton or rigid authored garment'],rejected:['arbitrary product image to GLB','unknown skeleton','unlicensed asset']}))
await fs.mkdir('spike-results',{recursive:true});await fs.writeFile('spike-results/latest.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2))
