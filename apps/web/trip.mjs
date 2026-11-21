import { attachPlacePhotos } from '/place-photos.mjs';
import { validateWeather } from '/weather-contracts.mjs';
import { attachPlaceSearch, placeDetails } from '/place-search.mjs';
import { validProfile } from '/contracts.mjs';
import { buildTrip, tripDates, validDestination, tripForStorage } from '/trip-contracts.mjs';

const $ = (id) => document.getElementById(id);
const tripKey = 'travel-stylist.confirmed-trip.v1';
let destination = null;
let attractions = [];
let initialized = false;
let cityRequest = 0;
let placeRequest = 0;
let weatherRequest = 0;
let weatherController;
const placePhotos = attachPlacePhotos({ onChange: renderPlaces, onError: error });
const dates = () => tripDates($('start-date').value, $('end-date').value);
const placeSearch = attachPlaceSearch({ getDestination: () => destination, onSelect: addPlace });
function addPlace(place) {
  dates();
  if (attractions.some((entry) => entry.id === place.id || entry.name.toLowerCase() === place.name.toLowerCase())) throw new Error('That place is already in your trip.');
  buildTrip(destination, $('start-date').value, $('end-date').value, [...attractions, place]);
  attractions.push(place); invalidate(); renderPlaces();
}
function attribution(place) {
  const text = node('p', ['Google Maps', ...(place.attributions ?? [])].join(' · '), 'google-attribution');
  text.translate = false; return text;
}
function error(message) { $('trip-error').textContent = message; $('trip-error').hidden = false; }
function invalidate() {
  weatherRequest++; weatherController?.abort(); $('confirm-trip').disabled = false; $('confirm-trip').textContent = 'Confirm my trip →';
  $('trip-status').textContent = '';
  $('trip-error').hidden = true;
  try { sessionStorage.removeItem(tripKey); } catch { /* Storage is optional. */ }
}
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function resetDestination() {
  destination = null; attractions = []; initialized = false;
  placeSearch.reset(); $('custom-place').value = '';
  placeRequest++;
  $('places-section').hidden = true;
  $('places-source').hidden = true;
  $('destination-label').textContent = 'Choose a city from the search results.';
  $('suggest').disabled = false;
  $('suggest').textContent = 'Suggest places for my trip';
  $('trip-status').textContent = '';
  invalidate();
}
function renderPlaces() {
  $('places').replaceChildren();
  placePhotos.prune(attractions);
  $('place-photo-credits').replaceChildren(placePhotos.credits(attractions));
  $('place-count').textContent = `${attractions.length} selected`;
  if (!attractions.length) $('places').append(node('li', 'Your trip is wide open. Add a spot below, or keep it flexible.', 'places-empty'));
  for (const place of attractions) {
    const row = node('li', undefined, 'place-row');
    const photo = placePhotos.thumbnail(place);
    const info = node('div', undefined, 'place-info');
    info.append(node('h3', place.name));
    if (place.googlePlaceId) {
      if (place.address) info.append(node('p', place.address, 'hint'));
      info.append(attribution(place));
    } else if (place.source === 'user') info.append(node('span', 'Added by you', 'place-origin'));
    const remove = node('button', '×', 'remove-place'); remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${place.name}`); remove.title = `Remove ${place.name}`;
    remove.addEventListener('click', () => {
      attractions = attractions.filter((entry) => entry.id !== place.id); invalidate(); renderPlaces();
    });
    row.append(photo, info, remove); $('places').append(row);
  }
}
$('location').addEventListener('input', () => {
  cityRequest++; resetDestination(); $('city-results').replaceChildren(); $('search-city').disabled = false;
});
$('location-form').addEventListener('submit', async (event) => {
  event.preventDefault(); resetDestination();
  const request = ++cityRequest;
  $('city-results').replaceChildren(); $('search-city').disabled = true;
  $('trip-status').textContent = 'Looking for your city…';
  try {
    const response = await fetch(`/api/destinations?q=${encodeURIComponent($('location').value.trim())}`, { signal: AbortSignal.timeout(10000) });
    const result = await response.json();
    if (request !== cityRequest) return;
    if (!response.ok) throw new Error(result.error?.message ?? 'City search failed. Please try again.');
    if (!Array.isArray(result.destinations) || !result.destinations.every(validDestination)) throw new Error('City search returned an invalid result.');
    $('trip-status').textContent = result.destinations.length ? 'Select the city you mean.' : 'No matching city found. Try a city name and country.';
    for (const city of result.destinations) {
      const label = [city.name, city.region, city.countryCode].filter(Boolean).join(', ');
      const button = node('button', label, 'secondary'); button.type = 'button';
      button.addEventListener('click', () => {
        resetDestination(); destination = city; $('location').value = city.name;
        $('destination-label').textContent = `Selected: ${label}`;
        $('city-results').replaceChildren(); $('start-date').focus();
      });
      $('city-results').append(button);
    }
  } catch (cause) {
    if (request === cityRequest) { error(cause.name === 'TimeoutError' ? 'City search timed out. Please try again.' : cause.message); $('trip-status').textContent = ''; }
  } finally { if (request === cityRequest) $('search-city').disabled = false; }
});

$('dates-form').addEventListener('input', () => {
  placeRequest++; invalidate(); $('suggest').disabled = false; $('trip-status').textContent = '';
  try {
    dates();
    $('places-section').inert = false;
    $('confirm-trip').disabled = false;
    if (initialized) renderPlaces();
  } catch (cause) {
    $('places-section').inert = true; $('confirm-trip').disabled = true;
    if (initialized) error(cause.message);
  }
});
$('dates-form').addEventListener('submit', async (event) => {
  event.preventDefault(); invalidate();
  try {
    buildTrip(destination, $('start-date').value, $('end-date').value, attractions);
    if (initialized) { renderPlaces(); $('places-title').focus(); return; }
  } catch (cause) { error(cause.message); return; }
  const request = ++placeRequest;
  $('suggest').disabled = true; $('trip-status').textContent = 'Finding a few places for your trip…';
  try {
    const response = await fetch(`/api/attractions?destinationId=${encodeURIComponent(destination.id)}`, { signal: AbortSignal.timeout(10000) });
    const result = await response.json();
    if (request !== placeRequest) return;
    if (!response.ok) throw new Error(result.error?.message ?? 'Could not load suggestions. Please retry.');
    if (!Array.isArray(result.attractions) || (result.attractions.length !== 0 && (result.attractions.length < 3 || result.attractions.length > 5))) throw new Error('Invalid attraction suggestions. Please retry.');
    buildTrip(destination, $('start-date').value, $('end-date').value, result.attractions);
    attractions = result.attractions; initialized = true;
    $('suggestion-note').textContent = attractions.length ? `A few ideas for ${destination.name}. Keep what you like, or add your own.` : 'Add the spots you’d like to explore.';
    if (typeof result.sourceUrl === 'string' && result.sourceUrl.startsWith('https://')) {
      $('places-source').href = result.sourceUrl; $('places-source').hidden = false;
    }
    $('places-section').hidden = false; $('places-section').inert = false; $('confirm-trip').disabled = false;
    $('suggest').textContent = 'Review my places'; $('trip-status').textContent = '';
    renderPlaces(); $('places-title').focus();
  } catch (cause) {
    if (request === placeRequest) { error(cause.name === 'TimeoutError' ? 'Loading places timed out. Please retry.' : cause.message); $('trip-status').textContent = ''; }
  } finally { if (request === placeRequest) $('suggest').disabled = false; }
});

$('custom-form').addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    dates();
    const name = $('custom-place').value.trim();
    if (!name || name.length > 120) throw new Error('Enter a place name of 1–120 characters.');
    addPlace({ id: `custom-${crypto.randomUUID()}`, name, source: 'user', activityTags: [] });
    placeSearch.reset(); $('custom-place').value = '';
    $('trip-status').textContent = `Added ${name}.`;
  } catch (cause) { error(cause.message); }
});
async function confirmTrip() {
  let trip;
  try { trip = buildTrip(destination, $('start-date').value, $('end-date').value, attractions); }
  catch (cause) { error(cause.message); return; }
  const request = ++weatherRequest;
  weatherController?.abort(); weatherController = new AbortController();
  $('confirm-trip').disabled = true; $('trip-error').hidden = true;
  $('confirm-trip').textContent = 'Saving your trip…';
  // Do not retain an old forecast as the currently confirmed trip during a refresh.
  try { sessionStorage.removeItem(tripKey); } catch { /* Storage is optional. */ }
  $('trip-status').textContent = 'Preparing your trip…';
  try {
    const response = await fetch('/api/weather', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination: trip.destination, startDate: trip.startDate, endDate: trip.endDate }),
      signal: AbortSignal.any([weatherController.signal, AbortSignal.timeout(10000)])
    });
    const result = await response.json();
    if (request !== weatherRequest) return;
    if (!response.ok || !Array.isArray(result.warnings) || !result.warnings.every((warning) => typeof warning === 'string')) throw new Error('Invalid weather response');
    trip.weather = validateWeather(result.weather, tripDates(trip.startDate, trip.endDate));
  } catch {
    if (request !== weatherRequest) return;
    // buildTrip supplies explicit unavailable readings when weather cannot be fetched.
  }
  if (request !== weatherRequest) return;
  try {
    sessionStorage.setItem(tripKey, JSON.stringify(tripForStorage(trip)));
    window.location.assign('/wardrobe');
  } catch {
    error('Could not save your trip. Enable browser session storage and try again.');
    $('confirm-trip').disabled = false; $('confirm-trip').textContent = 'Confirm my trip →';
    $('trip-status').textContent = '';
  }
}
$('confirm-trip').addEventListener('click', () => confirmTrip());

try {
  if (!validProfile(JSON.parse(sessionStorage.getItem('travel-stylist.confirmed-profile.v1')))) throw new Error();
  $('trip-editor').hidden = false;
  try {
    const saved = JSON.parse(sessionStorage.getItem(tripKey));
    if (saved) {
      $('trip-editor').inert = true; $('trip-status').textContent = 'Restoring your saved places…';
      // Persist only Google IDs; retrieve fresh names/addresses for the visible trip.
      const restoredPlaces = await Promise.all(saved.attractions.map((place) => place.googlePlaceId ? placeDetails(place.googlePlaceId) : place));
      const trip = buildTrip(saved.destination, saved.startDate, saved.endDate, restoredPlaces);
      destination = trip.destination; attractions = trip.attractions; initialized = true;
      $('location').value = destination.name; $('destination-label').textContent = `Selected: ${destination.name}, ${destination.countryCode}`;
      $('start-date').value = trip.startDate; $('end-date').value = trip.endDate;
      $('suggestion-note').textContent = 'Your saved spots. Add or remove places anytime.';
      $('places-section').hidden = false; $('suggest').textContent = 'Review my places';
      renderPlaces();
    }
  } catch { error('Could not restore your saved trip. If it includes Google places, refresh when place search is available, or start a new trip.'); }
  finally { $('trip-editor').inert = false; $('trip-status').textContent = ''; }
} catch { $('profile-required').hidden = false; }
