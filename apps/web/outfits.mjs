import { createMissingItemShop } from '/shopping.mjs';
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
  img.alt = `${item.name}, ${item.imageUrl.endsWith('.svg') ? 'demo illustration' : 'wardrobe reference photo'}`; img.width = 220; img.height = 230; img.loading = 'lazy';
  figure.append(img, node('figcaption', item.name)); return figure;
}
export function attachOutfits() {
  let trip = null, catalog = null, selected = new Set(), revision = 0, controller;
  let loading = false, currentRequest = null;
  let shopping = [];
  function error(message) { $('outfit-error').textContent = message; $('outfit-error').hidden = false; }
  function invalidate() {
    revision++; controller?.abort(); currentRequest = null;
    shopping.forEach(piece => piece.dispose()); shopping = [];
    $('outfit-status').classList.remove('is-loading');
    $('wardrobe-count').textContent = `${selected.size} selected`;
    $('look-days').replaceChildren();
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
        if (!selected.size) $('outfit-status').textContent = 'Select at least one item to generate your outfits.';
      });
      label.append(checkbox, garment(item), node('span', `${item.color} · ${item.category}`, 'hint'));
      $('wardrobe-grid').append(label);
    }
  }
  async function loadWardrobe() {
    if (loading) return;
    loading = true; $('reload-wardrobe').hidden = true;
    $('outfit-status').textContent = 'Loading your wardrobe…';
    try {
      const response = await fetch('/api/wardrobe', { signal: AbortSignal.timeout(10000) });
      const result = await response.json();
      if (!response.ok || !Array.isArray(result.wardrobe) || !result.wardrobe.length || typeof result.wardrobeVersion !== 'string') throw new Error('Could not load the wardrobe.');
      catalog = result; selected = new Set(result.wardrobe.map((item) => item.id));
      $('outfit-mode').textContent = result.provider === 'live' ? 'Sample wardrobe · Styled with AI' : 'Demo · mock outfits, no AI analysis';
      $('mock-note').hidden = result.provider === 'live';
      $('wardrobe-footer').textContent = result.provider === 'live' ? 'Sample wardrobe photos are styling references, not products for sale.' : 'Demo garments are illustrations, not products for sale.';
      const credits = result.credits ?? [];
      $('wardrobe-credits').hidden = !credits.length;
      $('wardrobe-credit-list').replaceChildren(...credits.map(credit => {
        const li = node('li'), link = node('a', credit.name); link.href = credit.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; li.append(link); return li;
      }));
      renderWardrobe(); invalidate();
      if (!result.enabled) error('Outfit generation is unavailable. Please try again later.');
    } catch {
      error('Could not load the wardrobe. Retry when ready.'); $('reload-wardrobe').hidden = false;
      $('outfit-status').textContent = '';
    } finally { loading = false; }
  }
  function renderResults(result, request) {
    $('outfit-warning-details').hidden = !result.warnings.length;
    $('outfit-warnings').replaceChildren(...result.warnings.map((warning) => node('p', warning, 'hint')));
    $('daily-looks').replaceChildren();
    $('look-days').replaceChildren();
    const cards = [], tabs = [];
    for (const [index, outfit] of [...result.outfits].sort((a, b) => a.date.localeCompare(b.date)).entries()) {
      const date = new Date(`${outfit.date}T12:00:00Z`).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });
      const card = node('article', undefined, 'daily-look'); card.id = `daily-look-${index}`; card.hidden = index !== 0;
      card.append(node('p', `DAY ${index + 1} / ${date}`, 'eyebrow'));
      const tab = node('button', date, 'day-button'); tab.type = 'button'; tab.setAttribute('aria-pressed', String(index === 0)); tab.setAttribute('aria-controls', card.id);
      tabs.push(tab); cards.push(card);
      tab.addEventListener('click', () => { cards.forEach((item, i) => { item.hidden = i !== index; tabs[i].setAttribute('aria-pressed', String(i === index)); }); });
      $('look-days').append(tab);
      const clothes = node('div', undefined, 'look-garments');
      for (const id of outfit.wardrobeItemIds) clothes.append(garment(request.wardrobe.find((item) => item.id === id), true));
      const notes = node('details', undefined, 'look-notes'); notes.append(node('summary', 'Styling notes'), node('p', outfit.rationale));
      for (const tip of outfit.stylingTips ?? []) notes.append(node('p', tip, 'hint'));
      card.append(clothes, notes);
      if (outfit.missingItems.length) {
        const gaps = node('section', undefined, 'missing-items'); gaps.append(node('h4', 'Complete the look'));
        const list = node('ul', undefined, 'missing-piece-list');
        for (const item of outfit.missingItems) {
          const piece = createMissingItemShop(item); shopping.push(piece); list.append(piece.element);
        }
        gaps.append(list); card.append(gaps);
      } else card.append(node('p', catalog.provider === 'live' ? 'No missing pieces suggested for this look.' : 'No gaps flagged by the mock.', 'hint'));
      $('daily-looks').append(card);
    }
    $('outfit-results').hidden = false; $('wardrobe-selection').open = false; $('results-title').focus();
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
      $('generate-outfits').disabled = true; $('outfit-status').textContent = catalog.provider === 'live' ? 'Styling your trip… This can take about a minute.' : 'Generating mock daily looks…';
      $('outfit-status').classList.add('is-loading');
      const response = await fetch('/api/outfit-plans', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(130000)])
      });
      const result = await response.json();
      if (currentRequest !== request || revision !== request.inputRevision) return;
      if (sessionStorage.getItem('travel-stylist.confirmed-profile.v1') !== profileSnapshot) throw new Error('Your style changed. Confirm it and generate again.');
      if (!response.ok) throw new Error(result.error?.message ?? 'Could not generate outfits. Your selections are kept; try again.');
      validateOutfitResponse(result, request); renderResults(result, request);
      $('outfit-status').textContent = request.trip.weather.length === 1 ? 'Your look is ready.' : `${request.trip.weather.length} daily looks are ready.`;
    } catch (cause) {
      if (request && (revision !== request.inputRevision || cause.name === 'AbortError')) return;
      error(cause.name === 'TimeoutError' ? 'Generation timed out. Your selections are kept; try again.' : cause.message);
      $('outfit-status').textContent = '';
    } finally {
      if (!request || currentRequest === request) {
        $('generate-outfits').disabled = !trip || !catalog?.enabled || !selected.size;
        $('outfit-status').classList.remove('is-loading');
      }
    }
  });
  return {
    clear() { trip = null; invalidate(); $('outfit-flow').hidden = true; },
    setTrip(value) {
      trip = structuredClone(value); invalidate(); $('outfit-flow').hidden = false;
      const dateLabel = value => new Date(`${value}T12:00:00Z`).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });
      $('outfit-context').textContent = `${trip.destination.name} · ${dateLabel(trip.startDate)}${trip.endDate === trip.startDate ? '' : ` – ${dateLabel(trip.endDate)}`} · ${trip.attractions.length} places`;
      if (!catalog) void loadWardrobe();
    }
  };
}
