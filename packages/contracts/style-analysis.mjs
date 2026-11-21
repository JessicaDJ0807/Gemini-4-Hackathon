import { buildStyleProfile, validNestedProfile } from './style-profile.mjs';

export class ApiError extends Error {
  constructor(status, code, message, retryable = false) {
    super(message);
    Object.assign(this, { status, code, retryable });
  }
}

export const stringList = (value) => Array.isArray(value) && value.length <= 30 &&
  value.every((item) => typeof item === 'string' && item.trim().length > 0 && item.length <= 100);

export function validateRequest(body) {
  const invalid = (message) => { throw new ApiError(400, 'INVALID_REQUEST', message); };
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Expected a JSON object.');
  if (typeof body.requestId !== 'string' || !body.requestId.trim() || body.requestId.length > 128 ||
      !Number.isSafeInteger(body.inputRevision) || body.inputRevision < 0) invalid('Invalid request identity.');
  if (!stringList(body.tags) || !stringList(body.avoidances)) invalid('Tags and avoidances must be lists of short, nonempty strings.');
  if (body.notes !== undefined && (typeof body.notes !== 'string' || body.notes.length > 2000)) invalid('Notes must be text of at most 2,000 characters.');
  if (!Array.isArray(body.media)) invalid('media must be an array.');
  if (body.media.length) throw new ApiError(415, 'MEDIA_NOT_SUPPORTED', 'This first flow supports tags and notes only.');
  if (!body.tags.length && !body.notes?.trim()) invalid('Choose a style tag or describe your style.');
  return body;
}

export function validProfile(profile) {
  return profile && ['styleTags', 'colors', 'avoidances', 'visualReferenceIds'].every((key) => stringList(profile[key])) &&
    (profile.directions === undefined ? profile.visualReferenceIds.length === 0 :
      validNestedProfile(profile) && ['styleTags', 'colors', 'aesthetics', 'silhouettes', 'stylingPatterns', 'visualReferenceIds']
        .every(key => JSON.stringify(profile[key]) === JSON.stringify(buildStyleProfile(profile)[key]))) &&
    (profile.notes === undefined || (typeof profile.notes === 'string' && profile.notes.length <= 2000)) &&
    Boolean(profile.styleTags.length || profile.colors.length || profile.notes?.trim());
}

export function validateResponse(body, request) {
  if (!body || body.requestId !== request.requestId || body.inputRevision !== request.inputRevision ||
      !validProfile(body.suggestedProfile) || body.suggestedProfile.visualReferenceIds.length !== 0 || !Array.isArray(body.observations) || body.observations.length ||
      !stringList(body.warnings) || !request.avoidances.every((item) => body.suggestedProfile.avoidances.includes(item))) {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'The style service returned an invalid result. Please try again.', true);
  }
  return body;
}

export function errorBody(error, request) {
  return {
    requestId: typeof request?.requestId === 'string' ? request.requestId : null,
    inputRevision: Number.isSafeInteger(request?.inputRevision) ? request.inputRevision : null,
    error: { code: error.code, message: error.message, retryable: error.retryable }
  };
}
