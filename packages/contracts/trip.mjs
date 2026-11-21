// Dates are destination-local calendar days; UTC is only used for date arithmetic.
export function tripDates(start, end) {
  const parse = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Choose valid start and end dates.');
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new Error('Choose valid start and end dates.');
    return date.valueOf();
  };
  const first = parse(start), last = parse(end);
  const count = (last - first) / 86400000 + 1;
  if (count < 1 || count > 7) throw new Error('Choose a trip of 1–7 days, with the end on or after the start.');
  return Array.from({ length: count }, (_, i) => new Date(first + i * 86400000).toISOString().slice(0, 10));
}

export function validDestination(value) {
  if (!value || !['id', 'name', 'countryCode', 'timezone'].every((key) => typeof value[key] === 'string' && value[key].trim())) return false;
  if (!/^[A-Z]{2}$/.test(value.countryCode) || !Number.isFinite(value.latitude) || Math.abs(value.latitude) > 90 ||
      !Number.isFinite(value.longitude) || Math.abs(value.longitude) > 180) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value.timezone }); return true; } catch { return false; }
}

export function buildTrip(destination, startDate, endDate, attractions) {
  if (!validDestination(destination)) throw new Error('Select a destination from the search results.');
  const dates = tripDates(startDate, endDate);
  if (!Array.isArray(attractions) || new Set(attractions.map((a) => a?.id)).size !== attractions.length) throw new Error('Each place needs a unique ID.');
  for (const place of attractions) {
    if (!place || typeof place.id !== 'string' || !place.id || typeof place.name !== 'string' || !place.name.trim() || place.name.length > 120 ||
        !['curated', 'provider', 'user'].includes(place.source) || !Array.isArray(place.activityTags) ||
        !place.activityTags.every((tag) => typeof tag === 'string' && tag.trim())) {
      throw new Error('Check place names and activity tags.');
    }
  }
  return {
    destination: structuredClone(destination), startDate, endDate, attractions: structuredClone(attractions.map(({ date, ...place }) => place)),
    weather: dates.map((date) => ({ date, kind: 'unavailable', minTempC: null, maxTempC: null, precipitationProbabilityPct: null }))
  };
}

// Keep only Google identifiers in storage; refresh display details on reload.
export function tripForStorage(trip) {
  return { ...trip, attractions: trip.attractions.map((place) => place.googlePlaceId ?
    { id: place.id, source: 'provider', googlePlaceId: place.googlePlaceId } : place) };
}
