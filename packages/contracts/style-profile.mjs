// Shared B editor shape aligned with A's StyleProfile directions proposal.
export const DETAIL_FIELDS = ['colors', 'silhouettes', 'stylingPatterns', 'keyPieces'];
export const USER_TAG_LIMIT = 20;
export const DETAIL_LIMIT = 8;
export const DIRECTION_LIMIT = 3;
const text = (value, max, required = false) => typeof value === 'string' && value.length <= max && (!required || Boolean(value.trim()));
const list = (value, max = 30) => Array.isArray(value) && value.length <= max && value.every(item => text(item, 100, true));
export const uniqueLabels = values => [...new Map(values.map(value => [value.trim().toLowerCase(), value.trim()])).values()];
export function addLabel(values, value, limit = USER_TAG_LIMIT) {
  const label = value.trim();
  if (!label || label.length > 100) throw new Error('Enter a label between 1 and 100 characters.');
  if (values.some(item => item.toLowerCase() === label.toLowerCase())) return [...values];
  if (values.length >= limit) throw new Error(`Keep up to ${limit} labels here. Remove one before adding another.`);
  return [...values, label];
}
export function validDirection(direction) {
  return Boolean(direction && text(direction.id, 100, true) && text(direction.name, 100, true) &&
    text(direction.description, 500) && ['dominant', 'secondary', 'minor'].includes(direction.strength) &&
    ['media', 'tags', 'both'].includes(direction.source) && list(direction.visualReferenceIds, 3) &&
    DETAIL_FIELDS.every(key => list(direction[key], DETAIL_LIMIT) && uniqueLabels(direction[key]).length === direction[key].length));
}
export function validNestedProfile(profile) {
  return Boolean(profile && text(profile.summary, 500) && list(profile.userTags, USER_TAG_LIMIT) &&
    uniqueLabels(profile.userTags).length === profile.userTags.length &&
    Array.isArray(profile.directions) && profile.directions.length <= DIRECTION_LIMIT && profile.directions.every(validDirection) &&
    new Set(profile.directions.map(item => item.id)).size === profile.directions.length &&
    profile.directions.filter(item => item.strength === 'dominant').length <= 1 &&
    list(profile.avoidances) && (profile.notes === undefined || text(profile.notes, 2000)));
}
export function buildStyleProfile(draft) {
  if (!validNestedProfile(draft)) throw new Error('Check the style names and labels before continuing.');
  const directions = structuredClone(draft.directions);
  const collect = key => uniqueLabels(directions.flatMap(direction => direction[key]));
  return {
    summary: draft.summary, directions, userTags: [...draft.userTags], avoidances: [...draft.avoidances],
    ...(draft.notes === undefined ? {} : { notes: draft.notes }),
    visualReferenceIds: collect('visualReferenceIds'),
    styleTags: uniqueLabels([...draft.userTags, ...directions.map(direction => direction.name)]),
    colors: collect('colors'), aesthetics: uniqueLabels(directions.map(direction => direction.name)),
    silhouettes: collect('silhouettes'), stylingPatterns: collect('stylingPatterns')
  };
}
export const emptyStyleProfile = () => buildStyleProfile({ summary: '', directions: [], userTags: [], avoidances: [] });
// Use an explicit replacement after user edits; never guess how new AI groups match edited groups.
export function applyStyleAnalysis(current, suggested) {
  return buildStyleProfile({ ...suggested, userTags: current.userTags, avoidances: current.avoidances,
    ...(current.notes === undefined ? {} : { notes: current.notes }) });
}
export function restoreStyleProfile(saved) {
  if (saved.directions !== undefined) return buildStyleProfile(saved);
  const profile = emptyStyleProfile();
  profile.userTags = uniqueLabels(saved.styleTags ?? []).slice(0, USER_TAG_LIMIT);
  profile.avoidances = saved.avoidances ?? [];
  if (saved.notes !== undefined) profile.notes = saved.notes;
  // Legacy profiles remain usable; never fabricate detailed analysis for old tags.
  if (['colors', 'silhouettes', 'stylingPatterns'].some(key => saved[key]?.length)) {
    profile.directions = [{ id: 'legacy-style', name: saved.aesthetics?.[0] ?? 'Saved style', description: '', strength: 'dominant',
      source: 'tags', visualReferenceIds: [], colors: saved.colors?.slice(0, DETAIL_LIMIT) ?? [],
      silhouettes: saved.silhouettes?.slice(0, DETAIL_LIMIT) ?? [], stylingPatterns: saved.stylingPatterns?.slice(0, DETAIL_LIMIT) ?? [], keyPieces: [] }];
  }
  return buildStyleProfile(profile);
}
