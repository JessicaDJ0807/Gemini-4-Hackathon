import { ApiError } from '../../packages/contracts/style-analysis.mjs';
import { publicHttpsUrl, productImageUrl, validProduct, validateProductSearchRequest, validateProductSearchResponse } from '../../packages/contracts/product-search.mjs';

const endpoint = 'https://mcp.shop.com/';
const protocol = '2026-07-28';
const invalid = () => new ApiError(502, 'INVALID_SHOP_RESPONSE', 'Product search returned an unreadable result. Please try again.', true);
function normalizeProduct(product, issueOffer) {
  if (!product || !Array.isArray(product.variants)) return null;
  // A featured variant is not necessarily available; don't imply every size is in stock.
  const candidates = product.variants.map(variant => {
    if (!variant || !publicHttpsUrl(variant.url)) return null;
    const images = [...(Array.isArray(variant.media) ? variant.media : []), ...(Array.isArray(product.media) ? product.media : [])];
    const image = images.find(media => media?.type === 'image' && productImageUrl(media.url));
    const normalized = {
      id: product.id, variantId: variant.id, title: product.title, merchant: variant.seller?.name,
      shop: variant.seller?.domain ?? null,
      offerToken: variant.availability?.available === true ? issueOffer?.(variant.seller?.domain, variant.id) ?? null : null,
      url: variant.url, imageUrl: image?.url ?? null,
      price: { amount: variant.price?.amount, currency: variant.price?.currency },
      available: typeof variant.availability?.available === 'boolean' ? variant.availability.available : null,
      options: Array.isArray(variant.options) ? variant.options.map(option => ({ name: option?.name, value: option?.label })) : []
    };
    return validProduct(normalized) ? normalized : null;
  }).filter(Boolean);
  const featured = candidates.find(variant => variant.available === true) ?? candidates[0];
  return featured ? { ...featured, variants: candidates.slice(0, 100) } : null;
}
export function createProductSearch({ fetchImpl = fetch, timeoutMs = 20000, issueOffer } = {}) {
  return async body => {
    validateProductSearchRequest(body);
    const query = body.missingItem.searchQuery.trim();
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': protocol, 'Mcp-Method': 'tools/call', 'Mcp-Name': 'search_catalog' },
        body: JSON.stringify({ jsonrpc: '2.0', id: body.requestId, method: 'tools/call', params: {
          name: 'search_catalog', arguments: { catalog: { query, pagination: { limit: 5 } } },
          _meta: { 'io.modelcontextprotocol/protocolVersion': protocol,
            'io.modelcontextprotocol/clientInfo': { name: 'travel-ai-stylist', version: '0.1.0' },
            'io.modelcontextprotocol/clientCapabilities': {} }
        } })
      });
      if (response.status === 429) throw new ApiError(429, 'SHOP_RATE_LIMIT', 'Product search is busy. Please try again shortly.', true);
      if (!response.ok) throw new ApiError(502, 'SHOP_UNAVAILABLE', 'Product search is unavailable. Please try again.', true);
      const envelope = await response.json();
      if (envelope.jsonrpc !== '2.0' || envelope.id !== body.requestId) throw invalid();
      if (envelope.error || envelope.result?.isError) throw new ApiError(502, 'SHOP_SEARCH_FAILED', 'Product search could not finish. Please try again.', true);
      const document = envelope.result?.structuredContent;
      if (!Array.isArray(document?.products) || document.products.length > 50 ||
          (document.messages !== undefined && !Array.isArray(document.messages))) throw invalid();
      const warnings = [];
      for (const message of document.messages ?? []) {
        if (message?.type !== 'warning') continue;
        if (typeof message.content !== 'string' || !message.content.trim() || message.content.length > 4000) throw invalid();
        warnings.push(message.content);
      }
      const products = [], seen = new Set();
      let skipped = 0;
      for (const raw of document.products) {
        const product = normalizeProduct(raw, issueOffer);
        if (!product) { skipped++; continue; }
        if (seen.has(product.id)) continue;
        seen.add(product.id); if (products.length < 5) products.push(product);
      }
      if (skipped && !products.length) throw invalid();
      if (skipped) warnings.push('Some matches could not be displayed because their product details were incomplete.');
      return validateProductSearchResponse({ requestId: body.requestId, inputRevision: body.inputRevision,
        missingItemId: body.missingItem.id, query, products, warnings }, body);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error.name === 'TimeoutError') throw new ApiError(504, 'SHOP_TIMEOUT', 'Product search took too long. Please try again.', true);
      throw new ApiError(502, 'SHOP_UNAVAILABLE', 'Product search is unavailable. Please try again.', true);
    }
  };
}
