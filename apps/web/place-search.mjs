export async function placeDetails(placeId, sessionToken, signal) {
  const response = await fetch('/api/places/details', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ placeId, ...(sessionToken ? { sessionToken } : {}) }),
    signal: signal ?? AbortSignal.timeout(10000)
  });
  const result = await response.json();
  if (!response.ok || !result.place) throw new Error(result.error?.message ?? 'Could not load that place.');
  return result.place;
}

export function attachPlaceSearch({ getDestination, onSelect }) {
  const input = document.getElementById('custom-place');
  const results = document.getElementById('place-results');
  const status = document.getElementById('place-search-status');
  let enabled = false, timer, version = 0, controller;
  let sessionToken = crypto.randomUUID();
  function reset() {
    clearTimeout(timer); controller?.abort(); version++;
    results.replaceChildren(); sessionToken = crypto.randomUUID();
    status.textContent = enabled ? 'Search places near your destination, or add a name manually.' : 'Enter a place name to add it.';
  }
  input.addEventListener('input', () => {
    clearTimeout(timer); controller?.abort(); results.replaceChildren();
    const current = ++version;
    const destination = getDestination();
    if (!enabled || !destination || input.value.trim().length < 2) {
      status.textContent = enabled ? 'Type at least two characters to search nearby places.' : 'Enter a place name to add it.';
      return;
    }
    status.textContent = `Searching near ${destination.name}…`;
    timer = setTimeout(async () => {
      controller = new AbortController();
      try {
        const response = await fetch('/api/places/autocomplete', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: input.value.trim(), sessionToken, latitude: destination.latitude, longitude: destination.longitude, countryCode: destination.countryCode }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)])
        });
        const data = await response.json();
        if (current !== version || getDestination()?.id !== destination.id) return;
        if (!response.ok || !Array.isArray(data.suggestions)) throw new Error(data.error?.message ?? 'Place search failed.');
        status.textContent = data.suggestions.length ? 'Choose a matching place, or add your own name manually.' : 'No matching places nearby. Try another name or add it manually.';
        for (const suggestion of data.suggestions) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'place-option';
          button.textContent = suggestion.label;
          button.addEventListener('click', async () => {
            if (current !== version) return;
            results.querySelectorAll('button').forEach((item) => { item.disabled = true; });
            status.textContent = 'Adding your place…';
            try {
              const place = await placeDetails(suggestion.placeId, sessionToken, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]));
              if (current !== version || getDestination()?.id !== destination.id) return;
              onSelect(place); input.value = ''; reset(); status.textContent = `Added ${place.name}.`;
            } catch (cause) {
              if (current !== version) return;
              reset(); status.textContent = `${cause.message} Search again or add a name manually.`;
            }
          });
          results.append(button);
        }
        if (data.suggestions.length) {
          const attribution = document.createElement('p'); attribution.textContent = 'Google Maps';
          attribution.className = 'google-attribution'; attribution.translate = false; results.append(attribution);
        }
      } catch (cause) {
        if (current === version && cause.name !== 'AbortError') status.textContent = 'Place search is unavailable. Try again or add a name manually.';
      }
    }, 300);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && results.querySelector('button')) { event.preventDefault(); results.querySelector('button').focus(); }
    if (event.key === 'Escape') reset();
  });
  fetch('/api/places/config').then((response) => response.json()).then((config) => { enabled = config.enabled === true; reset(); }).catch(reset);
  return { reset };
}
