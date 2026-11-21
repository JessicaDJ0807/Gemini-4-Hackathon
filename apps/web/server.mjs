import { photoWardrobe, photoWardrobeVersion, photoCredits } from '../../data/demo-wardrobe/photo-wardrobe.mjs';
import { prepareAiOutfitRequest } from './ai-outfits.mjs';
import { createShopCheckout } from './shop-checkout.mjs';
import { createProductSearch } from './shop-products.mjs';
import placePhotos from '../../data/attractions/photos.json' with { type: 'json' };
import { createGeminiStyle } from './gemini-style.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { ApiError, validateRequest, validateResponse } from '../../packages/contracts/style-analysis.mjs';
import { readJson, json, failure } from './http.mjs';
import { searchDestinations } from './destinations.mjs';
import { suggestAttractions } from '../../data/attractions/catalog.mjs';
import { getTripWeather } from './weather.mjs';
import { createPlacesClient } from './google-places.mjs';
import { wardrobe, wardrobeVersion } from '../../data/demo-wardrobe/wardrobe.mjs';
import { validateOutfitRequest, validateOutfitResponse } from '../../packages/contracts/outfit-plans.mjs';

const assets = {
  ...Object.fromEntries(photoWardrobe.map(item => [item.imageUrl, [`../../services/ai/tests/fixtures/wardrobe/images/${item.id}.jpg`, 'image/jpeg']])),
  '/cart.mjs': ['cart.mjs', 'text/javascript'],
  '/shopping.mjs': ['shopping.mjs', 'text/javascript'],
  '/shared/product-search.mjs': ['../../packages/contracts/product-search.mjs', 'text/javascript'],
  ...Object.fromEntries(Object.values(placePhotos).map(photo => [photo.imageUrl, [`../../data/attractions/photos/${photo.imageUrl.split('/').at(-1)}`, photo.mimeType]])),
  '/place-photos.mjs': ['place-photos.mjs', 'text/javascript'],
  ...Object.fromEntries(wardrobe.map((item) => [item.imageUrl, [`../../data/demo-wardrobe/images/${item.id}.svg`, 'image/svg+xml']])),
  '/style-profile.mjs': ['../../packages/contracts/style-profile.mjs', 'text/javascript'],
  '/shared/style-profile.mjs': ['../../packages/contracts/style-profile.mjs', 'text/javascript'],
  '/shared/style-inspiration.mjs': ['../../packages/contracts/style-inspiration.mjs', 'text/javascript'],
  '/outfits.mjs': ['outfits.mjs', 'text/javascript'],
  '/shared/outfit-plans.mjs': ['../../packages/contracts/outfit-plans.mjs', 'text/javascript'],
  '/shared/style-analysis.mjs': ['../../packages/contracts/style-analysis.mjs', 'text/javascript'],
  '/shared/trip.mjs': ['../../packages/contracts/trip.mjs', 'text/javascript'],
  '/shared/weather.mjs': ['../../packages/contracts/weather.mjs', 'text/javascript'],
  '/': ['index.html', 'text/html'],
  '/trip': ['trip.html', 'text/html'],
  '/wardrobe': ['wardrobe.html', 'text/html'],
  '/wardrobe.mjs': ['wardrobe.mjs', 'text/javascript'],
  '/shared/saved-trip.mjs': ['../../packages/contracts/saved-trip.mjs', 'text/javascript'],
  '/trip.mjs': ['trip.mjs', 'text/javascript'],
  '/place-search.mjs': ['place-search.mjs', 'text/javascript'],
  '/weather-contracts.mjs': ['../../packages/contracts/weather.mjs', 'text/javascript'],
  '/trip-contracts.mjs': ['../../packages/contracts/trip.mjs', 'text/javascript'],
  '/app.mjs': ['app.mjs', 'text/javascript'],
  '/style.css': ['style.css', 'text/css'],
  '/contracts.mjs': ['../../packages/contracts/style-analysis.mjs', 'text/javascript']
};

