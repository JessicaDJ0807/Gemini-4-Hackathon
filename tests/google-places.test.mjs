import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlacesClient } from '../apps/web/google-places.mjs';
import { createWebServer } from '../apps/web/server.mjs';
const request = { input: 'Cartier', latitude: 48.8534, longitude: 2.3488, countryCode: 'FR', sessionToken: 'test-session' };
// Synthetic provider response: this does not establish a real Google match/ranking.
const prediction = { suggestions: [{ placePrediction: { placeId: 'fixture-cartier', text: { text: 'Fondation Cartier, Paris, France' }, structuredFormat: { mainText: { text: 'Fondation Cartier' }, secondaryText: { text: 'Paris, France' } } } }] };

test('autocomplete scopes query to the destination vicinity/country and keeps the key server-side', async () => {
  const client = createPlacesClient({ apiKey: 'test-key', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://places.googleapis.com/v1/places:autocomplete');
    assert.equal(options.headers['X-Goog-Api-Key'], 'test-key');
    const body = JSON.parse(options.body);
    assert.equal(body.input, 'Cartier');
    assert.equal(body.sessionToken, request.sessionToken);
    assert.deepEqual(body.includedRegionCodes, ['fr']);
    assert.deepEqual(body.locationRestriction.circle, { center: { latitude: request.latitude, longitude: request.longitude }, radius: 25000 });
    return Response.json(prediction);
  } });
  assert.equal((await client.autocomplete(request)).suggestions[0].placeId, 'fixture-cartier');
});

test('selection resolves a provider place with the same autocomplete session token', async () => {
  const client = createPlacesClient({ apiKey: 'test-key', fetchImpl: async (url, options) => {
    assert.equal(new URL(url).searchParams.get('sessionToken'), request.sessionToken);
    assert.ok(options.headers['X-Goog-FieldMask'].includes('attributions'));
    return Response.json({ id: 'fixture-cartier', displayName: { text: 'Fondation Cartier' }, formattedAddress: 'Paris, France', location: { latitude: 48.86, longitude: 2.33 }, attributions: [{ provider: 'Example provider' }] });
  } });
  const { place } = await client.details({ placeId: 'fixture-cartier', sessionToken: request.sessionToken });
  assert.equal(place.source, 'provider'); assert.equal(place.googlePlaceId, 'fixture-cartier');
  assert.equal(place.date, undefined); assert.deepEqual(place.attributions, ['Example provider']);
});

test('missing key, invalid requests, and upstream failures return clear errors without demo substitutions', async () => {
  await assert.rejects(createPlacesClient().autocomplete(request), { code: 'PLACES_NOT_CONFIGURED' });
  const client = createPlacesClient({ apiKey: 'test-key', fetchImpl: async () => Response.json({ error: 'not authorized' }, { status: 403 }) });
  await assert.rejects(client.autocomplete({ ...request, latitude: 99 }), { status: 400 });
  await assert.rejects(client.autocomplete({ ...request, input: 'x' }), { status: 400 });
  await assert.rejects(client.details({ placeId: '../bad' }), { status: 400 });
  await assert.rejects(client.autocomplete(request), { code: 'PLACES_UNAVAILABLE' });
});

test('no Google matches returns an empty list; wrong details identity is rejected', async () => {
  const client = createPlacesClient({ apiKey: 'test-key', fetchImpl: async () => Response.json({}) });
  assert.deepEqual(await client.autocomplete(request), { suggestions: [] });
  await assert.rejects(client.details({ placeId: 'fixture-cartier' }), { code: 'INVALID_PLACES_RESPONSE' });
});

test('B proxies Google requests and serves availability without exposing credentials', async (t) => {
  const server = createWebServer({ provider: 'demo', placesKey: 'test-key', placesFetch: async () => Response.json(prediction) });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await (await fetch(base + '/api/places/config')).json(), { enabled: true });
  const response = await fetch(base + '/api/places/autocomplete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).suggestions.length, 1);
  for (const path of ['/place-search.mjs', '/trip']) assert.ok(!(await (await fetch(base + path)).text()).includes('test-key'));
});
