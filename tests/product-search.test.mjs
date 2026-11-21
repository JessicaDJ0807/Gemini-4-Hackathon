import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWebServer } from '../apps/web/server.mjs';
import { createProductSearch } from '../apps/web/shop-products.mjs';
import { formatProductPrice, validateProductSearchResponse, publicHttpsUrl } from '../packages/contracts/product-search.mjs';

const request = { requestId: 'shopping-1', inputRevision: 2,
  missingItem: { id: 'gap-from-a', description: 'Comfortable walking shoes', searchQuery: 'neutral walking sneakers', priority: 'essential', reason: 'Walking between places.' } };
const product = (id = 'product-1', changes = {}) => ({ id, title: 'Everyday Sneakers',
  media: [{ type: 'image', url: 'https://cdn.shopify.com/s/files/shoes.jpg' }], variants: [{
    id: 'variant-1', url: 'https://merchant.example/products/sneakers?variant=1&_gsid=keep-this&utm_source=shopify',
    seller: { name: 'Example Merchant' }, price: { amount: 6999, currency: 'USD' }, availability: { available: true },
    options: [{ name: 'Size', label: '9' }], ...changes
  }] });
const rpc = (products = [product()], messages = [], id = request.requestId) => ({ jsonrpc: '2.0', id, result: { isError: false, structuredContent: { products, messages } } });
const service = fetchImpl => createProductSearch({ fetchImpl });
async function app(t, options = {}) {
  const server = createWebServer({ provider: 'demo', shopFetch: async () => Response.json(rpc()), ...options });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
const post = (base, body = request, headers = {}) => fetch(base + '/api/products/search', { method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('uses A searchQuery verbatim with only read-only Shop search and no inferred size, gender or shipping country', async () => {
  const response = await service(async (url, options) => {
    assert.equal(url, 'https://mcp.shop.com/'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, undefined); assert.equal(options.headers['Mcp-Name'], 'search_catalog');
    const payload = JSON.parse(options.body);
    assert.equal(payload.method, 'tools/call'); assert.equal(payload.params.name, 'search_catalog');
    assert.deepEqual(payload.params.arguments, { catalog: { query: request.missingItem.searchQuery, pagination: { limit: 5 } } });
    assert.equal(payload.params._meta['io.modelcontextprotocol/protocolVersion'], '2026-07-28');
    return Response.json(rpc());
  })(request);
  validateProductSearchResponse(response, request);
  assert.equal(response.missingItemId, 'gap-from-a');
  assert.equal(response.products[0].url, product().variants[0].url);
  assert.deepEqual(response.products[0].options, [{name:'Size', value:'9'}]);
  assert.equal(response.products[0].imageUrl, product().media[0].url);
});

test('formats actual provider prices in currency minor units, including zero, JPY and KWD', () => {
  assert.equal(formatProductPrice({amount:6999,currency:'USD'}), 'USD\u00a069.99');
  assert.equal(formatProductPrice({amount:8000,currency:'JPY'}), 'JPY\u00a08,000');
  assert.equal(formatProductPrice({amount:8000,currency:'KWD'}), 'KWD\u00a08.000');
  assert.equal(formatProductPrice({amount:0,currency:'USD'}), 'USD\u00a00.00');
});

test('preserves warnings and availability, chooses a valid available variant and never invents an image', async () => {
  const first = product('one', {availability: {available:false}});
  first.variants.push({...first.variants[0], id:'available-variant', availability:{available:true}});
  const second = product('two', {availability: {available:false}}); second.media = [{type:'image',url:'https://unapproved.example/image.jpg'}];
  const third = product('three', {availability: undefined});
  const response = await service(async () => Response.json(rpc([first, second, third], [{type:'warning',content:'Delivery varies by merchant.'}])))(request);
  assert.equal(response.products[0].variantId, 'available-variant');
  assert.equal(response.products[1].available, false); assert.equal(response.products[1].imageUrl, null);
  assert.equal(response.products[2].available, null); assert.deepEqual(response.warnings, ['Delivery varies by merchant.']);
});

test('deduplicates products, limits results, rejects unsafe links and skips incomplete listings with a warning', async () => {
  for (const url of ['javascript:alert(1)', 'http://merchant.example/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://user:pass@merchant.example/x']) assert.equal(publicHttpsUrl(url), false);
  const response = await service(async () => Response.json(rpc([
    product(), product(), product('bad-link',{url:'javascript:alert(1)'}), product('bad-price',{price:{amount:-1,currency:'USD'}}),
    ...Array.from({length:6},(_, i) => product(`extra-${i}`))
  ])))(request);
  assert.equal(response.products.length, 5); assert.equal(new Set(response.products.map(p=>p.id)).size, 5);
  assert.match(response.warnings[0], /incomplete/);
});

test('empty catalog results remain empty; malformed or error results never become fabricated matches', async () => {
  const empty = await service(async () => Response.json(rpc([])))(request); assert.deepEqual(empty.products, []);
  for (const payload of [
    {jsonrpc:'2.0',id:request.requestId,error:{code:-1,message:'private upstream detail'}},
    {jsonrpc:'2.0',id:request.requestId,result:{isError:true}},
    rpc([product()], [], 'stale-id'), rpc([{broken:true}]),
    {jsonrpc:'2.0',id:request.requestId,result:{structuredContent:{products:'invalid'}}}
  ]) await assert.rejects(service(async () => Response.json(payload))(request), error => error.status===502 && !error.message.includes('private'));
});

test('HTTP endpoint validates request and origin before sending anything to Shop', async t => {
  let calls = 0;
  const base = await app(t, {shopFetch: async () => {calls++; return Response.json(rpc());}});
  for (const input of [{}, {...request, inputRevision:-1}, {...request,missingItem:{id:'x',searchQuery:''}}, {...request,missingItem:{id:'x',searchQuery:'x'.repeat(1001)}}]) {
    assert.equal((await post(base,input)).status, 400);
  }
  assert.equal((await post(base,request,{Origin:'https://foreign.example'})).status, 403);
  assert.equal(calls, 0);
  const response = await post(base); assert.equal(response.status, 200); validateProductSearchResponse(await response.json(), request);
  for (const path of ['/shopping.mjs','/shared/product-search.mjs']) assert.equal((await fetch(base+path)).status,200);
  const page = await fetch(base+'/wardrobe'); assert.match(page.headers.get('Content-Security-Policy'), /img-src[^;]*https:\/\/cdn.shopify.com/);
});

test('rate limits, timeouts, transport errors and invalid JSON return safe retryable errors', async t => {
  for (const [shopFetch, status, code] of [
    [async () => new Response('',{status:429}),429,'SHOP_RATE_LIMIT'],
    [async () => new Response('',{status:503}),502,'SHOP_UNAVAILABLE'],
    [async () => {throw new Error('private detail');},502,'SHOP_UNAVAILABLE'],
    [async () => new Response('{broken'),502,'SHOP_UNAVAILABLE'],
    [async (_, {signal}) => new Promise((_,reject) => signal.addEventListener('abort',()=>reject(signal.reason))),504,'SHOP_TIMEOUT']
  ]) {
    const base = await app(t,{shopFetch,shopTimeoutMs:10}); const response = await post(base); const result = await response.json();
    assert.equal(response.status,status); assert.equal(result.error.code,code); assert.equal(result.error.retryable,true);
    assert.equal(result.requestId,request.requestId); assert.ok(!JSON.stringify(result).includes('private')); assert.equal(result.products,undefined);
  }
});

test('client rejects search results belonging to another missing item or an older request', async () => {
  const response = await service(async () => Response.json(rpc()))(request);
  for (const change of [{requestId:'old'},{inputRevision:0},{missingItemId:'other-gap'},{query:'different query'}]) {
    assert.throws(()=>validateProductSearchResponse({...response,...change},request));
  }
});
