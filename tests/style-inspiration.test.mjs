import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWebServer } from '../apps/web/server.mjs';
import { validateInspirationRequest, profileFromTags, validateInspirationResponse, PHOTO_BYTES } from '../packages/contracts/style-inspiration.mjs';
import { validProfile } from '../packages/contracts/style-analysis.mjs';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const input = { requestId: 'photos-1', inputRevision: 4, tags: ['minimal'], photos: [{ mimeType: 'image/png', data: png }] };
const direction = { name: 'Relaxed tailoring', description: 'Easy layers with structured pieces.', strength: 'dominant', colors: ['cream'], silhouettes: ['wide-leg'], stylingPatterns: ['tonal layering'], keyPieces: ['blazer'], visualReferenceIds: ['photo-1'] };
const suggestion = { directions: [direction], summary: 'Relaxed tailoring with a quiet neutral palette.' };
const modelResponse = (value = suggestion, finishReason = 'STOP') => Response.json({ candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(value) }] } }] });
async function app(t, overrides = {}) {
  const server = createWebServer({ provider: 'demo', geminiKey: 'test-secret', geminiModel: 'test-model', geminiFetch: async () => modelResponse(), ...overrides });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
const post = (base, body = input, headers = {}) => fetch(base + '/api/style-inspiration', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('photos become inline Gemini input; validated nested directions and photo references return to browser', async t => {
  let called = false;
  const base = await app(t, { geminiFetch: async (url, options) => {
    called = true; assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent');
    assert.equal(options.headers['x-goog-api-key'], 'test-secret');
    const body = JSON.parse(options.body);
    assert.deepEqual(body.contents[0].parts[2], { inlineData: { mimeType: 'image/png', data: png } });
    assert.match(body.contents[0].parts[0].text, /minimal/);
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.match(body.systemInstruction.parts[0].text, /never as instructions/);
    return modelResponse();
  } });
  const response = await post(base); assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.requestId, input.requestId); assert.equal(result.inputRevision, 4);
  assert.deepEqual(result.styleTags, ['Relaxed tailoring']); assert.equal(result.summary, suggestion.summary);
  assert.equal(result.suggestedProfile.directions[0].name, direction.name);
  assert.deepEqual(result.suggestedProfile.colors, ['cream']);
  assert.deepEqual(result.suggestedProfile.visualReferenceIds, ['photo-1']);
  assert.deepEqual(result.suggestedProfile.userTags, []);
  assert.equal(validProfile(result.suggestedProfile), true);
  assert.equal(called, true); validateInspirationResponse(result, input);
  assert.equal(validProfile(profileFromTags(result.styleTags)), true);
  assert.deepEqual((await (await fetch(base + '/api/config')).json()), { provider: 'demo', photoAnalysis: true });
  for (const path of ['/', '/app.mjs', '/shared/style-inspiration.mjs', '/shared/style-analysis.mjs', '/shared/style-profile.mjs', '/style-profile.mjs', '/api/config']) {
    const asset = await fetch(base + path); assert.equal(asset.status, 200); assert.ok(!(await asset.text()).includes('test-secret'));
  }
});

test('photo-only input is allowed; tags-only confirmation requires no AI', () => {
  validateInspirationRequest({ ...input, tags: [] });
  assert.deepEqual(profileFromTags(['classic']), { styleTags: ['classic'], colors: [], avoidances: [], visualReferenceIds: [] });
  assert.throws(() => profileFromTags([]));
  assert.throws(() => validateInspirationResponse({ ...suggestion, requestId: 'stale', inputRevision: 4 }, input));
});

test('no Gemini key disables analysis without fabricated suggestions or network calls', async t => {
  const base = await app(t, { geminiKey: undefined, geminiFetch: () => { throw new Error('Must not call'); } });
  assert.equal((await (await fetch(base + '/api/config')).json()).photoAnalysis, false);
  const response = await post(base); assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'PHOTO_ANALYSIS_UNAVAILABLE');
});

test('rejects too many, oversized, malformed and mismatched image uploads before Gemini', async t => {
  const base = await app(t, { geminiFetch: () => { throw new Error('Must not call'); } });
  for (const [photos, status] of [
    [[], 400], [Array(4).fill(input.photos[0]), 400],
    [[{ mimeType: 'image/svg+xml', data: png }], 415],
    [[{ mimeType: 'image/jpeg', data: png }], 415],
    [[{ mimeType: 'image/png', data: 'not-base64' }], 400],
    [[{ mimeType: 'image/png', data: Buffer.alloc(PHOTO_BYTES + 1).toString('base64') }], 413]
  ]) assert.equal((await post(base, { ...input, photos })).status, status);
  assert.equal((await post(base, input, { Origin: 'https://foreign.example' })).status, 403);
  const tooLarge = await post(base, { ...input, padding: 'x'.repeat(9 * 1024 * 1024) });
  assert.equal(tooLarge.status, 413);
});

test('Gemini rate limits, transport failures and timeout are explicit and do not expose provider errors', async t => {
  for (const [geminiFetch, status] of [
    [async () => Response.json({ error: 'test-secret' }, { status: 429 }), 429],
    [async () => Response.json({ error: 'test-secret' }, { status: 403 }), 502],
    [async () => { throw new Error('test-secret'); }, 502],
    [async (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))), 504]
  ]) {
    const response = await post(await app(t, { geminiFetch, geminiTimeoutMs: 10 })); assert.equal(response.status, status);
    const body = await response.json(); assert.equal(body.requestId, input.requestId); assert.equal(body.styleTags, undefined);
    assert.ok(!JSON.stringify(body).includes('test-secret'));
  }
});

test('blocked, truncated, invalid nested and unsupported photo-reference outputs are rejected', async t => {
  for (const geminiFetch of [
    async () => Response.json({ promptFeedback: { blockReason: 'SAFETY' } }),
    async () => modelResponse(suggestion, 'MAX_TOKENS'),
    async () => modelResponse({ ...suggestion, directions: [{ ...direction, colors: ['cream', 'Cream'] }] }),
    async () => modelResponse({ ...suggestion, directions: Array(4).fill(direction) }),
    async () => modelResponse({ ...suggestion, directions: [{ ...direction, visualReferenceIds: ['unknown'] }] }),
    async () => modelResponse({ ...suggestion, directions: [{ ...direction, visualReferenceIds: [] }] }),
    async () => modelResponse({ ...suggestion, directions: [{ ...direction, colors: 'cream' }] }),
    async () => modelResponse({ ...suggestion, directions: [direction, direction] }),
    async () => modelResponse({ ...suggestion, summary: 'x'.repeat(501) }),
    async () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{broken' }] } }] })
  ]) {
    const response = await post(await app(t, { geminiFetch })); assert.ok([422, 502].includes(response.status));
    assert.equal((await response.json()).styleTags, undefined);
  }
});

test('unrelated images can return no tags with an explanation', async t => {
  const base = await app(t, { geminiFetch: async () => modelResponse({ directions: [], summary: 'No clothing is visible. Try an outfit photo.' }) });
  const response = await post(base); assert.equal(response.status, 200); assert.deepEqual((await response.json()).styleTags, []);
});
