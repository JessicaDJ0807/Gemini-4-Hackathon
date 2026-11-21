import { buildTrip, tripDates } from './trip.mjs';
import { validateWeather } from './weather.mjs';

// Restore the confirmed weather instead of replacing it with buildTrip's defaults.
export async function restoreSavedTrip(saved, resolvePlace) {
  if (!saved || !Array.isArray(saved.attractions)) throw new Error('Confirm your trip before choosing your wardrobe.');
  const places = await Promise.all(saved.attractions.map(place => place.googlePlaceId ? resolvePlace(place.googlePlaceId) : place));
  const trip = buildTrip(saved.destination, saved.startDate, saved.endDate, places);
  trip.weather = structuredClone(validateWeather(saved.weather, tripDates(trip.startDate, trip.endDate)));
  return trip;
}
