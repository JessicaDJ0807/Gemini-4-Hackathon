import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createShopCheckout } from '../apps/web/shop-checkout.mjs';
import { createWebServer } from '../apps/web/server.mjs';

const document = () => ({ id: 'private-checkout-id', status: 'requires_escalation', currency: 'USD',
  line_items: [{ item: { id: 'exact-variant', title: 'Leather sneakers', price: 9000 }, quantity: 2 }],
  totals: [{ type: 'subtotal', display_text: 'Subtotal', amount: 18000 }],
  messages: [{ type: 'warning', content: 'Shipping calculated after entering your address.' }],
  links: [{ type: 'terms_of_service', title: 'Terms', url: 'https://merchant.example/terms' }],
  continue_url: 'https://merchant.example/checkout?key=private&attribution=keep',
  buyer: { email: 'private@example.com' }, payment: { instruments: [{ credential: 'secret' }] }
});
const envelope = (id, doc = document()) => Response.json({ jsonrpc: '2.0', id, result: { structuredContent: doc } });
test('checkout uses exact signed merchant/variant, preserves provider prices and disclosures, never pays', async () => {
  const calls = [], service = createShopCheckout({ fetchImpl: async (url, options) => {
    assert.equal(url, 'https://mcp.shop.com/'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers['Mcp-Name'], 'create_checkout');
    const body = JSON.parse(options.body); calls.push(body.params.arguments);
    assert.equal(body.params.name, 'create_checkout'); return envelope(body.id);
  } });
  const body = { requestId: randomUUID(), items: [{ offerToken: service.issueOffer('merchant.myshopify.com', 'exact-variant'), quantity: 2 }] };
  const result = await service.checkout(body); await service.checkout(body);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].shop, 'merchant.myshopify.com');
  assert.deepEqual(calls[0].checkout.line_items, [{ item: { id: 'exact-variant' }, quantity: 2 }]);
  assert.equal(calls[0].meta['idempotency-key'], body.requestId);
  assert.equal(result.continueUrl, document().continue_url);
  assert.equal(result.totals[0].price.amount, 18000); assert.equal(result.items[0].quantity, 2);
  assert.equal(result.messages[0].content, document().messages[0].content);
  assert.equal(result.links[0].url, document().links[0].url);
  assert.equal(result.buyer, undefined); assert.equal(result.payment, undefined); assert.equal(result.id, undefined);
});
test('tampered/expired offers, mixed stores, duplicate variants and invalid quantities make no upstream calls', async () => {
  let now = 0, calls = 0;
  const service = createShopCheckout({ now: () => now, fetchImpl: async () => { calls++; throw Error(); } });
  const one = service.issueOffer('one.myshopify.com', 'one'), two = service.issueOffer('two.myshopify.com', 'two');
  for (const items of [[], [{offerToken:one,quantity:0}], [{offerToken:one,quantity:11}], [{offerToken:one,quantity:1.5}],
    [{offerToken:one+'x',quantity:1}], [{offerToken:one,quantity:1},{offerToken:two,quantity:1}],
    [{offerToken:one,quantity:1},{offerToken:one,quantity:1}]]) {
    await assert.rejects(service.checkout({requestId:randomUUID(),items}), error => error.status === 400);
  }
  now = 31 * 60 * 1000;
  await assert.rejects(service.checkout({requestId:randomUUID(),items:[{offerToken:one,quantity:1}]}), /expired/);
  assert.equal(calls, 0); assert.equal(service.issueOffer('localhost', 'x'), null);
});
test('unsafe redirects and malformed checkout totals fail without exposing upstream private data', async () => {
  for (const change of [{continue_url:'javascript:alert(1)'}, {status:'completed'}, {totals:[{display_text:'Total',amount:'free'}]}, {messages:[{}]}, {links:[{url:'http://localhost'}]}]) {
    const service = createShopCheckout({fetchImpl: async (_, options) => envelope(JSON.parse(options.body).id, {...document(),...change})});
    await assert.rejects(service.checkout({requestId:randomUUID(),items:[{offerToken:service.issueOffer('one.myshopify.com','one'),quantity:1}]}), error => error.status === 502 && !error.message.includes('private'));
  }
});
test('search-issued checkout offers work over HTTP; foreign origins and invented offers are rejected', async t => {
  let writes = 0;
  const server = createWebServer({ provider:'demo', shopFetch:async (_,options) => {
    const body = JSON.parse(options.body);
    if (body.params.name === 'create_checkout') { writes++; return envelope(body.id); }
    return Response.json({jsonrpc:'2.0',id:body.id,result:{structuredContent:{products:[{
      id:'product',title:'Leather sneakers',variants:[{id:'exact-variant',url:'https://merchant.example/product',seller:{name:'Merchant',domain:'merchant.myshopify.com'},price:{amount:9000,currency:'USD'},availability:{available:true},options:[{name:'Size',label:'9'}]}]
    }]}}});
  }});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) => fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  const search = await (await post('/api/products/search',{requestId:'search',inputRevision:0,missingItem:{id:'gap',searchQuery:'sneakers'}})).json();
  const body = {requestId:randomUUID(),items:[{offerToken:search.products[0].variants[0].offerToken,quantity:2}]};
  assert.equal((await post('/api/checkout',body,{Origin:'https://other.example'})).status,403);
  assert.equal((await post('/api/checkout',{...body,items:[{offerToken:'made-up',quantity:1}]})).status,400);
  assert.equal(writes,0); assert.equal((await post('/api/checkout',body)).status,200); assert.equal(writes,1);
  assert.equal((await fetch(base+'/cart.mjs')).status,200);
});
