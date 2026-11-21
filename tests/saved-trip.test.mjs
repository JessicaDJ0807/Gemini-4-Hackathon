import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrip, tripForStorage } from '../packages/contracts/trip.mjs';
import { restoreSavedTrip } from '../packages/contracts/saved-trip.mjs';
import { catalog } from '../data/attractions/catalog.mjs';
import { mockOutfits } from '../scripts/mock-outfits.mjs';
import { wardrobe, wardrobeVersion } from '../data/demo-wardrobe/wardrobe.mjs';

function confirmedTrip() {
  const trip = buildTrip(catalog[1].destination, '2026-11-24', '2026-11-24', []);
  trip.weather = [{ date: '2026-11-24', kind: 'forecast', minTempC: 2, maxTempC: 8, precipitationProbabilityPct: 80,
    sourceUrl: 'https://open-meteo.com/', fetchedAt: '2026-11-21T12:00:00Z' }];
  return trip;
}
test('weather survives the trip-to-wardrobe storage boundary and still affects outfit suggestions', async () => {
  const saved = JSON.parse(JSON.stringify(tripForStorage(confirmedTrip())));
  const trip = await restoreSavedTrip(saved);
  assert.deepEqual(trip.weather, saved.weather);
  const result = mockOutfits({ requestId: 'next-page', inputRevision: 1, trip, wardrobeVersion, wardrobe,
    styleProfile: { styleTags: ['classic'], colors: [], avoidances: [], visualReferenceIds: [] }, media: [] });
  assert.ok(result.outfits[0].wardrobeItemIds.includes('outer-01'));
  assert.ok(result.outfits[0].missingItems.some(item => /umbrella/i.test(item.description)));
  trip.weather[0].minTempC = 20;
  assert.equal(saved.weather[0].minTempC, 2);
});
test('wardrobe restores Google place references without storing provider display details', async () => {
  const trip = confirmedTrip();
  const place = { id: 'google:one', googlePlaceId: 'one', source: 'provider', name: 'Museum', activityTags: [] };
  trip.attractions = [place];
  const saved = tripForStorage(trip); assert.equal(saved.attractions[0].name, undefined);
  const restored = await restoreSavedTrip(saved, async id => { assert.equal(id, 'one'); return place; });
  assert.equal(restored.attractions[0].name, 'Museum'); assert.deepEqual(restored.weather, trip.weather);
});
test('missing trips and weather that does not match trip dates require reconfirmation', async () => {
  await assert.rejects(restoreSavedTrip(null));
  const saved = confirmedTrip(); saved.weather[0].date = '2026-11-25';
  await assert.rejects(restoreSavedTrip(saved), /Weather dates/);
});
