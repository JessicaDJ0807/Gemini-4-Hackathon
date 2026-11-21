import { formatProductPrice, validProduct, publicHttpsUrl } from '/shared/product-search.mjs';

const el = (tag, text, className) => {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text;
  if (className) node.className = className; return node;
};
const storageKey = 'travel-stylist.shopping-bag.v1';
let lines = [], requests = {}, revision = 0;
try {
  const saved = JSON.parse(sessionStorage.getItem(storageKey));
  if (Array.isArray(saved?.lines)) lines = saved.lines.filter(line => validProduct(line.product) &&
    typeof line.product.offerToken === 'string' && typeof line.product.shop === 'string' &&
    Number.isInteger(line.quantity) && line.quantity > 0 && line.quantity <= 10).slice(0, 20);
  if (saved?.requests && typeof saved.requests === 'object' && !Array.isArray(saved.requests)) requests = saved.requests;
} catch { /* A fresh bag is safe when browser storage is unavailable. */ }
function save() { try { sessionStorage.setItem(storageKey, JSON.stringify({ lines, requests })); } catch {} }
const trigger = document.getElementById('open-bag');
const dialog = el('dialog', undefined, 'bag-dialog'); dialog.setAttribute('aria-labelledby', 'bag-title');
const heading = el('div', undefined, 'bag-heading'), title = el('h2', 'Your bag'); title.id = 'bag-title';
const close = el('button', '×', 'icon-button'); close.type = 'button'; close.setAttribute('aria-label', 'Close shopping bag');
heading.append(title, close);
const content = el('div', undefined, 'bag-content');
dialog.append(heading, el('p', 'A few finishing touches for your trip.', 'hint'), content);
document.body.append(dialog);
close.addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) {
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
} });
trigger?.addEventListener('click', () => { render(); dialog.showModal(); });
function count() { if (trigger) trigger.textContent = `Bag (${lines.reduce((sum, line) => sum + line.quantity, 0)})`; }
function changed() { revision++; requests = {}; save(); count(); render(); }
export function addToBag(product) {
  if (!validProduct(product) || !product.offerToken || !product.shop || product.available !== true) throw new Error('Choose an available option first.');
  const existing = lines.find(line => line.product.shop === product.shop && line.product.variantId === product.variantId);
  if (existing) { if (existing.quantity >= 10) throw new Error('You already have 10 of this item in your bag.'); existing.quantity++; existing.product = product; }
  else { if (lines.length >= 20) throw new Error('Your bag holds up to 20 different items.'); lines.push({ product, quantity: 1 }); }
  changed();
}
function render() {
  content.replaceChildren();
  if (!lines.length) { content.append(el('p', 'Your bag is waiting for its first piece.', 'bag-empty'), el('p', 'Explore the suggestions in your daily looks.', 'hint')); return; }
  content.append(el('p', 'Check out separately with each store. Delivery and taxes are confirmed at payment.', 'hint'));
  const shops = [...new Set(lines.map(line => line.product.shop))];
  for (const shop of shops) {
    const group = lines.filter(line => line.product.shop === shop), section = el('section', undefined, 'bag-store');
    section.append(el('h3', group[0].product.merchant));
    for (const line of group) {
      const row = el('div', undefined, 'bag-line'), copy = el('div', undefined, 'bag-line-copy');
      if (line.product.imageUrl) { const image = el('img'); image.src = line.product.imageUrl; image.alt = line.product.title; image.referrerPolicy = 'no-referrer'; row.append(image); }
      copy.append(el('h4', line.product.title), el('p', line.product.options.map(option => `${option.name}: ${option.value}`).join(' · '), 'hint'), el('p', formatProductPrice(line.product.price), 'shop-price'));
      const controls = el('div', undefined, 'bag-controls'), qty = el('select');
      qty.setAttribute('aria-label', `Quantity for ${line.product.title}`);
      for (let i = 1; i <= 10; i++) { const option = el('option', String(i)); option.value = String(i); qty.append(option); }
      qty.value = String(line.quantity); qty.addEventListener('change', () => { line.quantity = Number(qty.value); changed(); });
      const remove = el('button', 'Remove', 'text-button'); remove.type = 'button'; remove.setAttribute('aria-label', `Remove ${line.product.title} from bag`);
      remove.addEventListener('click', () => { lines = lines.filter(item => item !== line); changed(); });
      controls.append(qty, remove); copy.append(controls); row.append(copy); section.append(row);
    }
    for (const currency of new Set(group.map(line => line.product.price.currency))) {
      const amount = group.filter(line => line.product.price.currency === currency).reduce((sum, line) => sum + line.product.price.amount * line.quantity, 0);
      section.append(el('p', `Estimated subtotal · ${formatProductPrice({ amount, currency })}`, 'bag-subtotal'));
    }
    const review = el('button', 'Review checkout', 'checkout-button'); review.type = 'button'; review.setAttribute('aria-label', `Review checkout with ${group[0].product.merchant}`);
    const status = el('p', '', 'shop-status'); status.setAttribute('role', 'status');
    const result = el('section', undefined, 'checkout-review'); result.hidden = true;
    review.addEventListener('click', async () => {
      const active = revision;
      const items = group.map(line => ({ offerToken: line.product.offerToken, quantity: line.quantity }));
      const fingerprint = JSON.stringify(items);
      if (requests[shop]?.fingerprint !== fingerprint) { requests[shop] = { fingerprint, requestId: crypto.randomUUID() }; save(); }
      const requestId = requests[shop].requestId;
      review.disabled = true; result.hidden = true; result.replaceChildren(); status.textContent = 'Preparing secure checkout…'; status.classList.add('is-loading');
      try {
        const response = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId, items }), signal: AbortSignal.timeout(25000) });
        const data = await response.json(); if (active !== revision) return;
        if (!response.ok) throw new Error(data.error?.message ?? 'Could not prepare checkout. Please try again.');
        if (data.requestId !== requestId || !publicHttpsUrl(data.continueUrl)) throw new Error('Could not read checkout. Please try again.');
        result.append(el('h4', 'Review with the store'));
        for (const item of data.items) result.append(el('p', `${item.quantity} × ${item.title} · ${formatProductPrice(item.price)} each`, 'hint'));
        for (const total of data.totals) { const row = el('p', undefined, 'checkout-total'); row.append(el('span', total.label), el('strong', formatProductPrice(total.price))); result.append(row); }
        for (const message of data.messages) result.append(el('p', message.content, 'checkout-message'));
        for (const link of data.links) { const anchor = el('a', link.title, 'checkout-legal'); anchor.href = link.url; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; result.append(anchor); }
        result.append(el('p', 'Review delivery, taxes, and the final total on the store’s secure checkout before paying.', 'hint'));
        const pay = el('a', 'Continue to secure payment ↗', 'button-link'); pay.href = data.continueUrl; pay.target = '_blank'; pay.rel = 'noopener noreferrer';
        result.append(pay); result.hidden = false; status.textContent = data.status === 'ready_for_complete' ? 'Checkout is ready. No payment has been made.' : 'Review the store’s notices below, then continue to its checkout.';
      } catch (error) { if (active === revision) status.textContent = error.name === 'TimeoutError' ? 'Checkout took too long. Try again; your bag is saved.' : error.message; }
      finally { if (active === revision) { review.disabled = false; status.classList.remove('is-loading'); } }
    });
    section.append(review, status, result); content.append(section);
  }
}
count();
