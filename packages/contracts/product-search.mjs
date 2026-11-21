import { ApiError } from './style-analysis.mjs';

const shortText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
export function publicHttpsUrl(value) {
  if (typeof value !== 'string' || value.length > 8192) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      url.hostname.includes('.') && !/^[\d.]+$/.test(url.hostname) && !url.hostname.includes(':') &&
      !/(^|\.)(localhost|local|internal)$/.test(url.hostname);
  } catch { return false; }
}
export function productImageUrl(value) {
  return publicHttpsUrl(value) && new URL(value).hostname === 'cdn.shopify.com';
}
export function validateProductSearchRequest(body) {
  if (!body || !shortText(body.requestId, 128) || !Number.isSafeInteger(body.inputRevision) || body.inputRevision < 0 ||
      !shortText(body.missingItem?.id, 200) || !shortText(body.missingItem?.searchQuery, 1000)) {
    throw new ApiError(400, 'INVALID_PRODUCT_SEARCH', 'This missing item needs a valid product search query.');
  }
  return body;
}
export function validProduct(product) {
  return Boolean(product && shortText(product.id, 500) && shortText(product.variantId, 500) && shortText(product.title, 500) &&
    shortText(product.merchant, 200) && publicHttpsUrl(product.url) &&
    (product.imageUrl === null || productImageUrl(product.imageUrl)) &&
    Number.isSafeInteger(product.price?.amount) && product.price.amount >= 0 && /^[A-Z]{3}$/.test(product.price.currency) &&
    [true, false, null].includes(product.available) && Array.isArray(product.options) && product.options.length <= 20 &&
    product.options.every(option => shortText(option.name, 100) && shortText(option.value, 200)));
}
export function validateProductSearchResponse(result, request) {
  if (!result || result.requestId !== request.requestId || result.inputRevision !== request.inputRevision ||
      result.missingItemId !== request.missingItem.id || result.query !== request.missingItem.searchQuery.trim() ||
      !Array.isArray(result.products) || result.products.length > 5 || !result.products.every(product => validProduct(product) && (product.variants === undefined || (Array.isArray(product.variants) && product.variants.length <= 100 && product.variants.every(validProduct)))) ||
      new Set(result.products.map(product => product.id)).size !== result.products.length ||
      !Array.isArray(result.warnings) || !result.warnings.every(message => shortText(message, 4000))) {
    throw new ApiError(502, 'INVALID_PRODUCT_RESULTS', 'Could not read the product matches. Please try again.', true);
  }
  return result;
}
export function formatProductPrice(price) {
  const format = new Intl.NumberFormat('en', { style: 'currency', currency: price.currency, currencyDisplay: 'code' });
  return format.format(price.amount / 10 ** format.resolvedOptions().maximumFractionDigits);
}
