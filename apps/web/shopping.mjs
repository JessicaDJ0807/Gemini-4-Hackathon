import { addToBag } from '/cart.mjs';
import { formatProductPrice, validateProductSearchResponse } from '/shared/product-search.mjs';

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function productCard(product) {
  const card = element('article', undefined, 'shop-product');
  const picture = element('div', undefined, 'shop-product-photo');
  const fallback = element('span', 'Photo unavailable', 'hint');
  picture.append(fallback);
  if (product.imageUrl) {
    const image = document.createElement('img'); image.alt = product.title; image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer'; image.src = product.imageUrl;
    image.addEventListener('load', () => { fallback.hidden = true; });
    image.addEventListener('error', () => { image.remove(); fallback.hidden = false; });
    picture.append(image);
  }
  const info = element('div', undefined, 'shop-product-info');
  const price = element('p', formatProductPrice(product.price), 'shop-price');
  info.append(element('p', product.merchant, 'shop-merchant'), element('h5', product.title), price);
  const variants = product.variants ?? [product];
  const choice = element('select'); choice.setAttribute('aria-label', `Choose an option for ${product.title}`);
  const placeholder = element('option', 'Choose an option'); placeholder.value = ''; choice.append(placeholder);
  variants.forEach((variant, index) => {
    const label = variant.options.map(option => `${option.name}: ${option.value}`).join(' / ') || 'Standard';
    const option = element('option', `${label}${variant.available === false ? ' — Sold out' : ''}`);
    option.value = String(index); option.disabled = variant.available !== true || !variant.offerToken; choice.append(option);
  });
  const add = element('button', 'Add to bag', 'add-to-bag'); add.type = 'button'; add.disabled = true;
  add.setAttribute('aria-label', `Add ${product.title} to bag`);
  const feedback = element('p', '', 'shop-options'); feedback.setAttribute('role', 'status');
  const link = element('a', 'Store details ↗', 'shop-product-link');
  link.href = product.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', `View ${product.title} at ${product.merchant} (opens in a new tab)`);
  choice.addEventListener('change', () => {
    const selected = choice.value === '' ? null : variants[Number(choice.value)];
    add.disabled = !selected?.offerToken || selected.available !== true; feedback.textContent = '';
    price.textContent = formatProductPrice((selected ?? product).price); link.href = (selected ?? product).url;
    if (picture.querySelector('img') && selected?.imageUrl) picture.querySelector('img').src = selected.imageUrl;
  });
  add.addEventListener('click', () => {
    try { addToBag(variants[Number(choice.value)]); feedback.textContent = 'Added to your bag'; }
    catch (error) { feedback.textContent = error.message; }
  });
  if (variants.some(variant => variant.offerToken && variant.available === true)) info.append(choice, add, feedback);
  else info.append(element('p', 'Check options in the store', 'hint'));
  info.append(link); card.append(picture, info); return card;
}
// Accept A's missing-item or shopping-gap shape directly. This component never invents missing items.
// Optional: `fallbackQueries` (tried in order when a search finds nothing) and `detail` (replaces the priority hint).
export function createMissingItemShop(item) {
  const container = element('li', undefined, 'missing-piece');
  const header = element('div', undefined, 'missing-piece-heading');
  const copy = element('div'); copy.append(element('p', item.description, 'missing-piece-title'), element('p', item.detail ?? (item.priority === 'essential' ? 'Recommended addition' : 'Optional addition'), 'hint'));
  const toggle = element('button', 'Shop this piece', 'shop-piece-button'); toggle.type = 'button';
  toggle.setAttribute('aria-label', `Shop this piece: ${item.description}`);
  const panel = element('section', undefined, 'shop-matches'); panel.hidden = true;
  panel.id = `shop-${crypto.randomUUID()}`; panel.setAttribute('aria-label', `Product matches for ${item.description}`);
  toggle.setAttribute('aria-controls', panel.id); toggle.setAttribute('aria-expanded', 'false');
  const status = element('p', '', 'shop-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const warnings = element('div', undefined, 'shop-warnings');
  const grid = element('div', undefined, 'shop-product-grid');
  const retry = element('button', 'Try again', 'secondary'); retry.type = 'button'; retry.hidden = true;
  const note = element('p', 'Products from Shop · Select your option before adding. Final availability and total are confirmed at checkout.', 'shop-disclaimer'); note.hidden = true;
  panel.append(status, warnings, grid, retry, note); header.append(copy, toggle); container.append(header, panel);
  let controller, revision = 0, disposed = false;
  const queries = [item.searchQuery, ...(item.fallbackQueries ?? [])];
  async function searchOnce(query, active) {
    const request = { requestId: crypto.randomUUID(), inputRevision: active, missingItem: { id: item.id, searchQuery: query } };
    const response = await fetch('/api/products/search', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]) });
    const result = await response.json();
    if (disposed || active !== revision) return null;
    if (!response.ok) throw new Error(result.error?.message ?? 'Product search is unavailable. Please try again.');
    return validateProductSearchResponse(result, request);
  }
  async function search() {
    controller?.abort(); controller = new AbortController(); const active = ++revision;
    status.textContent = 'Finding pieces for your outfit…'; status.classList.add('is-loading');
    panel.setAttribute('aria-busy', 'true'); retry.hidden = true; note.hidden = true; warnings.replaceChildren(); grid.replaceChildren();
    try {
      let result, used = 0;
      for (; used < queries.length; used++) {  // a broader search only when the previous one found nothing
        result = await searchOnce(queries[used], active);
        if (!result) return;
        if (result.products.length) break;
      }
      used = Math.min(used, queries.length - 1);
      warnings.replaceChildren(...result.warnings.map(message => element('p', message, 'hint')));
      grid.replaceChildren(...result.products.map(productCard));
      status.textContent = !result.products.length ? 'No matches found for this piece. You can try again later.'
        : used ? `No exact match; ${result.products.length} pieces for “${queries[used]}”` : `${result.products.length} pieces to explore`;
      retry.hidden = result.products.length > 0; note.hidden = result.products.length === 0;
    } catch (error) {
      if (disposed || active !== revision || error.name === 'AbortError') return;
      status.textContent = error.name === 'TimeoutError' ? 'Product search took too long. Please try again.' : error.message;
      retry.hidden = false;
    } finally {
      if (!disposed && active === revision) { status.classList.remove('is-loading'); panel.setAttribute('aria-busy', 'false'); }
    }
  }
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded', String(!panel.hidden));
    toggle.textContent = panel.hidden ? 'Shop this piece' : 'Hide matches';
    toggle.setAttribute('aria-label', `${panel.hidden ? 'Shop this piece' : 'Hide matches'}: ${item.description}`);
    if (panel.hidden) { revision++; controller?.abort(); } else void search();
  });
  retry.addEventListener('click', () => { void search(); });
  return { element: container, dispose() { disposed = true; revision++; controller?.abort(); } };
}