export function createWebServer({ aiBaseUrl, token, provider, fetchImpl = fetch, locationFetch = fetch, placesKey, placesFetch = fetch, weatherFetch = fetch, weatherNow, geminiKey, geminiModel, geminiFetch = fetch, timeoutMs = 25000, geminiTimeoutMs = 55000, shopFetch = fetch, shopTimeoutMs = 20000, outfitTimeoutMs = 120000, publicAppUrl = 'http://127.0.0.1:3000' }) {
  const activeWardrobe = provider === 'live' ? photoWardrobe : wardrobe;
  const activeVersion = provider === 'live' ? photoWardrobeVersion : wardrobeVersion;
  const gemini = createGeminiStyle({ apiKey: geminiKey, model: geminiModel, fetchImpl: geminiFetch, timeoutMs: geminiTimeoutMs });
  const shopCheckout = createShopCheckout({ fetchImpl: shopFetch, timeoutMs: shopTimeoutMs });
  const searchProducts = createProductSearch({ fetchImpl: shopFetch, timeoutMs: shopTimeoutMs, issueOffer: shopCheckout.issueOffer });
  const places = createPlacesClient({ apiKey: placesKey, fetchImpl: placesFetch });
  return createServer(async (request, response) => {
    let body;
    try {
      const url = new URL(request.url, 'http://localhost');
      if (request.method === 'GET' && request.url === '/api/place-photos') return json(response, 200, placePhotos);
      if (request.method === 'GET' && ['/api/wardrobe', '/api/demo-wardrobe'].includes(request.url)) return json(response, 200, { wardrobeVersion: activeVersion, wardrobe: activeWardrobe, enabled: true, provider, credits: provider === 'live' ? photoCredits : [] });
      if (request.method === 'GET' && request.url === '/api/places/config') return json(response, 200, { enabled: places.enabled });
      if (request.method === 'GET' && url.pathname === '/api/destinations') {
        return json(response, 200, await searchDestinations(url.searchParams.get('q'), locationFetch));
      }
      if (request.method === 'GET' && url.pathname === '/api/attractions') {
        const id = url.searchParams.get('destinationId');
        if (!id || id.length > 100) throw new ApiError(400, 'INVALID_DESTINATION', 'Select a destination first.');
        return json(response, 200, suggestAttractions(id));
      }
      if (request.method === 'GET' && request.url === '/api/config') return json(response, 200, { provider, photoAnalysis: gemini.enabled });
      if (request.method === 'GET' && assets[request.url]) {
        const [path, type] = assets[request.url];
        const content = await readFile(new URL(path, import.meta.url));
        response.writeHead(200, {
          'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'self'; img-src 'self' blob: https://cdn.shopify.com; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
          'X-Content-Type-Options': 'nosniff'
        });
        return response.end(content);
      }
      if (request.method !== 'POST' || !['/api/checkout', '/api/products/search', '/api/style-inspiration', '/api/style-analysis', '/api/outfit-plans', '/api/places/autocomplete', '/api/places/details', '/api/weather'].includes(request.url)) throw new ApiError(404, 'NOT_FOUND', 'Endpoint not found.');
      if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) {
        throw new ApiError(403, 'FORBIDDEN', 'Use the local app to submit this request.');
      }
      body = await readJson(request, request.url === '/api/style-inspiration' ? 9 * 1024 * 1024 : request.url === '/api/outfit-plans' ? 128 * 1024 : 16384);
      if (request.url === '/api/checkout') return json(response, 200, await shopCheckout.checkout(body));
      if (request.url === '/api/products/search') return json(response, 200, await searchProducts(body));
      if (request.url === '/api/style-inspiration') return json(response, 200, await gemini.analyze(body));
      if (request.url === '/api/weather') return json(response, 200, await getTripWeather(body, { fetchImpl: weatherFetch, now: weatherNow }));
      if (request.url === '/api/places/autocomplete') return json(response, 200, await places.autocomplete(body));
      if (request.url === '/api/places/details') return json(response, 200, await places.details(body));
      const outfitRequest = request.url === '/api/outfit-plans';
      if (outfitRequest) {
        validateOutfitRequest(body);
        if (body.wardrobeVersion !== activeVersion || body.wardrobe.some((item) => {
          const known = activeWardrobe.find((entry) => entry.id === item.id);
          return !known || ['name', 'imageUrl', 'category', 'color'].some((key) => item[key] !== known[key]) || JSON.stringify(item.styleTags) !== JSON.stringify(known.styleTags);
        })) throw new ApiError(400, 'INVALID_WARDROBE', 'Reload the wardrobe before generating outfits.');
        body.wardrobe = body.wardrobe.map((item) => activeWardrobe.find((entry) => entry.id === item.id));
      } else validateRequest(body);
      const upstreamBody = outfitRequest && provider === 'live' ? prepareAiOutfitRequest(body, publicAppUrl) : body;
      const upstream = await fetchImpl(`${aiBaseUrl}${outfitRequest ? '/v1/outfit-plans' : '/v1/style-analysis'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(upstreamBody), signal: AbortSignal.timeout(outfitRequest ? outfitTimeoutMs : timeoutMs)
      });
      const result = await upstream.json();
      if (!upstream.ok) {
        if (result?.requestId !== body.requestId || result?.inputRevision !== body.inputRevision ||
            typeof result?.error?.message !== 'string' || typeof result?.error?.code !== 'string' || typeof result?.error?.retryable !== 'boolean') {
          throw new ApiError(502, 'INVALID_AI_RESPONSE', 'The style service returned an invalid error.', true);
        }
        if (upstream.headers.has('Retry-After')) response.setHeader('Retry-After', upstream.headers.get('Retry-After'));
        return json(response, upstream.status, result);
      }
      json(response, 200, outfitRequest ? validateOutfitResponse(result, body) : validateResponse(result, body));
    } catch (error) {
      if (error.name === 'TimeoutError') error = new ApiError(504, 'AI_TIMEOUT', request.url === '/api/outfit-plans' ? 'Outfit generation timed out. Your choices are kept; please retry.' : 'Style analysis timed out. You can retry.', true);
      else if (!(error instanceof ApiError)) error = new ApiError(502, 'AI_UNAVAILABLE', request.url === '/api/outfit-plans' ? 'Could not generate outfits. Please try again.' : 'Could not read a result from the style service.', true);
      failure(response, error, body);
    }
  });
}
