import { ApiError } from '../../packages/contracts/style-analysis.mjs';

const invalid = (message) => new ApiError(400, 'INVALID_PLACE_REQUEST', message);
export function createPlacesClient({ apiKey, fetchImpl = fetch } = {}) {
  async function call(path, options, mask) {
    if (!apiKey) throw new ApiError(503, 'PLACES_NOT_CONFIGURED', 'Place suggestions are unavailable. You can still add a place manually.');
    try {
      const response = await fetchImpl(`https://places.googleapis.com/v1/${path}`, {
        ...options, headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': mask },
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) throw new Error();
      return await response.json();
    } catch {
      throw new ApiError(503, 'PLACES_UNAVAILABLE', 'Place search is unavailable. Try again or add the place manually.', true);
    }
  }
  function session(value, required = false) {
    if ((required || value !== undefined) && (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,36}$/.test(value))) throw invalid('Invalid search session.');
  }
  return {
    enabled: Boolean(apiKey),
    async autocomplete(body) {
      if (typeof body?.input !== 'string' || body.input.trim().length < 2 || body.input.length > 120) throw invalid('Enter a place name of 2–120 characters.');
      const { latitude, longitude, countryCode } = body;
      if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180 || !/^[A-Z]{2}$/.test(countryCode)) throw invalid('Select a destination before searching for places.');
      session(body.sessionToken, true);
      const result = await call('places:autocomplete', { method: 'POST', body: JSON.stringify({
        input: body.input.trim(), sessionToken: body.sessionToken, languageCode: 'en',
        includedRegionCodes: [countryCode.toLowerCase()],
        locationRestriction: { circle: { center: { latitude, longitude }, radius: 25000 } }
      }) }, 'suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat');
      if (result.suggestions !== undefined && !Array.isArray(result.suggestions)) throw new ApiError(502, 'INVALID_PLACES_RESPONSE', 'Place search returned invalid suggestions.', true);
      return { suggestions: (result.suggestions ?? []).filter((item) => item && typeof item === 'object').flatMap(({ placePrediction: p } = {}) =>
        p && typeof p.placeId === 'string' && typeof p.text?.text === 'string' ? [{
          placeId: p.placeId, label: p.text.text,
          name: p.structuredFormat?.mainText?.text ?? p.text.text,
          address: p.structuredFormat?.secondaryText?.text ?? ''
        }] : []).slice(0, 5) };
    },
    async details(body) {
      if (typeof body?.placeId !== 'string' || !/^[a-zA-Z0-9_-]{1,255}$/.test(body.placeId)) throw invalid('Choose a valid place suggestion.');
      session(body.sessionToken);
      const query = new URLSearchParams({ languageCode: 'en', ...(body.sessionToken ? { sessionToken: body.sessionToken } : {}) });
      const p = await call(`places/${encodeURIComponent(body.placeId)}?${query}`, { method: 'GET' }, 'id,displayName,formattedAddress,location,attributions');
      if (p.id !== body.placeId || typeof p.displayName?.text !== 'string' || !p.displayName.text.trim()) throw new ApiError(502, 'INVALID_PLACES_RESPONSE', 'Could not resolve that place. Try another suggestion.', true);
      return { place: {
        id: `google:${p.id}`, googlePlaceId: p.id, name: p.displayName.text, source: 'provider', activityTags: [],
        ...(typeof p.formattedAddress === 'string' ? { address: p.formattedAddress } : {}),
        ...(Number.isFinite(p.location?.latitude) && Number.isFinite(p.location?.longitude) ? { coordinates: p.location } : {}),
        attributions: Array.isArray(p.attributions) ? p.attributions.filter((a) => typeof a?.provider === 'string').map((a) => a.provider) : []
      } };
    }
  };
}
