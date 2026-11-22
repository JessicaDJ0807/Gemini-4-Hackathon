import { el, checkoutState, finishCheckout } from '/cart.mjs';
import { formatProductPrice, publicHttpsUrl } from '/shared/product-search.mjs';

const link = (label, url) => {
  const anchor = el('a', label, 'checkout-legal');
  if (publicHttpsUrl(url)) { anchor.href = url; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; }
  return anchor;
};
async function api(action, body = {}) {
  const response = await fetch(`/api/shop-pay/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(65000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || 'Shop is unavailable. Refresh before trying again.');
  return result;
}
export function mountWallet(root, { testMode = false } = {}) {
  let account = null, current, shop, bag, busy = false, timer, generation = 0;
  const accountBox = el('div', undefined, 'wallet-account'), review = el('div'), status = el('p', '', 'shop-status');
  status.setAttribute('role', 'status'); root.append(accountBox, status, review);
  function button(label, action, className = 'checkout-button') {
    const node = el('button', label, className); node.type = 'button'; node.addEventListener('click', () => void run(action)); return node;
  }
  async function run(action) {
    if (busy) return; busy = true; status.textContent = 'Connecting to Shop…'; status.classList.add('is-loading');
    root.querySelectorAll('button, select').forEach(node => { node.disabled = true; });
    try { await action(); } catch (error) {
      status.textContent = error.name === 'TimeoutError' ? 'Shop took too long. If you submitted payment, refresh its status; do not start another checkout.' : error.message;
    } finally { busy = false; status.classList.remove('is-loading'); root.querySelectorAll('button, select').forEach(node => { node.disabled = false; });
      // The payment control is enabled only after an explicit instrument selection.
      const pay = review.querySelector('[data-pay]'), choice = review.querySelector('[data-instrument]'); if (pay) pay.disabled = !choice?.value;
    }
  }
  async function poll(active, interval) {
    timer = setTimeout(async () => {
      if (active !== generation) return;
      try {
        const result = await api('poll'); if (active !== generation) return;
        if (result.signedIn) { account = result; status.textContent = 'Shop connected. Review your bag to continue.'; renderAccount(); if (bag) await run(loadCheckout); }
        else poll(active, result.interval || interval);
      } catch (error) { if (active === generation) { status.textContent = error.message; renderAccount(); } }
    }, Math.max(5, interval) * 1000);
  }
  function renderAccount() {
    accountBox.replaceChildren();
    if (account?.signedIn) {
      accountBox.append(el('p', 'Shop connected', 'wallet-connected'));
      for (const message of account.messages || []) accountBox.append(el('p', message, 'checkout-message'));
      for (const item of account.links || []) accountBox.append(link(item.title, item.url));
      accountBox.append(button('Disconnect this session', async () => {
        await api('disconnect'); account = null; generation++; clearTimeout(timer); current = null; review.replaceChildren(); renderAccount(); status.textContent = 'Disconnected here. Manage the app’s connection in your Shop account.';
      }, 'text-button'));
    } else {
      accountBox.append(el('p', 'Use your saved Shop Pay wallet.', 'wallet-connected'), el('p', 'First, approve the connection on Shop’s page. Then return here to review delivery and pay with your saved wallet.', 'connection-note'));
      accountBox.append(button('Connect Shop', async () => {
        generation++; clearTimeout(timer);
        const result = await api('connect'); accountBox.replaceChildren(el('p', 'Connect your Shop account', 'wallet-connected'), el('p', 'This connects your wallet. It does not make a payment.', 'hint'), el('p', result.userCode, 'connection-code'));
        if (testMode) accountBox.append(el('p', 'Simulating approval in 5 seconds. No real Shop sign-in is needed.', 'hint'));
        else accountBox.append(link('Approve connection on Shop ↗', result.verificationUrl), el('p', 'Check this code on Shop’s page. Come back here afterward to review and confirm your purchase.', 'connection-note'));
        status.textContent = 'Waiting for your approval on Shop…'; poll(generation, result.interval);
      }));
    }
  }
  function renderCheckout(data) {
    current = data; checkoutState(shop, { checkoutRef: data.checkoutRef, locked: Boolean(data.attempted) }, bag.requestId); review.replaceChildren();
    const heading = el('h3', data.completed ? 'Order confirmed' : 'Review your checkout'); heading.tabIndex = -1; review.append(heading);
    review.append(el('p', data.merchant, 'hint'));
    for (const [index, item] of data.items.entries()) {
      const block = el('div', undefined, 'checkout-item'); block.append(el('p', `${item.quantity} × ${item.title}`, 'checkout-item-title'), el('p', `${formatProductPrice(item.price)} each`, 'hint'));
      // Keep item disclosures beside their referenced line, and all notices below as well.
      for (const message of data.messages.filter(message => typeof message.path === 'string' && item.id && (message.path.includes(item.id) || message.path.includes(`line_items[${index}]`) || message.path.includes(`/line_items/${index}`)))) block.append(el('p', message.content, 'checkout-message'));
      review.append(block);
    }
    for (const total of data.totals) { const row = el('p', undefined, 'checkout-total'); row.append(el('span', total.label), el('strong', formatProductPrice(total.price))); review.append(row); }
    for (const message of data.messages) review.append(el('p', message.content, 'checkout-message'));
    for (const item of data.links) review.append(link(item.title, item.url));
    review.append(link('Review on the store’s site ↗', data.continueUrl));
    if (data.completed) {
      review.append(el('p', `Order ${data.orderId}`, 'wallet-connected')); status.textContent = 'The store confirmed your order.';
      finishCheckout(shop, bag.requestId); return;
    }
    if (data.attempted || data.status === 'complete_in_progress' || data.outcomeUnknown) {
      status.textContent = 'Payment was submitted. The order is not confirmed yet. Refresh its status before doing anything else.';
      review.append(button('Refresh payment status', async () => renderCheckout(await api('refresh', { checkoutRef: data.checkoutRef })))); return;
    }
    status.textContent = data.reviewRequired ? 'Checkout changed. Review the updated details before confirming again.' : 'No payment has been made.';
    if (data.status === 'requires_escalation') review.append(el('p', 'This store requires a step on its own site. Payment cannot finish in this panel.', 'checkout-message'));
    else if (data.status === 'canceled') review.append(el('p', 'This checkout was canceled.', 'checkout-message'));
    else {
      for (const method of data.delivery) {
        if (method.type === 'shipping' && account?.addresses?.length) {
          const label = el('label', 'Deliver to'), select = el('select'); label.append(select);
          const empty = el('option', 'Choose a saved address'); empty.value = ''; select.append(empty);
          for (const address of account.addresses) { const option = el('option', address.label); option.value = address.id; select.append(option); }
          select.value = method.selectedAddress;
          select.addEventListener('change', () => { if (select.value) void run(async () => renderCheckout(await api('update', { checkoutRef: data.checkoutRef, revision: data.revision, methodId: method.id, addressId: select.value }))); }); review.append(label);
        }
        for (const group of method.groups) {
          const label = el('label', 'Delivery option'), select = el('select'); label.append(select);
          const empty = el('option', 'Choose delivery'); empty.value = ''; select.append(empty);
          for (const choice of group.options) { const option = el('option', [choice.label, ...choice.totals.map(total => `${total.label}: ${formatProductPrice(total.price)}`)].join(' · ')); option.value = choice.id; select.append(option); }
          select.value = group.selectedOption;
          select.addEventListener('change', () => { if (select.value) void run(async () => renderCheckout(await api('update', { checkoutRef: data.checkoutRef, revision: data.revision, methodId: method.id, groupId: group.id, optionId: select.value }))); }); review.append(label);
        }
      }
      if (data.canPay) {
        const label = el('label', 'Payment method'), select = el('select'); select.dataset.instrument = ''; label.append(select);
        const empty = el('option', 'Choose a payment method'); empty.value = ''; select.append(empty);
        for (const instrument of data.instruments) { const option = el('option', instrument.label); option.value = instrument.id; select.append(option); }
        const pay = button(`${testMode ? 'Simulate paying' : 'Pay'} ${formatProductPrice(data.total)} with Shop Pay`, async () => {
          checkoutState(shop, { locked: true }, bag.requestId);
          // Persist a local lock BEFORE sending. A lost response can still mean a charge.
          current = { ...data, attempted: true }; review.replaceChildren();
          review.append(button('Refresh payment status', async () => renderCheckout(await api('refresh', { checkoutRef: data.checkoutRef }))));
          renderCheckout(await api('pay', { checkoutRef: data.checkoutRef, revision: data.revision, instrumentId: select.value, confirmed: true }));
        }, 'shop-pay-button');
        pay.dataset.pay = ''; pay.disabled = true; select.addEventListener('change', () => { pay.disabled = !select.value || busy; });
        review.append(label, pay, el('p', testMode ? 'Test only. No order is placed and no card is charged.' : 'This places your order and charges the selected wallet.', 'hint'));
      } else if (data.status === 'ready_for_complete') review.append(el('p', 'This store has not offered an in-panel Shop Pay method. Use the store link to review your options.', 'hint'));
    }
    review.append(button('Refresh checkout', async () => renderCheckout(await api('refresh', { checkoutRef: data.checkoutRef })), 'text-button'));
  }
  async function loadCheckout() {
    const result = bag.checkoutRef ? await api('refresh', { checkoutRef: bag.checkoutRef }) : await api('checkout', { requestId: bag.requestId, items: bag.items });
    bag.checkoutRef = result.checkoutRef; renderCheckout(result);
  }
  renderAccount();
  return {
    async open(merchant, request) {
      if (busy) return;
      shop = merchant; bag = request; current = null; review.replaceChildren();
      await run(async () => {
        account = await api('account'); renderAccount();
        if (!account.signedIn) { status.textContent = 'Connect Shop to review your checkout.'; return; }
        await loadCheckout();
      });
    }
  };
}
