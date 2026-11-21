import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWebServer } from '../apps/web/server.mjs';
import { createMockAiServer } from '../scripts/mock-ai.mjs';

const token = 'test-server-only-token';
const input = { requestId: 'style-001', inputRevision: 2, tags: ['minimal', 'classic'], avoidances: ['high heels'], media: [] };
const output = (request = input) => ({
  requestId: request.requestId, inputRevision: request.inputRevision,
  suggestedProfile: { styleTags: request.tags, colors: [], avoidances: request.avoidances, visualReferenceIds: [] },
  observations: [], warnings: []
});

async function listen(t, server) {
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
const post = (base, body = input, options = {}) => fetch(`${base}/api/style-analysis`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...options
});
async function app(t, overrides = {}) {
  const aiBaseUrl = await listen(t, createMockAiServer({ token }));
  return listen(t, createWebServer({ aiBaseUrl, token, provider: 'demo', ...overrides }));
}

test('B sends tags and avoidances to A over authenticated HTTP, then returns the agreed profile', async (t) => {
  const base = await app(t);
  const response = await post(base);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.suggestedProfile, output().suggestedProfile);
  assert.equal(body.requestId, input.requestId);
  assert.equal(body.inputRevision, input.inputRevision);
  assert.deepEqual(body.observations, []);
  assert.match(body.warnings[0], /Demo mode/);
  const config = await (await fetch(`${base}/api/config`)).json();
  assert.deepEqual(config, { provider: 'demo', photoAnalysis: false });
  for (const path of ['/', '/app.mjs', '/contracts.mjs', '/style.css']) {
    const asset = await fetch(base + path);
    assert.equal(asset.status, 200);
    assert.ok(!(await asset.text()).includes(token));
  }
  assert.equal((await fetch(`${base}/.env`)).status, 404);
});

test('notes-only input works without inventing a palette', async (t) => {
  const response = await post(await app(t), { ...input, tags: [], notes: 'Comfortable neutral looks.' });
  assert.equal(response.status, 200);
  const profile = (await response.json()).suggestedProfile;
  assert.deepEqual(profile.colors, []);
  assert.equal(profile.notes, 'Comfortable neutral looks.');
});

test('rejects avoidances-only input, wrong field types, and unsupported media', async (t) => {
  const base = await app(t);
  for (const [body, status] of [
    [{ ...input, tags: [] }, 400], [{ ...input, tags: [' '] }, 400],
    [{ ...input, tags: 'minimal' }, 400], [{ ...input, inputRevision: -1 }, 400],
    [{ ...input, notes: 42 }, 400], [{ ...input, media: [{}] }, 415]
  ]) {
    const response = await post(base, body);
    assert.equal(response.status, status);
    const result = await response.json();
    assert.equal(result.requestId, input.requestId);
    assert.equal(result.error.retryable, false);
  }
});

test('handles malformed JSON, excessive payloads, and cross-origin submissions', async (t) => {
  const base = await app(t);
  const bad = await post(base, null, { body: '{' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).requestId, null);
  const large = await post(base, { ...input, notes: 'x'.repeat(20000) });
  assert.equal(large.status, 413);
  const foreign = await post(base, input, { headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.example' } });
  assert.equal(foreign.status, 403);
});

test('rejects responses with stale identity, missing fields, dropped avoidances, or invented media', async (t) => {
  for (const change of [
    (r) => { r.requestId = 'old-request'; }, (r) => { r.inputRevision = 0; },
    (r) => { delete r.suggestedProfile.colors; }, (r) => { r.suggestedProfile.avoidances = []; },
    (r) => { r.suggestedProfile.visualReferenceIds = ['invented']; }
  ]) {
    const result = output(); change(result);
    const base = await app(t, { fetchImpl: async () => Response.json(result) });
    const response = await post(base);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, 'INVALID_AI_RESPONSE');
  }
});

test('preserves upstream errors and Retry-After without falling back to a demo result', async (t) => {
  const base = await app(t, { fetchImpl: async (_url, options) => {
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    return Response.json({ requestId: input.requestId, inputRevision: input.inputRevision,
      error: { code: 'RATE_LIMIT', message: 'Try later.', retryable: true }
    }, { status: 429, headers: { 'Retry-After': '30' } });
  } });
  const response = await post(base);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '30');
  const result = await response.json();
  assert.equal(result.error.code, 'RATE_LIMIT');
  assert.equal(result.suggestedProfile, undefined);
});

test('returns contract errors when A is unreachable, returns invalid JSON, or times out', async (t) => {
  for (const [fetchImpl, status] of [
    [async () => { throw new TypeError('connect failed'); }, 502],
    [async () => new Response('<html>oops</html>'), 502],
    [async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))), 504]
  ]) {
    const base = await app(t, { fetchImpl, timeoutMs: 10 });
    const response = await post(base);
    assert.equal(response.status, status);
    const result = await response.json();
    assert.equal(result.requestId, input.requestId);
    assert.equal(result.error.retryable, true);
  }
});

test('A mock rejects missing service authentication', async (t) => {
  const base = await listen(t, createMockAiServer({ token }));
  const response = await fetch(`${base}/v1/style-analysis`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input)
  });
  assert.equal(response.status, 401);
});
