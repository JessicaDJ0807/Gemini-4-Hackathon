import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createShopCheckout } from '../apps/web/shop-checkout.mjs';
import { createShopPay } from '../apps/web/shop-pay.mjs';
import { createShopAccounts } from '../apps/web/shop-account.mjs';
import { shopRpc } from '../apps/web/shop-rpc.mjs';
import { createWebServer } from '../apps/web/server.mjs';
import { walletDocument, walletAccount } from './fixtures/shop-wallet.mjs';

function harness() {
  const state = { accessToken: 'test-session-token', checkouts: new Map() }, calls = [];
  let doc = walletDocument(), completeError = false, readError = false, gate;
  const signer = createShopCheckout();
  const accounts = { token(s) { if (!s?.accessToken) throw Error('Connect Shop'); return s.accessToken; }, async account(s) { s.addresses = walletAccount().addresses; } };
  const service = createShopPay({ accounts, prepareCheckout: signer.prepare, rpc: async (name, args, token) => {
    assert.equal(token, state.accessToken); calls.push({name,args});
    if (name === 'get_checkout' && readError) throw Error('offline');
    if (name === 'complete_checkout') { if (gate) await gate; if (completeError) throw Error('timeout'); doc.status = 'completed'; doc.order = {id:'order-one'}; }
    if (name === 'update_checkout') doc = structuredClone(args.checkout);
    return structuredClone(doc);
  } });
  const body = { requestId: randomUUID(), items: [{ offerToken: signer.issueOffer('merchant.myshopify.com','exact-variant'), quantity:1 }] };
  return { state, calls, service, body, get doc() { return doc; }, set doc(value) { doc = value; }, set completeError(v) {completeError=v;}, set readError(v) {readError=v;}, set gate(v) {gate=v;} };
}
const payment = view => ({ checkoutRef:view.checkoutRef, revision:view.revision, instrumentId:'wallet-one', confirmed:true });
test('wallet create verifies signed offers, isolates sessions and hides private instruments', async () => {
  const h = harness();
  await assert.rejects(h.service.create(h.state,{...h.body,items:[{offerToken:'tampered',quantity:1}]})); assert.equal(h.calls.length,0);
  const view = await h.service.create(h.state,h.body);
  assert.deepEqual(h.calls[0].args.checkout.line_items,[{item:{id:'exact-variant'},quantity:1}]);
  assert.equal(h.calls[0].args.meta['idempotency-key'],h.body.requestId);
  assert.equal(view.total.amount,8100); assert.equal(view.totals[1].price.amount,-1000);
  assert.equal(view.continueUrl,h.doc.continue_url); assert.equal(view.messages.length,1); assert.equal(view.links.length,1);
  assert.equal(JSON.stringify(view).includes('private-test-instrument'),false); assert.equal(JSON.stringify(view).includes('masked@example'),false);
  await assert.rejects(h.service.refresh({accessToken:'another-browser',checkouts:new Map()},view),/unavailable/);
  await h.service.create(h.state,h.body); assert.equal(h.calls.filter(c=>c.name==='create_checkout').length,1);
  await assert.rejects(h.service.create(h.state,{...h.body,items:[{...h.body.items[0],quantity:2}]}),/changed bag/);
});
test('updates copy saved address exactly and preserve unknown merchant fields and all line items', async () => {
  const h=harness(), first=await h.service.create(h.state,h.body);
  const result=await h.service.update(h.state,{...payment(first),methodId:'ship-one',addressId:'address-one'});
  const doc=h.calls.find(c=>c.name==='update_checkout').args.checkout;
  assert.deepEqual(doc.fulfillment.methods[0].destinations[0],walletAccount().addresses[0]);
  assert.deepEqual(doc.unknown_future_field,{preserve:true}); assert.deepEqual(doc.line_items,h.doc.line_items);
  for(const key of ['next','signals','attribution']) assert.equal(key in doc,false);
  await h.service.update(h.state,{...payment(result),methodId:'ship-one',groupId:'group-one',optionId:'standard'});
  assert.equal(h.doc.fulfillment.methods[0].groups[0].selected_option_id,'standard');
  await assert.rejects(h.service.update(h.state,{...payment(await h.service.refresh(h.state,first)),methodId:'ship-one',addressId:'invented'}),/saved in Shop/);
});
test('price, delivery, item and disclosure changes require review before payment', async () => {
  for(const mutate of [d=>d.totals.at(-1).amount++,d=>d.line_items[0].quantity++,d=>d.messages.push({content:'New notice'}),d=>d.fulfillment.methods[0].selected_destination_id='new']) {
    const h=harness(), first=await h.service.create(h.state,h.body); mutate(h.doc);
    const next=await h.service.pay(h.state,payment(first)); assert.equal(next.reviewRequired,true); assert.equal(next.attempted,false);
    assert.equal(h.calls.some(c=>c.name==='complete_checkout'),false);
  }
});
test('confirmation and an offered Shop Pay method are required; complete copies the exact credential once', async () => {
  const h=harness(), view=await h.service.create(h.state,h.body), original=structuredClone(h.doc.payment.instruments[0]);
  await assert.rejects(h.service.pay(h.state,{...payment(view),confirmed:false}));
  await assert.rejects(h.service.pay(h.state,{...payment(view),instrumentId:'invented'}));
  assert.equal(h.calls.some(c=>c.name==='complete_checkout'),false);
  const paid=await h.service.pay(h.state,payment(view)); assert.equal(paid.completed,true); assert.equal(paid.orderId,'order-one');
  assert.deepEqual(h.calls.find(c=>c.name==='complete_checkout').args.checkout.payment.instruments,[{...original,selected:true}]);
  await h.service.pay(h.state,payment(view)); assert.equal(h.calls.filter(c=>c.name==='complete_checkout').length,1);
});
test('concurrent double-clicks cannot submit payment twice', async () => {
  const h=harness(), view=await h.service.create(h.state,h.body); let release; h.gate=new Promise(resolve=>{release=resolve;});
  const one=h.service.pay(h.state,payment(view));
  await assert.rejects(h.service.pay(h.state,payment(view)),/updating/); release(); await one;
  assert.equal(h.calls.filter(c=>c.name==='complete_checkout').length,1);
});
test('ambiguous payment reads status only, blocks replacement purchases, never reports success without order', async () => {
  const h=harness(), view=await h.service.create(h.state,h.body); h.completeError=true;
  const unknown=await h.service.pay(h.state,payment(view)); assert.equal(unknown.completed,false); assert.equal(unknown.attempted,true); assert.equal(unknown.canPay,false);
  await h.service.pay(h.state,payment(view)); assert.equal(h.calls.filter(c=>c.name==='complete_checkout').length,1);
  await assert.rejects(h.service.create(h.state,{...h.body,requestId:randomUUID()}),/previous payment/);
  h.doc.status='completed'; assert.equal((await h.service.refresh(h.state,view)).completed,false);
  h.doc.order={id:'eventual-order'}; assert.equal((await h.service.refresh(h.state,view)).completed,true);
});
test('read failure after completion uncertainty leaves a read-only checkout', async () => {
  const h=harness(), view=await h.service.create(h.state,h.body); h.completeError=true;
  let release; h.gate=new Promise(resolve=>{release=resolve;}); const paying=h.service.pay(h.state,payment(view));
  await new Promise(resolve=>setImmediate(resolve)); h.readError=true; release();
  const result=await paying; assert.equal(result.outcomeUnknown,true); assert.equal(result.canPay,false);
});
test('escalation, incomplete checkout and missing wallet methods never call complete', async () => {
  for(const change of [{status:'requires_escalation'},{status:'incomplete'},{payment:{instruments:[]}},{payment:{instruments:[{id:'wallet-one',type:'card'}]}}]) {
    const h=harness(); Object.assign(h.doc,change); const view=await h.service.create(h.state,h.body);
    assert.equal(view.canPay,false); await assert.rejects(h.service.pay(h.state,payment(view)));
    assert.equal(h.calls.some(c=>c.name==='complete_checkout'),false);
  }
});
test('Shop RPC sends tokens only in the fixed endpoint header and sanitizes failures', async () => {
  const rpc=shopRpc({fetchImpl:async (url,options)=>{
    assert.equal(url,'https://mcp.shop.com/'); assert.equal(options.redirect,'error'); assert.equal(options.headers.Authorization,'Bearer private-test-token');
    assert.equal(options.body.includes('private-test-token'),false); const req=JSON.parse(options.body); return Response.json({jsonrpc:'2.0',id:req.id,result:{structuredContent:walletAccount()}});
  }});
  assert.equal((await rpc('get_account',{},'private-test-token')).addresses.length,1);
  await assert.rejects(shopRpc({fetchImpl:async()=>Response.json({credential:'private-test-token'},{status:500})})('get_account',{},'private-test-token'),error=>!error.message.includes('private-test-token'));
});
test('device flow enforces polling intervals, masks private credentials and handles denial/expiry', async () => {
  let now=0, polls=0; const state={checkouts:new Map()};
  const service=createShopAccounts({now:()=>now,rpc:async()=>walletAccount(),fetchImpl:async(url,options)=>{
    if(url.endsWith('/device')) { assert.equal(options.body.get('resource'),'https://mcp.shop.com'); return Response.json({device_code:'private-device',user_code:'DEMO-CODE',verification_uri_complete:'https://accounts.shop.app/verify?code=DEMO-CODE',expires_in:100,interval:5}); }
    assert.equal(options.body.has('resource'),false); assert.equal(options.body.get('device_code'),'private-device'); polls++;
    return Response.json(polls===1?{error:'slow_down'}:{access_token:'private-access',expires_in:3600});
  }});
  const start=await service.connect(state); assert.equal(start.userCode,'DEMO-CODE'); assert.equal(JSON.stringify(start).includes('private-device'),false);
  await service.poll(state); assert.equal(polls,0); now=5000; assert.equal((await service.poll(state)).interval,10);
  now=14999; await service.poll(state); assert.equal(polls,1); now=15000;
  const result=await service.poll(state); assert.equal(result.signedIn,true); assert.equal(JSON.stringify(result).includes('private-access'),false);
  service.disconnect(state); assert.throws(()=>service.token(state));
  await service.connect(state); now=200000; await assert.rejects(service.poll(state),/expired/);
  const denied=createShopAccounts({now:()=>now,fetchImpl:async()=>Response.json({error:'access_denied'})});
  state.pending={deviceCode:'x',expires:300000,interval:5,nextPoll:0}; await assert.rejects(denied.poll(state),/declined/);
});
test('HTTP wallet flow requires same origin and an isolated cookie; search to confirmation works with mocked providers', async t => {
  let now=0, completes=0, doc=walletDocument();
  const server=createWebServer({provider:'demo',shopNow:()=>now,
    shopAuthFetch:async url=>Response.json(url.endsWith('/device')?{device_code:'private-device',user_code:'DEMO',verification_uri:'https://accounts.shop.app/verify',expires_in:600,interval:5}:{access_token:'private-access',expires_in:3600}),
    shopFetch:async (_,options)=>{
      const request=JSON.parse(options.body),name=request.params.name;
      if(name!=='search_catalog') assert.equal(options.headers.Authorization,'Bearer private-access');
      if(name==='complete_checkout') { completes++; doc.status='completed'; doc.order={id:'http-order'}; }
      const data=name==='get_account'?walletAccount():name==='search_catalog'?{products:[{id:'shirt',title:'Everyday cotton shirt',variants:[{id:'exact-variant',url:'https://merchant.example/shirt',seller:{name:'Merchant',domain:'merchant.myshopify.com'},price:{amount:8000,currency:'USD'},availability:{available:true},options:[]}]}]}:doc;
      return Response.json({jsonrpc:'2.0',id:request.id,result:{structuredContent:data}});
    }});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base=`http://127.0.0.1:${server.address().port}`; let cookie='';
  const post=(path,body={},extra={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie,...extra},body:JSON.stringify(body)});
  assert.equal((await post('/api/shop-pay/connect',{}, {Origin:'https://foreign.example'})).status,403);
  assert.equal((await post('/api/shop-pay/pay',{})).status,401);
  const login=await post('/api/shop-pay/connect'); assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/); cookie=login.headers.get('set-cookie').split(';')[0]; now=6000;
  assert.equal((await (await post('/api/shop-pay/poll')).json()).signedIn,true);
  const products=await (await post('/api/products/search',{requestId:'search',inputRevision:0,missingItem:{id:'shirt',searchQuery:'cotton shirt'}})).json();
  const view=await (await post('/api/shop-pay/checkout',{requestId:randomUUID(),items:[{offerToken:products.products[0].offerToken,quantity:1}]})).json();
  assert.equal(view.canPay,true); assert.equal((await post('/api/shop-pay/refresh',view,{Cookie:''})).status,401);
  assert.equal((await (await post('/api/shop-pay/pay',payment(view))).json()).completed,true);
  await post('/api/shop-pay/pay',payment(view)); assert.equal(completes,1);
  for(const asset of ['/shopping-chat.mjs','/shop-wallet.mjs','/shared/shopping-chat.mjs']) assert.equal((await fetch(base+asset)).status,200);
});
