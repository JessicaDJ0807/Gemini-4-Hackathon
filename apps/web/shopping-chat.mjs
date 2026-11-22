// The corner assistant handles the bag and payment; product suggestions stay in daily looks.
import { el, mountBag } from '/cart.mjs';
import { mountWallet } from '/shop-wallet.mjs';

const launcher = el('button', 'Bag & checkout ↗', 'shopping-launcher'); launcher.type = 'button';
const panel = el('section', undefined, 'shopping-panel'); panel.hidden = true; panel.id = 'shopping-panel';
panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-labelledby', 'shopping-title');
launcher.setAttribute('aria-controls', panel.id); launcher.setAttribute('aria-expanded', 'false');
const header = el('div', undefined, 'shopping-header'), copy = el('div'), title = el('h2', 'Your finishing touches'); title.id = 'shopping-title';
copy.append(el('p', 'YOUR BAG & SHOP PAY', 'eyebrow'), title);
const close = el('button', '×', 'icon-button'); close.type = 'button'; close.setAttribute('aria-label', 'Close checkout panel'); header.append(copy, close);
const tabs = el('div', undefined, 'shopping-tabs');
const bagButton = el('button', 'Bag'), checkoutButton = el('button', 'Checkout');
const bag = el('div', undefined, 'shopping-bag-view'), checkout = el('div', undefined, 'shopping-checkout-view');
let testMode = false;
try { testMode = (await (await fetch('/api/config')).json()).shoppingTestMode === true; } catch { /* Action errors are displayed by the wallet. */ }
const wallet = mountWallet(checkout, { testMode });
let returnFocus;
function switchView(view) {
  for (const [node, button] of [[bag, bagButton], [checkout, checkoutButton]]) { node.hidden = node !== view; button.setAttribute('aria-pressed', String(node === view)); }
}
for (const [button, view] of [[bagButton, bag], [checkoutButton, checkout]]) {
  button.type = 'button'; button.addEventListener('click', () => switchView(view)); tabs.append(button);
}
function open() { if (panel.hidden) returnFocus = document.activeElement; panel.hidden = false; launcher.hidden = true; launcher.setAttribute('aria-expanded', 'true'); switchView(bag); close.focus(); }
function shut() { panel.hidden = true; launcher.hidden = false; launcher.setAttribute('aria-expanded', 'false'); if (returnFocus?.isConnected) returnFocus.focus(); else launcher.focus(); }
launcher.addEventListener('click', open); close.addEventListener('click', shut);
panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); shut(); } });
document.getElementById('open-bag')?.addEventListener('click', open);
window.addEventListener('bag-count', event => { bagButton.textContent = `Bag (${event.detail})`; launcher.textContent = event.detail ? `Bag (${event.detail}) & checkout ↗` : 'Bag & checkout ↗'; });
mountBag(bag, async (shop, request) => { switchView(checkout); await wallet.open(shop, request); });
panel.append(header);
if (testMode) panel.append(el('p', 'PAYMENT TEST · Simulated data · No charges', 'shopping-test-banner'));
panel.append(tabs, bag, checkout); document.body.append(launcher, panel); switchView(bag);
