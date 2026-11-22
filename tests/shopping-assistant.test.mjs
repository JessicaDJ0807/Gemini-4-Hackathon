import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShoppingAssistant } from '../apps/web/shopping-assistant.mjs';
import { assertAiCompatibility } from '../scripts/ai-compatibility.mjs';
const body={requestId:'chat-one',inputRevision:1,message:'a blue jacket under USD 100',lastQuery:'linen jacket'};
test('chat uses a structured search query, preserves identity and never grants the model payment tools',async()=>{
  let searched;
  const service=createShoppingAssistant({apiKey:'test-gemini-key',fetchImpl:async(url,options)=>{
    assert.equal(options.headers['x-goog-api-key'],'test-gemini-key'); const request=JSON.parse(options.body);
    assert.equal(request.tools,undefined); assert.deepEqual(JSON.parse(request.contents[0].parts[0].text),{message:body.message,previousQuery:body.lastQuery});
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({reply:'Let’s find a blue jacket.',query:'blue linen jacket under USD 100'})}]}}]});
  },searchProducts:async request=>{searched=request;return {products:[]};}});
  const result=await service(body); assert.equal(result.requestId,body.requestId); assert.equal(searched.missingItem.searchQuery,'blue linen jacket under USD 100');
});
test('likely payment/contact details and malformed messages never reach Gemini or Shop',async()=>{
  let calls=0; const service=createShoppingAssistant({apiKey:'test',fetchImpl:async()=>{calls++;},searchProducts:async()=>{calls++;}});
  for(const message of ['4111 1111 1111 1111','４１１１ １１１１ １１１１ １１１１','cvv 123','me@example.com','']) await assert.rejects(service({...body,message}));
  await assert.rejects(service({...body,lastQuery:'4111-1111-1111-1111'})); assert.equal(calls,0);
});
test('clarifications skip search; provider failures never invent listings',async()=>{
  let calls=0; const options={apiKey:'test',searchProducts:async()=>{calls++;},fetchImpl:async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'{"reply":"What kind of piece?","query":""}'}]}}]})};
  assert.equal((await createShoppingAssistant(options)(body)).search,null); assert.equal(calls,0);
  await assert.rejects(createShoppingAssistant({...options,fetchImpl:async()=>Response.json({error:'private-provider-detail'},{status:500})})(body),error=>!error.message.includes('private-provider-detail'));
  await assert.rejects(createShoppingAssistant({...options,apiKey:''})(body),/unavailable/);
});
test('live startup rejects A without native directions and accepts the combined schema',async()=>{
  const schema=properties=>async()=>Response.json({components:{schemas:{StyleProfile:{properties}}}});
  await assert.rejects(assertAiCompatibility('http://127.0.0.1:8001',schema({styleTags:{}})),/PR #5/);
  await assertAiCompatibility('http://127.0.0.1:8001',schema({directions:{},userTags:{},summary:{}}));
  await assert.rejects(assertAiCompatibility('http://127.0.0.1:8001',async()=>{throw Error();}),/Cannot read/);
});
