import { validateOutfitRequest, validateOutfitResponse } from '/shared/outfit-plans.mjs';

const $ = (id) => document.getElementById(id);
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function garment(item, small = false) {
  const figure = node('figure', undefined, small ? 'outfit-garment' : 'wardrobe-garment');
  const img = document.createElement('img'); img.src = item.imageUrl;
  img.alt = `${item.name}, demo illustration`; img.width = 220; img.height = 230; img.loading = 'lazy';
  figure.append(img, node('figcaption', item.name)); return figure;
}
export function attachOutfits() {
  let trip = null, catalog = null, selected = new Set(), revision = 0, controller;
  let loading = false, currentRequest = null;
  function error(message) { $('outfit-error').textContent = message; $('outfit-error').hidden = false; }
  function invalidate() {
    revision++; controller?.abort(); currentRequest = null;
    $('outfit-results').hidden = true; $('daily-looks').replaceChildren();
    $('outfit-error').hidden = true; $('outfit-status').textContent = '';
    $('generate-outfits').disabled = !trip || !catalog?.enabled || !selected.size;
  }
  function renderWardrobe() {
    $('wardrobe-grid').replaceChildren();
    for (const item of catalog.wardrobe) {
      const label = node('label', undefined, 'wardrobe-choice');
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(item.id);
      checkbox.setAttribute('aria-label', `Include ${item.name}`);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selected.add(item.id); else selected.delete(item.id);
        invalidate();
        if (!selected.size) $('outfit-status').textContent = 'Select at least one item to generate a mock plan.';
      });
      label.append(checkbox, garment(item), node('span', `${item.color} · ${item.category}`, 'hint'));
      $('wardrobe-grid').append(label);
    }
  }
  async function loadWardrobe() {
    if (loading) return;
    loading = true; $('reload-wardrobe').hidden = true;
    $('outfit-status').textContent = 'Loading the demo wardrobe…';
    try {
      const response = await fetch('/api/demo-wardrobe', { signal: AbortSignal.timeout(10000) });
      const result = await response.json();
      if (!response.ok || !Array.isArray(result.wardrobe) || !result.wardrobe.length || typeof result.wardrobeVersion !== 'string') throw new Error('Could not load the demo wardrobe.');
      catalog = result; selected = new Set(result.wardrobe.map((item) => item.id));
      renderWardrobe(); invalidate();
      if (!result.enabled) error('Mock outfits are available when the app runs in local demo mode.');
    } catch {
      error('Could not load the demo wardrobe. Retry when ready.'); $('reload-wardrobe').hidden = false;
      $('outfit-status').textContent = '';
    } finally { loading = false; }
  }
  function renderResults(result, request) {
    $('outfit-warnings').replaceChildren(...result.warnings.map((warning) => node('p', warning, 'hint')));
    $('daily-looks').replaceChildren();
    for (const outfit of [...result.outfits].sort((a, b) => a.date.localeCompare(b.date))) {
      const card = node('article', undefined, 'daily-look'); card.append(node('h3', outfit.date));
      const clothes = node('div', undefined, 'look-garments');
      for (const id of outfit.wardrobeItemIds) clothes.append(garment(request.wardrobe.find((item) => item.id === id), true));
      card.append(clothes, node('p', outfit.rationale));
      for (const tip of outfit.stylingTips ?? []) card.append(node('p', tip, 'hint'));
      if (outfit.missingItems.length) {
        const gaps = node('section', undefined, 'missing-items'); gaps.append(node('h4', 'Missing items'));
        const list = node('ul');
        for (const item of outfit.missingItems) list.append(node('li', `${item.description} (${item.priority}) — ${item.reason}`));
        gaps.append(list); card.append(gaps);
      } else card.append(node('p', 'No gaps flagged by the mock.', 'hint'));
      $('daily-looks').append(card);
    }
    $('outfit-results').hidden = false; $('results-title').focus();
  }
  $('reload-wardrobe').addEventListener('click', loadWardrobe);
  $('generate-outfits').addEventListener('click', async () => {
    if (!trip || !catalog?.enabled || !selected.size) return;
    invalidate(); controller = new AbortController();
    let request, profileSnapshot;
    try {
      profileSnapshot = sessionStorage.getItem('travel-stylist.confirmed-profile.v1');
      request = {
        requestId: crypto.randomUUID(), inputRevision: revision, styleProfile: JSON.parse(profileSnapshot), trip: structuredClone(trip),
        wardrobeVersion: catalog.wardrobeVersion, wardrobe: catalog.wardrobe.filter((item) => selected.has(item.id)), media: []
      };
      validateOutfitRequest(request); currentRequest = request;
      $('generate-outfits').disabled = true; $('outfit-status').textContent = 'Generating mock daily looks…';
      const response = await fetch('/api/outfit-plans', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)])
      });
      const result = await response.json();
      if (currentRequest !== request || revision !== request.inputRevision) return;
      if (sessionStorage.getItem('travel-stylist.confirmed-profile.v1') !== profileSnapshot) throw new Error('Your style changed. Confirm it and generate again.');
      if (!response.ok) throw new Error(result.error?.message ?? 'Could not generate outfits. Your selections are kept; try again.');
      validateOutfitResponse(result, request); renderResults(result, request);
      $('outfit-status').textContent = `Mock looks ready for all ${request.trip.weather.length} trip days.`;
    } catch (cause) {
      if (request && (revision !== request.inputRevision || cause.name === 'AbortError')) return;
      error(cause.name === 'TimeoutError' ? 'Generation timed out. Your selections are kept; try again.' : cause.message);
      $('outfit-status').textContent = '';
    } finally {
      if (!request || currentRequest === request) $('generate-outfits').disabled = !trip || !catalog?.enabled || !selected.size;
    }
  });
  return {
    clear() { trip = null; invalidate(); $('outfit-flow').hidden = true; },
    setTrip(value) {
      trip = structuredClone(value); invalidate(); $('outfit-flow').hidden = false;
      $('outfit-context').textContent = `${trip.destination.name} · ${trip.startDate} to ${trip.endDate} · ${trip.attractions.length} places for the whole trip`;
      if (!catalog) void loadWardrobe();
    }
  };
}
