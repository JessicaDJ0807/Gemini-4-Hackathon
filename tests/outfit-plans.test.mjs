import { buildStyleProfile } from '../packages/contracts/style-profile.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWebServer } from '../apps/web/server.mjs';
import { createMockAiServer } from '../scripts/mock-ai.mjs';
import { mockOutfits } from '../scripts/mock-outfits.mjs';
import { wardrobe, wardrobeVersion } from '../data/demo-wardrobe/wardrobe.mjs';
import { catalog } from '../data/attractions/catalog.mjs';
import { buildTrip } from '../packages/contracts/trip.mjs';
import { validateOutfitRequest, validateOutfitResponse } from '../packages/contracts/outfit-plans.mjs';
function input() {
  return { requestId: 'outfits-001', inputRevision: 3,
    styleProfile: { styleTags: ['minimal'], colors: ['cream'], avoidances: ['high heels'], visualReferenceIds: [] },
    trip: buildTrip(catalog[1].destination, '2026-11-24', '2026-11-26', [{ id: 'cafe', name: 'A saved café', source: 'user', activityTags: [] }]),
    wardrobeVersion, wardrobe: structuredClone(wardrobe), media: [] };
}
async function listen(t, server) {
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
async function app(t, overrides = {}) {
  const token = 'test-outfit-token';
  const aiBaseUrl = await listen(t, createMockAiServer({ token }));
  return listen(t, createWebServer({ aiBaseUrl, token, provider: 'demo', ...overrides }));
}
const post = (base, body) => fetch(base + '/api/outfit-plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('catalog and original images are served and the full B-to-mock flow preserves context', async (t) => {
  const request = input(); let captured;
  const base = await app(t, { fetchImpl: async (url, options) => {
    assert.ok(url.endsWith('/v1/outfit-plans'));
    assert.equal(options.headers.Authorization, 'Bearer test-outfit-token');
    captured = JSON.parse(options.body); return fetch(url, options);
  } });
  const data = await (await fetch(base + '/api/demo-wardrobe')).json();
  assert.equal(data.wardrobe.length, 9); assert.equal(data.wardrobeVersion, wardrobeVersion);
  for (const item of data.wardrobe) {
    const image = await fetch(base + item.imageUrl);
    assert.equal(image.status, 200); assert.match(image.headers.get('content-type'), /image\/svg\+xml/);
    assert.match(await image.text(), /demo illustration/);
  }
  const response = await post(base, request); assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.outfits.length, 3); validateOutfitResponse(result, request);
  assert.deepEqual(captured.trip, request.trip); assert.deepEqual(captured.styleProfile, request.styleProfile);
  assert.match(result.warnings[0], /Mock outfits/);
  assert.ok(result.outfits.every((look) => look.attractionIds.length === 0));
  // The browser's shared modules use relative imports, so all siblings must be served.
  for (const path of ['/wardrobe', '/wardrobe.mjs', '/shared/saved-trip.mjs', '/outfits.mjs', '/shared/outfit-plans.mjs', '/shared/style-analysis.mjs', '/shared/trip.mjs', '/shared/weather.mjs']) {
    assert.equal((await fetch(base + path)).status, 200);
  }
});

test('seven-day plans use only selected garment IDs and have one unique look per date', () => {
  const request = input(); request.trip = buildTrip(catalog[1].destination, '2026-11-24', '2026-11-30', []);
  request.wardrobe = request.wardrobe.filter((item) => ['top-01', 'bottom-01', 'shoes-01'].includes(item.id));
  const result = mockOutfits(request); assert.equal(result.outfits.length, 7);
  assert.equal(new Set(result.outfits.map((look) => look.id)).size, 7);
  for (const look of result.outfits) assert.deepEqual(look.wardrobeItemIds, ['top-01', 'bottom-01', 'shoes-01']);
});

test('removing shoes creates missing-item descriptors instead of invented wardrobe or product IDs', () => {
  const request = input(); request.wardrobe = request.wardrobe.filter((item) => item.category !== 'shoes');
  const result = mockOutfits(request);
  assert.equal(new Set(result.outfits.flatMap((look) => look.missingItems.map((gap) => gap.id))).size, 3);
  for (const look of result.outfits) {
    assert.equal(look.missingItems[0].priority, 'essential');
    assert.match(look.missingItems[0].description, /shoes/);
    assert.equal(look.missingItems[0].price, undefined);
  }
});

