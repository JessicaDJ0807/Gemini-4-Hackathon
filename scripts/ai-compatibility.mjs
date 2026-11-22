// Fail clearly instead of silently dropping edited directions on an older A server.
export async function assertAiCompatibility(baseUrl, fetchImpl = fetch) {
  let schemas;
  try {
    const response = await fetchImpl(`${baseUrl}/openapi.json`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw Error();
    schemas = (await response.json()).components?.schemas;
  } catch { throw new Error('Cannot read A’s API schema. Start A and check AI_BASE_URL. See docs/integrations/run-a-and-b.md.'); }
  const profiles = Object.entries(schemas ?? {}).filter(([name]) => /^StyleProfile(?:-Input)?$/.test(name));
  if (!profiles.some(([, value]) => ['directions', 'userTags', 'summary'].every(key => key in (value.properties ?? {})))) {
    throw new Error('A is missing native nested StyleProfile support (PR #5). Combine that PR with B before using live mode. See docs/integrations/run-a-and-b.md.');
  }
}
