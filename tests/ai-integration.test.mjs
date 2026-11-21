import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWebServer } from '../apps/web/server.mjs';
import { prepareAiOutfitRequest } from '../apps/web/ai-outfits.mjs';
import { photoWardrobe, photoWardrobeVersion } from '../data/demo-wardrobe/photo-wardrobe.mjs';
import { buildStyleProfile } from '../packages/contracts/style-profile.mjs';
import { buildTrip } from '../packages/contracts/trip.mjs';
import { validateOutfitResponse } from '../packages/contracts/outfit-plans.mjs';
import { catalog } from '../data/attractions/catalog.mjs';
import { mockOutfits } from '../scripts/mock-outfits.mjs';
const input = () => ({ requestId:'live-contract', inputRevision:2,
  styleProfile:buildStyleProfile({summary:'Relaxed neutrals.',directions:[{id:'dir-1',name:'Relaxed tailoring',description:'Edited roomy layers.',strength:'dominant',source:'media',visualReferenceIds:['photo-1'],colors:['cream'],silhouettes:['wide-leg'],stylingPatterns:['tonal layers'],keyPieces:['blazer']}],userTags:['comfortable'],avoidances:[]}),
  trip:buildTrip(catalog[1].destination,'2026-11-25','2026-11-27',[{id:'museum',name:'Louvre Museum',source:'user',activityTags:[]}]),
  wardrobeVersion:photoWardrobeVersion,wardrobe:photoWardrobe.filter(item=>['wd-01','wd-04','wd-06'].includes(item.id)),media:[] });
async function app(t, options = {}) {
  const server=createWebServer({provider:'live',aiBaseUrl:'http://127.0.0.1:8001',token:'only-server-token',publicAppUrl:'http://127.0.0.1:3000',...options});
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  return `http://127.0.0.1:${server.address().port}`;
}
const post=(base,body=input())=>fetch(base+'/api/outfit-plans',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

test('live adapter preserves user style grouping, trip-level places and sets exactly one look per day',()=>{
  for (const end of ['2026-11-25','2026-11-27','2026-12-01']) {
    const request=input();request.trip=buildTrip(catalog[1].destination,'2026-11-25',end,request.trip.attractions);
    const prepared=prepareAiOutfitRequest(request,'https://app.example');
    assert.equal(prepared.outfitCount,request.trip.weather.length); assert.equal(prepared.useWardrobeImages,true);
    assert.deepEqual(prepared.styleProfile,request.styleProfile);assert.deepEqual(prepared.trip,request.trip);
    assert.match(prepared.preferences,/Edited roomy layers/);assert.match(prepared.preferences,/"keyPieces":\["blazer"\]/);
    assert.match(prepared.preferences,/keep outfit attractionIds empty/);
    assert.ok(prepared.wardrobe.every(item=>item.imageUrl.startsWith('https://app.example/wardrobe-photos/')));
    assert.ok(request.wardrobe.every(item=>item.imageUrl.startsWith('/')));
    assert.equal(request.trip.attractions[0].date,undefined);
  }
  assert.throws(()=>prepareAiOutfitRequest(input(),'http://external.example'));
  assert.throws(()=>prepareAiOutfitRequest(input(),'https://user:password@app.example'));
});

test('B sends photo wardrobe and nested preferences to A with auth; A missing items survive unchanged',async t=>{
  const request=input();let sent;
  const upstream=mockOutfits(request);upstream.model='test-A-model';upstream.wardrobeImagesUsed=request.wardrobe.map(item=>item.id);
  upstream.warnings=['A long but legitimate warning. '.repeat(8)];
  upstream.outfits[0].stylingTips=['A complete styling explanation that is longer than a tag. '.repeat(5)];
  const base=await app(t,{fetchImpl:async(url,options)=>{
    assert.equal(url,'http://127.0.0.1:8001/v1/outfit-plans');assert.equal(options.headers.Authorization,'Bearer only-server-token');
    sent=JSON.parse(options.body);return Response.json(upstream);
  }});
  const inventory=await(await fetch(base+'/api/wardrobe')).json();
  assert.equal(inventory.provider,'live');assert.equal(inventory.enabled,true);assert.equal(inventory.wardrobe.length,10);
  assert.equal(inventory.credits.length,10);
  const photo=await fetch(base+inventory.wardrobe[0].imageUrl);assert.match(photo.headers.get('Content-Type'),/image\/jpeg/);
  assert.deepEqual([...new Uint8Array(await photo.arrayBuffer()).slice(0,3)],[255,216,255]);
  const response=await post(base,request);assert.equal(response.status,200);const result=await response.json();
  assert.equal(sent.outfitCount,3);assert.equal(sent.useWardrobeImages,true);assert.match(sent.preferences,/Relaxed tailoring/);
  assert.deepEqual(result.outfits.flatMap(o=>o.missingItems),upstream.outfits.flatMap(o=>o.missingItems));
  assert.deepEqual(result.wardrobeImagesUsed,request.wardrobe.map(item=>item.id));validateOutfitResponse(result,request);
});

test('live responses reject missing trip days and invented photo-use IDs; timeouts never become mock outfits',async t=>{
  const request=input();const result=mockOutfits(request);
  assert.throws(()=>validateOutfitResponse({...result,wardrobeImagesUsed:['not-selected']},request));
  const repeated=structuredClone(result);repeated.outfits[1].date=repeated.outfits[0].date;
  assert.throws(()=>validateOutfitResponse(repeated,request));
  const base=await app(t,{outfitTimeoutMs:10,fetchImpl:async(_,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason)))});
  const response=await post(base,request);const body=await response.json();
  assert.equal(response.status,504);assert.equal(body.error.code,'AI_TIMEOUT');assert.match(body.error.message,/Outfit generation/);assert.equal(body.outfits,undefined);
});
