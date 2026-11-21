import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStyleProfile, emptyStyleProfile, addLabel, applyStyleAnalysis, restoreStyleProfile } from '../packages/contracts/style-profile.mjs';
import { validProfile } from '../packages/contracts/style-analysis.mjs';

const direction = { id: 'dir-1', name: 'Relaxed tailoring', description: 'Loose tailored pieces.', strength: 'dominant', source: 'media',
  colors: ['cream', 'black'], silhouettes: ['wide-leg'], stylingPatterns: ['tonal layering'], keyPieces: ['blazer'], visualReferenceIds: ['photo-1'] };
const analyzed = () => buildStyleProfile({ summary: 'Neutral, relaxed layers.', userTags: [], avoidances: [], directions: [structuredClone(direction)] });

test('manual tags work without photos, preserve casing, deduplicate, and enforce limits', () => {
  const profile = emptyStyleProfile();
  profile.userTags = addLabel(profile.userTags, '  Vintage  ');
  profile.userTags = addLabel(profile.userTags, 'vintage');
  assert.deepEqual(profile.userTags, ['Vintage']);
  assert.equal(validProfile(buildStyleProfile(profile)), true);
  assert.equal(validProfile(emptyStyleProfile()), false);
  assert.throws(() => addLabel([], '   ')); assert.throws(() => addLabel([], 'x'.repeat(101)));
  assert.throws(() => addLabel(Array.from({length: 20}, (_, i) => `tag-${i}`), 'one more'));
});

test('nested edits and removals regenerate flat fields without reviving deleted traits', () => {
  const profile = analyzed();
  profile.userTags = ['comfortable']; profile.directions[0].name = 'My tailoring';
  profile.directions[0].colors = ['navy']; profile.directions[0].stylingPatterns = [];
  const saved = buildStyleProfile(profile);
  assert.deepEqual(saved.styleTags, ['comfortable', 'My tailoring']);
  assert.deepEqual(saved.colors, ['navy']); assert.deepEqual(saved.stylingPatterns, []);
  assert.equal(validProfile(saved), true);
  assert.equal(validProfile({ ...saved, colors: ['cream', 'black'] }), false);
  assert.deepEqual(buildStyleProfile({ ...saved, directions: [] }).visualReferenceIds, []);
});

test('analysis replacement preserves latest manual input and does not mutate existing edits', () => {
  const current = analyzed(); current.userTags = ['Vintage']; current.avoidances = ['heels']; current.notes = 'Walking comfort';
  current.directions[0].name = 'My edited style'; current.directions[0].colors = ['navy'];
  const next = applyStyleAnalysis(current, analyzed());
  assert.equal(current.directions[0].name, 'My edited style');
  assert.deepEqual(current.directions[0].colors, ['navy']);
  assert.deepEqual(next.userTags, ['Vintage']); assert.deepEqual(next.avoidances, ['heels']);
  assert.equal(next.notes, 'Walking comfort'); assert.equal(next.directions[0].name, 'Relaxed tailoring');
});

test('full nested profile survives JSON storage and legacy tags remain usable', () => {
  const profile = analyzed(); profile.userTags = ['vintage'];
  const saved = buildStyleProfile(profile);
  assert.deepEqual(restoreStyleProfile(JSON.parse(JSON.stringify(saved))), saved);
  const legacy = restoreStyleProfile({ styleTags: ['classic'], colors: [], avoidances: [], visualReferenceIds: [] });
  assert.deepEqual(legacy.userTags, ['classic']); assert.deepEqual(legacy.directions, []);
  assert.equal(validProfile(legacy), true);
});

test('malformed directions, duplicate IDs and multiple dominant styles cannot be saved', () => {
  for (const changes of [
    { colors: ['x'.repeat(101)] }, { name: ' ' }, { strength: 'unknown' }, { source: 'unknown' },
    { stylingPatterns: [null] }, { description: 'x'.repeat(501) }, { keyPieces: Array(9).fill('blazer') }
  ]) assert.throws(() => buildStyleProfile({ ...analyzed(), directions: [{ ...direction, ...changes }] }));
  assert.throws(() => buildStyleProfile({ ...analyzed(), directions: [direction, direction] }));
  assert.throws(() => buildStyleProfile({ ...analyzed(), directions: [direction, { ...direction, id: 'dir-2' }] }));
});
