import { formatProductPrice, validProduct } from '/shared/product-search.mjs';
export const el = (tag, text, className) => {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text;
  if (className) node.className = className; return node;
};
const storageKey = 'travel-stylist.shopping-bag.v2';
let lines = [], requests = {}, content, reviewCheckout;
try {
  const saved = JSON.parse(sessionStorage.getItem(storageKey));
  if (Array.isArray(saved?.lines)) lines = saved.lines.filter(line => validProduct(line.product) &&
    typeof line.product.offerToken === 'string' && typeof line.product.shop === 'string' &&
    Number.isInteger(line.quantity) && line.quantity > 0 && line.quantity <= 10).slice(0, 20);
  if (saved?.requests && typeof saved.requests === 'object' && !Array.isArray(saved.requests)) requests = saved.requests;
} catch { /* Start empty if browser storage is unavailable. */ }
function save() { try { sessionStorage.setItem(storageKey, JSON.stringify({ lines, requests })); } catch {} }
const trigger = document.getElementById('open-bag');
function count() {
  const total = lines.reduce((sum, line) => sum + line.quantity, 0);
  if (trigger) trigger.textContent = `Bag (${total})`;
  window.dispatchEvent(new CustomEvent('bag-count', { detail: total }));
}
function changed(shop) { delete requests[shop]; save(); count(); render(); }
export function addToBag(product) {
  if (!validProduct(product) || !product.offerToken || !product.shop || product.available !== true) throw new Error('Choose an available option first.');
  if (requests[product.shop]?.locked) throw new Error('Check the pending payment for this store before changing its bag.');
  const existing = lines.find(line => line.product.shop === product.shop && line.product.variantId === product.variantId);
  if (existing) { if (existing.quantity >= 10) throw new Error('You already have 10 of this item.'); existing.quantity++; existing.product = product; }
  else { if (lines.length >= 20) throw new Error('Your bag holds up to 20 different items.'); lines.push({ product, quantity: 1 }); }
  changed(product.shop);
}
export function checkoutState(shop, patch, requestId) {
  if (!requests[shop] || requests[shop].requestId !== requestId) return;
  Object.assign(requests[shop], patch); save(); render();
}
export function finishCheckout(shop, requestId) {
  if (requests[shop]?.requestId !== requestId) return;
  lines = lines.filter(line => line.product.shop !== shop); delete requests[shop]; save(); count(); render();
}
export function mountBag(node, onReview) { content = node; reviewCheckout = onReview; render(); count(); }
function render() {
  if (!content) return;
  content.replaceChildren();
  if (!lines.length) { content.append(el('p', 'A little room for something good.', 'bag-empty'), el('p', 'Explore product suggestions under your daily looks.', 'hint')); return; }
  content.append(el('p', 'One checkout per store. Review delivery and tax before paying.', 'hint'));
  for (const shop of new Set(lines.map(line => line.product.shop))) {
    const group = lines.filter(line => line.product.shop === shop), section = el('section', undefined, 'bag-store');
    section.append(el('h3', group[0].product.merchant));
    for (const line of group) {
      const row = el('div', undefined, 'bag-line'), copy = el('div', undefined, 'bag-line-copy');
      if (line.product.imageUrl) { const image = el('img'); image.src = line.product.imageUrl; image.alt = line.product.title; image.referrerPolicy = 'no-referrer'; row.append(image); }
      copy.append(el('h4', line.product.title), el('p', line.product.options.map(option => `${option.name}: ${option.value}`).join(' · '), 'hint'), el('p', formatProductPrice(line.product.price), 'shop-price'));
      const controls = el('div', undefined, 'bag-controls'), qty = el('select');
      qty.setAttribute('aria-label', `Quantity for ${line.product.title}`); qty.disabled = Boolean(requests[shop]?.locked);
      for (let i = 1; i <= 10; i++) { const option = el('option', String(i)); option.value = String(i); qty.append(option); }
      qty.value = String(line.quantity); qty.addEventListener('change', () => { line.quantity = Number(qty.value); changed(shop); });
      const remove = el('button', 'Remove', 'text-button'); remove.type = 'button'; remove.disabled = Boolean(requests[shop]?.locked);
      remove.setAttribute('aria-label', `Remove ${line.product.title} from bag`);
      remove.addEventListener('click', () => { lines = lines.filter(item => item !== line); changed(shop); });
      controls.append(qty, remove); copy.append(controls); row.append(copy); section.append(row);
    }
    for (const currency of new Set(group.map(line => line.product.price.currency))) {
      const amount = group.filter(line => line.product.price.currency === currency).reduce((sum, line) => sum + line.product.price.amount * line.quantity, 0);
      section.append(el('p', `Estimated subtotal · ${formatProductPrice({ amount, currency })}`, 'bag-subtotal'));
    }
    const review = el('button', requests[shop]?.checkoutRef ? 'View checkout status' : 'Review checkout', 'checkout-button'); review.type = 'button';
    review.setAttribute('aria-label', `${review.textContent} with ${group[0].product.merchant}`);
    review.addEventListener('click', () => {
      if (!requests[shop]) requests[shop] = { requestId: crypto.randomUUID() };
      save();
      void reviewCheckout(shop, { ...requests[shop], items: group.map(line => ({ offerToken: line.product.offerToken, quantity: line.quantity })) });
    });
    section.append(review); content.append(section);
  }
}
count();
