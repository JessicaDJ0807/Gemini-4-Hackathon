import { createServer } from 'node:http';
import { ApiError, validateRequest } from '../packages/contracts/style-analysis.mjs';
import { readJson, json, failure } from '../apps/web/http.mjs';
import { mockOutfits } from './mock-outfits.mjs';

// B's local integration fixture. A owns the real analysis service.
export function createMockAiServer({ token }) {
  return createServer(async (request, response) => {
    let body;
    try {
      if (request.method !== 'POST' || !['/v1/style-analysis', '/v1/outfit-plans'].includes(request.url)) throw new ApiError(404, 'NOT_FOUND', 'Endpoint not found.');
      body = await readJson(request);
      if (!token || request.headers.authorization !== `Bearer ${token}`) throw new ApiError(401, 'UNAUTHORIZED', 'Invalid service credential.');
      if (request.url === '/v1/outfit-plans') return json(response, 200, mockOutfits(body));
      validateRequest(body);
      json(response, 200, {
        requestId: body.requestId, inputRevision: body.inputRevision,
        suggestedProfile: {
          styleTags: [...body.tags], colors: [], avoidances: [...body.avoidances], visualReferenceIds: [],
          ...(body.notes !== undefined ? { notes: body.notes } : {})
        },
        observations: [], warnings: ['Demo mode: your choices are echoed without AI analysis.']
      });
    } catch (error) { failure(response, error, body); }
  });
}
