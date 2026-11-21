import { ApiError, validProfile, stringList } from './style-analysis.mjs';
import { buildTrip, tripDates } from './trip.mjs';
import { validateWeather } from './weather.mjs';
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const proseList = (value) => Array.isArray(value) && value.length <= 100 && value.every(item => text(item) && item.length <= 4000);
const unique = (items) => new Set(items).size === items.length;

export function validateOutfitRequest(body) {
  try {
    if (!body || !text(body.requestId) || body.requestId.length > 128 || !Number.isSafeInteger(body.inputRevision) || body.inputRevision < 0) throw new Error('Invalid request identity.');
    if (!validProfile(body.styleProfile)) throw new Error('Confirm your style profile first.');
    const trip = body.trip;
    buildTrip(trip?.destination, trip?.startDate, trip?.endDate, trip?.attractions);
    validateWeather(trip.weather, tripDates(trip.startDate, trip.endDate));
    if (trip.attractions.some((place) => place.date !== undefined)) throw new Error('Places belong to the whole trip; remove per-place dates.');
    if (!text(body.wardrobeVersion) || !Array.isArray(body.wardrobe) || !body.wardrobe.length || body.wardrobe.length > 30 || !unique(body.wardrobe.map((item) => item?.id))) throw new Error('Choose at least one wardrobe item with a unique ID.');
    for (const item of body.wardrobe) {
      if (!item || ![item.id, item.name, item.imageUrl, item.color].every(text) || !stringList(item.styleTags) ||
          !['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory'].includes(item.category)) throw new Error('Invalid wardrobe item.');
    }
    if (!Array.isArray(body.media) || body.media.length) throw new Error('Original style photos are not included in this outfit flow.');
  } catch (error) { throw new ApiError(400, 'INVALID_OUTFIT_REQUEST', error.message); }
  return body;
}

export function validateOutfitResponse(body, request) {
  const fail = () => { throw new ApiError(502, 'INVALID_OUTFIT_RESPONSE', 'The outfit service returned an invalid plan. Please retry.', true); };
  const dates = tripDates(request.trip.startDate, request.trip.endDate);
  if (!body || body.requestId !== request.requestId || body.inputRevision !== request.inputRevision ||
      !Array.isArray(body.outfits) || !proseList(body.warnings)) fail();
  if (body.wardrobeImagesUsed !== undefined && (!stringList(body.wardrobeImagesUsed) || !unique(body.wardrobeImagesUsed) ||
      body.wardrobeImagesUsed.some(id => !request.wardrobe.some(item => item.id === id)))) fail();
  const ids = new Set(), gaps = new Set();
  for (const outfit of body.outfits) {
    if (!outfit || !text(outfit.id) || ids.has(outfit.id) || !dates.includes(outfit.date) || !text(outfit.rationale) ||
        !Array.isArray(outfit.attractionIds) || outfit.attractionIds.length || !stringList(outfit.wardrobeItemIds) ||
        !unique(outfit.wardrobeItemIds) || outfit.wardrobeItemIds.some((id) => !request.wardrobe.some((item) => item.id === id)) ||
        !Array.isArray(outfit.missingItems) || (outfit.stylingTips !== undefined && !proseList(outfit.stylingTips))) fail();
    ids.add(outfit.id);
    for (const gap of outfit.missingItems) {
      if (!gap || ![gap.id, gap.description, gap.searchQuery, gap.reason].every(text) || gaps.has(gap.id) ||
          !['essential', 'optional'].includes(gap.priority)) fail();
      gaps.add(gap.id);
    }
  }
  if (dates.some((date) => { const count = body.outfits.filter((outfit) => outfit.date === date).length; return count < 1 || count > 2; })) fail();
  return body;
}
