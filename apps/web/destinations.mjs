import { catalog } from '../../data/attractions/catalog.mjs';
import { validDestination } from '../../packages/contracts/trip.mjs';
import { ApiError } from '../../packages/contracts/style-analysis.mjs';

export async function searchDestinations(query, fetchImpl = fetch) {
  const search = query?.trim();
  if (!search || search.length < 2 || search.length > 100) throw new ApiError(400, 'INVALID_LOCATION', 'Enter a city name of 2–100 characters.');
  const local = catalog.filter((entry) => entry.aliases.includes(search.toLowerCase())).map((entry) => entry.destination);
  // Local demo cities remain usable without a network connection; country is shown for confirmation.
  if (local.length) return { destinations: local, source: 'curated' };
  let response;
  try {
    response = await fetchImpl(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: search, count: '5', language: 'en', format: 'json' })}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error();
    const payload = await response.json();
    if (payload.results !== undefined && !Array.isArray(payload.results)) throw new Error();
    const destinations = (payload.results ?? []).filter((place) => place && typeof place === 'object').map((place) => ({
      id: `geonames-${place.id}`, name: place.name, countryCode: place.country_code,
      latitude: place.latitude, longitude: place.longitude, timezone: place.timezone,
      ...(place.admin1 ? { region: place.admin1 } : {})
    })).filter((place) => /^geonames-\d+$/.test(place.id) && validDestination(place)).map((place) => {
      const known = catalog.find(({ destination, aliases }) => destination.countryCode === place.countryCode &&
        aliases.includes(place.name.toLowerCase()) && Math.abs(destination.latitude - place.latitude) < 0.25 &&
        Math.abs(destination.longitude - place.longitude) < 0.25);
      return known?.destination ?? place;
    });
    return { destinations, source: 'Open-Meteo / GeoNames' };
  } catch {
    throw new ApiError(503, 'LOCATION_UNAVAILABLE', 'City search is unavailable. Try again, or use New York, Paris, or Tokyo.', true);
  }
}
