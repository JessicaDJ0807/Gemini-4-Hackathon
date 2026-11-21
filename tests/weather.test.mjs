import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTripWeather, localDate } from '../apps/web/weather.mjs';
import { validateWeather, unavailableWeather } from '../packages/contracts/weather.mjs';
import { buildTrip, tripForStorage } from '../packages/contracts/trip.mjs';
import { createWebServer } from '../apps/web/server.mjs';
import { catalog } from '../data/attractions/catalog.mjs';
const destination = catalog[0].destination;
const now = () => new Date('2026-11-21T12:00:00Z');
const request = { destination, startDate: '2026-11-24', endDate: '2026-11-26' };
function payload(dates = ['2026-11-24', '2026-11-25', '2026-11-26']) {
  return { daily_units: { temperature_2m_min: '°C', temperature_2m_max: '°C', precipitation_probability_max: '%' },
    daily: { time: dates, temperature_2m_min: dates.map(() => 0), temperature_2m_max: dates.map(() => 12.5), precipitation_probability_max: dates.map(() => 0) } };
}

test('requests destination-local daily forecasts in Celsius and preserves genuine zero values', async () => {
  const result = await getTripWeather(request, { now, fetchImpl: async (url) => {
    const query = new URL(url).searchParams;
    assert.equal(query.get('timezone'), 'America/New_York');
    assert.equal(query.get('temperature_unit'), 'celsius');
    assert.equal(query.get('forecast_days'), '16');
    assert.equal(query.get('latitude'), String(destination.latitude));
    return Response.json(payload());
  } });
  assert.equal(result.weather.length, 3); assert.deepEqual(result.warnings, []);
  assert.equal(result.weather[0].minTempC, 0); assert.equal(result.weather[0].precipitationProbabilityPct, 0);
  assert.equal(result.weather[0].kind, 'forecast'); assert.equal(result.weather[0].fetchedAt, now().toISOString());
  assert.match(result.weather[0].sourceUrl, /^https:\/\/api.open-meteo.com/);
});

test('forecast horizon follows the destination calendar, including opposite sides of UTC midnight', () => {
  const instant = new Date('2026-11-21T01:00:00Z');
  assert.equal(localDate(instant, 'America/New_York'), '2026-11-20');
  assert.equal(localDate(instant, 'Asia/Tokyo'), '2026-11-21');
});

test('far-future and past trips skip the provider and keep every measurement null', async () => {
  for (const date of ['2027-01-01', '2026-11-01']) {
    const result = await getTripWeather({ ...request, startDate: date, endDate: date }, { now, fetchImpl: () => { throw new Error('Must not fetch'); } });
    assert.deepEqual(result.weather, unavailableWeather([date])); assert.equal(result.retryable, false);
    assert.match(result.warnings[0], /forecast window/);
  }
});

test('partially covered trips keep the 16th day forecast and mark later days unavailable', async () => {
  const dates = ['2026-12-06', '2026-12-07', '2026-12-08'];
  const result = await getTripWeather({ ...request, startDate: dates[0], endDate: dates[2] }, { now, fetchImpl: async () => Response.json(payload(dates)) });
  assert.equal(result.weather[0].kind, 'forecast');
  assert.deepEqual(result.weather.slice(1), unavailableWeather(dates.slice(1)));
});

test('missing provider days and invalid readings remain unknown; a partial forecast retains nulls', async () => {
  const p = payload(); p.daily.temperature_2m_min[0] = null;
  p.daily.precipitation_probability_max[1] = 150; p.daily.temperature_2m_max[2] = 'warm';
  const result = await getTripWeather(request, { now, fetchImpl: async () => Response.json(p) });
  assert.equal(result.weather[0].kind, 'forecast'); assert.equal(result.weather[0].minTempC, null);
  assert.equal(result.weather[1].kind, 'unavailable'); assert.equal(result.weather[2].kind, 'unavailable');
  assert.ok(result.warnings.length); assert.equal(result.retryable, true);
  const missing = await getTripWeather(request, { now, fetchImpl: async () => Response.json(payload(['2026-11-24'])) });
  assert.equal(missing.weather[1].kind, 'unavailable');
});

test('provider outages, timeouts, malformed arrays, and incorrect units allow confirmation with unavailable weather', async () => {
  const wrongUnits = payload(); wrongUnits.daily_units.temperature_2m_min = '°F';
  for (const fetchImpl of [
    async () => { throw new TypeError('offline'); }, async () => { throw new DOMException('timeout', 'TimeoutError'); },
    async () => Response.json({}, { status: 429 }), async () => Response.json({ daily: {} }), async () => Response.json(wrongUnits)
  ]) {
    const result = await getTripWeather(request, { now, fetchImpl });
    assert.ok(result.weather.every((day) => day.kind === 'unavailable')); assert.equal(result.retryable, true);
  }
});

test('invalid request dates and destinations are rejected before any provider call', async () => {
  for (const body of [{}, { ...request, endDate: '2026-11-20' }, { ...request, destination: { ...destination, timezone: 'fake' } }]) {
    await assert.rejects(getTripWeather(body, { now }), { status: 400, code: 'INVALID_WEATHER_REQUEST' });
  }
});

test('weather contract rejects wrong dates, missing source, inverted temperatures, and invented unavailable values', () => {
  const day = { date: request.startDate, kind: 'forecast', minTempC: 0, maxTempC: 12, precipitationProbabilityPct: 30, sourceUrl: 'https://open-meteo.com/', fetchedAt: now().toISOString() };
  for (const invalid of [{ ...day, date: '2026-11-25' }, { ...day, sourceUrl: undefined }, { ...day, minTempC: 20 }, { ...day, kind: 'unavailable' }]) {
    assert.throws(() => validateWeather([invalid], [request.startDate]));
  }
  assert.throws(() => validateWeather([], [request.startDate]));
});

test('confirmed trip serialization retains forecast data for the later A request', async () => {
  const result = await getTripWeather(request, { now, fetchImpl: async () => Response.json(payload()) });
  const trip = buildTrip(destination, request.startDate, request.endDate, []);
  trip.weather = result.weather;
  const saved = JSON.parse(JSON.stringify(tripForStorage(trip)));
  assert.deepEqual(saved.weather, result.weather);
});

test('B exposes the weather endpoint and validation over HTTP', async (t) => {
  const server = createWebServer({ provider: 'demo', weatherNow: now, weatherFetch: async () => Response.json(payload()) });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/api/weather`;
  const post = (body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const response = await post(request); assert.equal(response.status, 200);
  assert.equal((await response.json()).weather[0].kind, 'forecast');
  assert.equal((await post({})).status, 400);
});
