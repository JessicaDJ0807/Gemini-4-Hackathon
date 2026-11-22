import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../../packages/contracts/style-analysis.mjs';
import { publicHttpsUrl } from '../../packages/contracts/product-search.mjs';

const invalid = () => new ApiError(502, 'INVALID_CHECKOUT', 'The store could not prepare checkout. Your bag is saved; please try again.', true);
const text = (value, max = 4000) => typeof value === 'string' && value.length > 0 && value.length <= max;
const price = value => Number.isSafeInteger(value) && value >= 0;
// Signed offers bind a checkout to the exact merchant and variant returned by Shop.
// They expire after 30 minutes and after a server restart; no prices are trusted from the browser.
export function createShopCheckout({ fetchImpl = fetch, timeoutMs = 20000, now = Date.now } = {}) {
  const secret = randomBytes(32);
  const sign = payload => createHmac('sha256', secret).update(payload).digest('base64url');
  function issueOffer(shop, variantId) {
    if (!text(shop, 253) || !publicHttpsUrl(`https://${shop}`) || new URL(`https://${shop}`).host !== shop || !text(variantId, 500)) return null;
    const payload = Buffer.from(JSON.stringify({ shop, variantId, expires: now() + 30 * 60 * 1000 })).toString('base64url');
    return `${payload}.${sign(payload)}`;
  }
  function readOffer(token) {
    try {
      if (!text(token, 2000)) throw Error();
      const parts = token.split('.'); if (parts.length !== 2) throw Error();
      const expected = Buffer.from(sign(parts[0])), supplied = Buffer.from(parts[1]);
      if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw Error();
      const offer = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      if (offer.expires <= now()) throw Error();
      return offer;
    } catch { throw new ApiError(400, 'EXPIRED_OFFER', 'This product selection has expired. Search for the piece again and add it to your bag.'); }
  }
  function prepare(body) {
    if (!body || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId) ||
        !Array.isArray(body.items) || !body.items.length || body.items.length > 20) {
      throw new ApiError(400, 'INVALID_BAG', 'Choose at least one item to check out.');
    }
    const lines = body.items.map(item => {
      if (!Number.isInteger(item?.quantity) || item.quantity < 1 || item.quantity > 10) throw new ApiError(400, 'INVALID_QUANTITY', 'Choose a quantity between 1 and 10.');
      return { ...readOffer(item.offerToken), quantity: item.quantity };
    });
    if (new Set(lines.map(line => line.shop)).size !== 1 || new Set(lines.map(line => line.variantId)).size !== lines.length) {
      throw new ApiError(400, 'INVALID_BAG', 'Check out each store separately.');
    }
    return lines;
  }
  async function checkout(body) {
    const lines = prepare(body);
    try {
      const response = await fetchImpl('https://mcp.shop.com/', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call', 'Mcp-Name': 'create_checkout' },
        body: JSON.stringify({ jsonrpc: '2.0', id: body.requestId, method: 'tools/call', params: {
          name: 'create_checkout', arguments: { shop: lines[0].shop,
            checkout: { line_items: lines.map(line => ({ item: { id: line.variantId }, quantity: line.quantity })) },
            meta: { 'idempotency-key': body.requestId } },
          _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'travel-ai-stylist', version: '0.1.0' },
            'io.modelcontextprotocol/clientCapabilities': {} }
        } })
      });
      if (!response.ok) throw invalid();
      const envelope = await response.json(), doc = envelope.result?.structuredContent;
      if (envelope.jsonrpc !== '2.0' || envelope.id !== body.requestId || envelope.error || envelope.result?.isError || !doc ||
          !['incomplete', 'requires_escalation', 'ready_for_complete'].includes(doc.status) ||
          !publicHttpsUrl(doc.continue_url) || !/^[A-Z]{3}$/.test(doc.currency) ||
          !Array.isArray(doc.line_items) || !doc.line_items.length || !Array.isArray(doc.totals) ||
          !Array.isArray(doc.messages ?? []) || !Array.isArray(doc.links ?? [])) throw invalid();
      const items = doc.line_items.map(line => {
        if (!text(line.item?.title, 500) || !Number.isInteger(line.quantity) || line.quantity < 1 || !price(line.item.price)) throw invalid();
        return { title: line.item.title, quantity: line.quantity, price: { amount: line.item.price, currency: doc.currency } };
      });
      const totals = doc.totals.map(total => {
        if (!text(total.display_text, 200) || !price(total.amount)) throw invalid();
        return { label: total.display_text, price: { amount: total.amount, currency: doc.currency } };
      });
      const messages = (doc.messages ?? []).map(message => {
        if (!text(message.content)) throw invalid();
        return { type: message.type, content: message.content };
      });
      const links = (doc.links ?? []).map(link => {
        if (!publicHttpsUrl(link.url) || !text(link.title ?? link.type, 200)) throw invalid();
        return { title: link.title ?? link.type, url: link.url };
      });
      // No payment credentials, checkout IDs or buyer data are returned or logged.
      return { requestId: body.requestId, status: doc.status, items, totals, messages, links, continueUrl: doc.continue_url };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, 'CHECKOUT_UNAVAILABLE', 'Checkout could not be loaded. Retry with the same bag; no payment has been made.', true);
    }
  }
  return { issueOffer, checkout, prepare };
}