test('mock temperature/rain rules use actual request values, while unavailable weather stays unknown', () => {
  const request = input();
  request.trip.weather[0] = { ...request.trip.weather[0], kind: 'forecast', minTempC: 0, maxTempC: 8, precipitationProbabilityPct: 60,
    sourceUrl: 'https://open-meteo.com/', fetchedAt: '2026-11-21T12:00:00Z' };
  const result = mockOutfits(request);
  assert.ok(result.outfits[0].wardrobeItemIds.includes('outer-01'));
  assert.ok(result.outfits[0].wardrobeItemIds.includes('accessory-01'));
  assert.match(result.outfits[0].missingItems[0].description, /umbrella/);
  assert.ok(!result.outfits[1].wardrobeItemIds.includes('outer-01'));
  assert.match(result.outfits[1].stylingTips[0], /Weather is unavailable/);
});

test('incomplete requests, duplicate wardrobes, unsupported media, and per-place dates are rejected', () => {
  for (const mutate of [
    (r) => { r.styleProfile = null; }, (r) => { r.wardrobe = []; }, (r) => { r.wardrobe.push(r.wardrobe[0]); },
    (r) => { r.trip.weather = []; }, (r) => { r.media = [{}]; }, (r) => { r.trip.attractions[0].date = r.trip.startDate; }
  ]) { const request = input(); mutate(request); assert.throws(() => validateOutfitRequest(request), { code: 'INVALID_OUTFIT_REQUEST' }); }
});

test('response validation rejects unknown/excluded items, missing days, stale IDs, duplicate IDs and scheduled places', () => {
  const request = input();
  for (const mutate of [
    (r) => { r.outfits[0].wardrobeItemIds.push('unknown'); }, (r) => { r.outfits.pop(); },
    (r) => { r.requestId = 'old'; }, (r) => { r.inputRevision = 0; },
    (r) => { r.outfits[1].id = r.outfits[0].id; }, (r) => { r.outfits[0].attractionIds = ['cafe']; },
    (r) => { r.outfits[0].date = '2026-12-01'; }, (r) => { r.outfits[0].missingItems = [{ id: 'gap' }]; }
  ]) { const response = mockOutfits(request); mutate(response); assert.throws(() => validateOutfitResponse(response, request), { code: 'INVALID_OUTFIT_RESPONSE' }); }
});

test('B rejects stale wardrobe versions and altered metadata; live mode never receives demo SVG requests', async (t) => {
  const base = await app(t);
  for (const mutate of [(r) => { r.wardrobeVersion = 'old'; }, (r) => { r.wardrobe[0].imageUrl = 'https://untrusted.example/photo'; }]) {
    const request = input(); mutate(request); assert.equal((await post(base, request)).status, 400);
  }
  const live = await app(t, { provider: 'live', fetchImpl: () => { throw new Error('Must not contact live AI'); } });
  assert.equal((await post(live, input())).status, 503);
});

test('B returns an error for incomplete upstream plans without silently replacing them', async (t) => {
  const result = mockOutfits(input()); result.outfits.pop();
  const base = await app(t, { fetchImpl: async () => Response.json(result) });
  const response = await post(base, input()); assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, 'INVALID_OUTFIT_RESPONSE');
});


test('edited nested profile reaches outfit planning intact alongside derived compatibility fields', async t => {
  const request = input();
  request.styleProfile = buildStyleProfile({ summary: 'Personal travel style.', userTags: ['comfortable'], avoidances: [],
    directions: [{ id: 'dir-1', name: 'My tailoring', description: 'Easy structured layers.', strength: 'dominant', source: 'media',
      visualReferenceIds: ['photo-1'], colors: ['navy'], silhouettes: ['wide-leg'], stylingPatterns: [], keyPieces: ['blazer'] }] });
  let captured;
  const base = await app(t, { fetchImpl: async (url, options) => { captured = JSON.parse(options.body); return fetch(url, options); } });
  const response = await post(base, request);
  assert.equal(response.status, 200);
  assert.deepEqual(captured.styleProfile, request.styleProfile);
  assert.deepEqual(captured.styleProfile.styleTags, ['comfortable', 'My tailoring']);
  assert.deepEqual(captured.styleProfile.colors, ['navy']);
  assert.deepEqual(captured.media, []); // Reference IDs are provenance, not retained image bytes.
});
