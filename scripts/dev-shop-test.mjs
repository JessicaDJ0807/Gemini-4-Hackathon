// Isolated local fixture app. Never imports .env and never contacts a commerce provider.
import { randomBytes } from 'node:crypto';
import { createWebServer } from '../apps/web/server.mjs';
import { createMockAiServer } from './mock-ai.mjs';
import { walletDocument, walletAccount } from '../tests/fixtures/shop-wallet.mjs';
const token = randomBytes(32).toString('hex');
const mock = createMockAiServer({ token });
await new Promise((resolve, reject) => mock.once('error', reject).listen(0, '127.0.0.1', resolve));
const docs = new Map(), createKeys = new Map();
const product = { id: 'test-shirt', title: 'Everyday cotton shirt · Test product', variants: [{ id: 'exact-variant',
  url: 'https://merchant.example/shirt', seller: { name: 'Demo Store', domain: 'merchant.example' },
  price: { amount: 8000, currency: 'USD' }, availability: { available: true }, options: [{ name: 'Size', label: 'M' }] }] };
const web = createWebServer({ provider: 'demo', token, aiBaseUrl: `http://127.0.0.1:${mock.address().port}`,
  shoppingTestMode: true, geminiKey: 'local-test-placeholder',
  geminiFetch: async () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ reply: 'Here is a simulated shirt for testing checkout.', query: 'cotton shirt' }) }] } }] }),
  shopAuthFetch: async url => Response.json(url.endsWith('/device') ? { device_code: 'test-device', user_code: 'TEST-ONLY', verification_uri: 'https://accounts.shop.app/verify', expires_in: 600, interval: 5 } : { access_token: 'local-fixture-token', expires_in: 3600 }),
  shopFetch: async (_, options) => {
    const request = JSON.parse(options.body), { name, arguments: args } = request.params;
    let data;
    if (name === 'search_catalog') data = { products: [product] };
    else if (name === 'get_account') data = { ...walletAccount(), links: [], messages: [{ content: 'This is a simulated Shop account.' }] };
    else if (name === 'create_checkout') {
      const key = args.meta['idempotency-key'];
      if (!createKeys.has(key)) {
        const doc = walletDocument(); doc.id = `test-checkout-${docs.size}`; doc.status = 'incomplete';
        doc.line_items[0].quantity = args.checkout.line_items[0].quantity;
        doc.line_items[0].item.title = product.title;
        doc.totals[0].amount = 8000 * doc.line_items[0].quantity; doc.totals.at(-1).amount = doc.totals[0].amount - 1000 + 500 + 600; doc.messages = [{ content: 'Test checkout only. Choose the demo address and delivery option.' }];
        docs.set(doc.id, doc); createKeys.set(key, doc.id);
      }
      data = docs.get(createKeys.get(key));
    } else {
      data = docs.get(args.id);
      if (!data) return Response.json({ jsonrpc: '2.0', id: request.id, result: { isError: true } });
      if (name === 'update_checkout') {
        data = structuredClone(args.checkout);
        const method = data.fulfillment.methods[0];
        if (method.selected_destination_id && method.groups[0].selected_option_id) data.status = 'ready_for_complete';
        docs.set(args.id, data);
      }
      if (name === 'complete_checkout') { data.status = 'completed'; data.order = { id: 'TEST-ORDER-NO-CHARGE' }; data.messages = [{ content: 'Simulation complete. No order or payment was sent to a store.' }]; }
    }
    return Response.json({ jsonrpc: '2.0', id: request.id, result: { structuredContent: data } });
  }
});
try { await new Promise((resolve, reject) => web.once('error', reject).listen(3002, '127.0.0.1', resolve)); }
catch (error) { mock.close(); throw error; }
console.log('PAYMENT TEST ONLY: http://127.0.0.1:3002 — simulated Shop and Gemini; no charges. Use manual style tags.');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { web.close(); web.closeAllConnections(); mock.close(); mock.closeAllConnections(); });
