import { ApiError, stringList } from './style-analysis.mjs';
import { buildStyleProfile, validNestedProfile } from './style-profile.mjs';

export const PHOTO_LIMIT = 3;
export const PHOTO_BYTES = 2 * 1024 * 1024;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export function validateInspirationRequest(body) {
  const invalid = (message) => { throw new ApiError(400, 'INVALID_INSPIRATION', message); };
  if (!body || typeof body.requestId !== 'string' || !body.requestId.trim() || body.requestId.length > 128 ||
      !Number.isSafeInteger(body.inputRevision) || body.inputRevision < 0 || !stringList(body.tags)) invalid('Invalid style request.');
  if (!Array.isArray(body.photos) || body.photos.length < 1 || body.photos.length > PHOTO_LIMIT) invalid('Choose 1–3 inspiration photos.');
  const ids = body.photos.map((photo, index) => photo?.id ?? `photo-${index + 1}`);
  if (!stringList(ids) || new Set(ids).size !== ids.length) invalid('Photo IDs must be unique short strings.');
  for (const photo of body.photos) {
    if (!photo || !PHOTO_TYPES.includes(photo.mimeType)) throw new ApiError(415, 'UNSUPPORTED_IMAGE', 'Use JPG, PNG, or WebP photos.');
    if (typeof photo.data !== 'string' || !photo.data.length || photo.data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(photo.data)) invalid('An image could not be read. Choose it again.');
    const size = photo.data.length / 4 * 3 - (photo.data.endsWith('==') ? 2 : photo.data.endsWith('=') ? 1 : 0);
    if (size > PHOTO_BYTES) throw new ApiError(413, 'IMAGE_TOO_LARGE', 'Each photo must be 2 MB or smaller.');
  }
  return body;
}
export function validInspiration(result) {
  if (!result || !validNestedProfile(result.suggestedProfile)) return false;
  const expected = buildStyleProfile(result.suggestedProfile);
  return typeof result.summary === 'string' && result.summary.trim().length > 0 &&
    result.summary === expected.summary && JSON.stringify(result.styleTags) === JSON.stringify(expected.styleTags) &&
    Object.keys(expected).every(key => JSON.stringify(expected[key]) === JSON.stringify(result.suggestedProfile[key]));
}
export function validateInspirationResponse(result, request) {
  if (!validInspiration(result) || result.requestId !== request.requestId || result.inputRevision !== request.inputRevision) {
    throw new ApiError(502, 'INVALID_INSPIRATION_RESPONSE', 'Could not read the style suggestions. Try again.', true);
  }
  const ids = new Set(request.photos.map((photo, index) => photo.id ?? `photo-${index + 1}`));
  if (result.suggestedProfile.directions.some(direction => !direction.visualReferenceIds.length ||
      direction.visualReferenceIds.some(id => !ids.has(id)))) {
    throw new ApiError(502, 'INVALID_INSPIRATION_RESPONSE', 'Could not match styles to your photos. Try again.', true);
  }
  return result;
}
// Legacy tags-only helper retained for existing adapter callers.
export function profileFromTags(tags) {
  if (!stringList(tags) || !tags.length) throw new Error('Choose at least one style tag.');
  return { styleTags: [...new Set(tags)], colors: [], avoidances: [], visualReferenceIds: [] };
}
