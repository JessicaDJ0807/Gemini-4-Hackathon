import { ApiError, errorBody } from '../../packages/contracts/style-analysis.mjs';

export function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

export async function readJson(request, maxBytes = 16384) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new ApiError(415, 'UNSUPPORTED_CONTENT_TYPE', 'Send application/json.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request is too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, 'INVALID_JSON', 'Request contains invalid JSON.'); }
}

export function failure(response, error, request) {
  const safe = error instanceof ApiError ? error : new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong.', true);
  json(response, safe.status, errorBody(safe, request));
}
