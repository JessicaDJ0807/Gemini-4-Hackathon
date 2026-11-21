const API = 'https://generativelanguage.googleapis.com/v1beta'
const reasoningModel = () => process.env.GEMINI_REASONING_MODEL || 'gemini-4-argon'
const qaModel = () => process.env.GEMINI_QA_MODEL || 'gemini-4-argon'
const imageModel = () => process.env.GEMINI_IMAGE_MODEL || 'gemini-nano-banana-2.1'

async function interact(model, input) {
  const started = Date.now()
  const response = await fetch(`${API}/interactions`, {method:'POST',headers:{'content-type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},body:JSON.stringify({model,input})})
  const json = await response.json()
  if (!response.ok) throw new Error(json.error?.message || `Gemini ${response.status}`)
  return { json, latencyMs:Date.now()-started }
}

function outputText(json) {
  return json.output_text || json.steps?.flatMap(s=>s.content||[]).find(c=>c.type==='text')?.text || ''
}
function parseJson(text, fallback) {
  try { return JSON.parse(text.replace(/^```json\s*|\s*```$/g,'')) } catch { return fallback }
}

export async function planTryOn({outfitId,destinationId,products}) {
  const prompt = `You are the styling planner for a vacation virtual try-on. Create a precise image-edit plan for outfit=${outfitId}, destination=${destinationId}, products=${JSON.stringify(products)}. Return JSON only: {"stylingIntent":"...","preserve":["..."],"avoid":["..."]}. Preserve identity, body proportions, garment construction, logos, and face. Do not claim physical fit accuracy.`
  const {json,latencyMs}=await interact(reasoningModel(),[{type:'text',text:prompt}])
  return { value:parseJson(outputText(json),{stylingIntent:`${outfitId} in ${destinationId}`,preserve:['face','body proportions','garment silhouette'],avoid:['identity drift','invented logos']}), trace:{role:'Gemini 4 styling planner',model:reasoningModel(),latencyMs} }
}

export async function generateImage({personImage,plan,destinationId,outfitId}) {
  const prompt = `Edit the supplied person into a photorealistic full-body travel editorial in ${destinationId}. Outfit direction: ${outfitId}. ${plan.stylingIntent}. Preserve: ${plan.preserve.join(', ')}. Avoid: ${plan.avoid.join(', ')}. Natural vacation lighting, believable fabric, no text, no changed face.`
  const input=[{type:'text',text:prompt}]
  if(personImage && personImage!=='demo') { const match=personImage.match(/^data:(.*?);base64,(.*)$/); if(match) input.push({type:'image',mime_type:match[1],data:match[2]}) }
  const {json,latencyMs}=await interact(imageModel(),input)
  const image=json.output_image || json.steps?.flatMap(s=>s.content||[]).find(c=>c.type==='image')
  if(!image) throw new Error('Image model returned no image')
  const data=image.data || image; const mime=image.mime_type || 'image/png'
  return { imageUrl:`data:${mime};base64,${data}`, trace:{role:'Gemini image editor',model:imageModel(),latencyMs} }
}

export async function inspectResult({personImage,resultImage,outfitId,destinationId}) {
  const prompt=`Compare the reference person and generated image. Evaluate identity preservation, outfit fidelity to ${outfitId}, and scene fidelity to ${destinationId}. Return JSON only: {"pass":true,"identity":0.0,"garment":0.0,"background":0.0,"notes":["..."]}. Fail if identity or garment < 0.72.`
  const input=[{type:'text',text:prompt}]
  for(const dataUrl of [personImage,resultImage]) { const m=dataUrl?.match(/^data:(.*?);base64,(.*)$/); if(m) input.push({type:'image',mime_type:m[1],data:m[2]}) }
  const {json,latencyMs}=await interact(qaModel(),input)
  return { value:parseJson(outputText(json),{pass:false,identity:0,garment:0,background:0,notes:['Could not parse QA response']}), trace:{role:'Gemini 4 visual QA judge',model:qaModel(),latencyMs} }
}
