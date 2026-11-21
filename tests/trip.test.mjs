import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrip, tripDates, validDestination, tripForStorage } from '../packages/contracts/trip.mjs';
import { catalog, suggestAttractions } from '../data/attractions/catalog.mjs';
import { searchDestinations } from '../apps/web/destinations.mjs';
import { createWebServer } from '../apps/web/server.mjs';
const nyc = catalog[0].destination;
const start = '2026-11-24', end = '2026-11-26';
const custom = { id: 'custom-1', name: 'My saved café', source: 'user', activityTags: [] };

test('calendar validation covers leap days, reversed dates, 1–7 days, and DST without time shifts', () => {
  assert.deepEqual(tripDates(start, start), [start]);
  assert.equal(tripDates('2026-11-01', '2026-11-07').length, 7);
  assert.deepEqual(tripDates('2026-03-07', '2026-03-09'), ['2026-03-07', '2026-03-08', '2026-03-09']);
  assert.deepEqual(tripDates('2028-02-28', '2028-03-01'), ['2028-02-28', '2028-02-29', '2028-03-01']);
  for (const args of [['', end], ['2026-02-29', '2026-03-01'], [end, start], ['2026-11-01', '2026-11-08']]) {
    assert.throws(() => tripDates(...args));
  }
});

test('each curated city offers five distinct, unscheduled attractions for the whole trip', () => {
  for (const { destination } of catalog) {
    const result = suggestAttractions(destination.id, () => 0.5);
    assert.equal(result.attractions.length, 5);
    assert.equal(new Set(result.attractions.map((place) => place.id)).size, 5);
    assert.ok(result.attractions.every((place) => place.source === 'curated' && !place.date));
    assert.match(result.sourceUrl, /^https:/);
  }
  const before = JSON.stringify(catalog);
  suggestAttractions('nyc', () => 0);
  assert.equal(JSON.stringify(catalog), before);
  assert.deepEqual(suggestAttractions('unknown'), { attractions: [], sourceUrl: null });
});

test('confirmed trip permits custom places, open days, and more than five edited places', () => {
  const places = [...suggestAttractions('nyc').attractions, custom, { ...custom, id: 'custom-2', name: 'A restaurant', date: start }];
  const trip = buildTrip(nyc, start, end, places);
  assert.equal(trip.attractions.length, 7);
  assert.deepEqual(trip.weather.map((day) => day.date), tripDates(start, end));
  assert.ok(trip.weather.every((day) => day.kind === 'unavailable' && day.minTempC === null));
  assert.equal(buildTrip(nyc, start, end, []).attractions.length, 0);
  trip.attractions[0].name = 'Edited copy';
  assert.notEqual(trip.attractions[0].name, places[0].name);
});

test('rejects unknown destinations, duplicate IDs, and invalid custom names', () => {
  assert.equal(validDestination({ ...nyc, timezone: 'made-up' }), false);
  assert.equal(validDestination({ ...nyc, latitude: 99 }), false);
  assert.throws(() => buildTrip(null, start, end, []));
  for (const places of [[custom, custom], [{ ...custom, name: ' ' }]]) {
    assert.throws(() => buildTrip(nyc, start, end, places));
  }
});

test('places have no visit dates, including when restoring an older saved trip', () => {
  const trip = buildTrip(nyc, start, end, [{ ...custom, date: '2026-12-01' }]);
  assert.equal(trip.attractions[0].date, undefined);
  const changed = buildTrip(nyc, start, start, trip.attractions);
  assert.deepEqual(changed.attractions, trip.attractions);
});

test('Google details stay in memory; persisted trip contains only place identifiers', () => {
  const place = { ...custom, id: 'google:test-id', source: 'provider', googlePlaceId: 'test-id', address: 'Test address', coordinates: { latitude: 1, longitude: 2 } };
  const trip = buildTrip(nyc, start, end, [place, custom]);
  const stored = tripForStorage(trip);
  assert.deepEqual(stored.attractions[0], { id: 'google:test-id', source: 'provider', googlePlaceId: 'test-id' });
  assert.deepEqual(stored.attractions[1], custom);
  assert.equal(trip.attractions[0].address, 'Test address');
});

test('curated cities resolve offline, and other cities preserve country and timezone for disambiguation', async () => {
  const local = await searchDestinations('NYC', () => { throw new Error('Should not use network'); });
  assert.deepEqual(local.destinations, [nyc]);
  const remote = await searchDestinations('London', async (url) => {
    assert.equal(new URL(url).searchParams.get('name'), 'London');
    return Response.json({ results: [
      { id: 2643743, name: 'London', country_code: 'GB', latitude: 51.5085, longitude: -0.1257, timezone: 'Europe/London', admin1: 'England' },
      { id: 1, name: 'Broken city' }, null
    ] });
  });
  assert.equal(remote.destinations.length, 1);
  assert.equal(remote.destinations[0].countryCode, 'GB');
  assert.equal(remote.destinations[0].region, 'England');
  const paris = await searchDestinations('Paris, France', async () => Response.json({ results: [
    { id: 2988507, name: 'Paris', country_code: 'FR', latitude: 48.8534, longitude: 2.3488, timezone: 'Europe/Paris' }
  ] }));
  assert.equal(paris.destinations[0].id, 'paris');
});

test('city lookup distinguishes no results, invalid input, and a provider outage', async () => {
  assert.deepEqual((await searchDestinations('Nowhere', async () => Response.json({}))).destinations, []);
  await assert.rejects(searchDestinations('x'), { status: 400 });
  await assert.rejects(searchDestinations('London', async () => { throw new Error(); }), { status: 503 });
});

test('B serves trip UI and lookup APIs over HTTP without exposing the service token', async (t) => {
  const server = createWebServer({ aiBaseUrl: 'http://127.0.0.1:1', token: 'secret-test-token', provider: 'demo' });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/trip', '/trip.mjs', '/trip-contracts.mjs']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.ok(!(await response.text()).includes('secret-test-token'));
  }
  const city = await (await fetch(base + '/api/destinations?q=Paris')).json();
  assert.equal(city.destinations[0].id, 'paris');
  const places = await (await fetch(base + '/api/attractions?destinationId=paris')).json();
  assert.equal(places.attractions.length, 5);
  assert.equal((await fetch(base + '/api/attractions')).status, 400);
  assert.equal((await fetch(base + '/api/destinations?q=x')).status, 400);
});
