import { createHash, randomUUID } from 'node:crypto';
import { ApiError } from '../../packages/contracts/style-analysis.mjs';
import { publicHttpsUrl } from '../../packages/contracts/product-search.mjs';

const fail = (message = 'Checkout details are unavailable. Refresh its status before continuing.') => new ApiError(502, 'INVALID_CHECKOUT', message);
const array = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' && value.length > 0;
const fingerprint = value => createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
const shopPay = instrument => instrument?.type === 'shop_pay' && text(instrument.id);
const revision = doc => fingerprint([doc.status, doc.currency, doc.line_items, doc.totals, doc.fulfillment, doc.payment, doc.messages, doc.links, doc.discounts]);

// Merchant documents and wallet credentials stay inside this browser's server session.
// The browser receives only a display model and an opaque local checkout reference.
export function createShopPay({ rpc, accounts, prepareCheckout }) {
  function accept(record, doc) {
    if (!doc || !text(doc.id) || (record.doc && doc.id !== record.doc.id) ||
        !/^[A-Z]{3}$/.test(doc.currency) || !publicHttpsUrl(doc.continue_url) ||
        !['incomplete', 'requires_escalation', 'ready_for_complete', 'complete_in_progress', 'completed', 'canceled'].includes(doc.status) ||
        !Array.isArray(doc.line_items) || !doc.line_items.length || !Array.isArray(doc.totals) ||
        !Array.isArray(doc.messages ?? []) || !Array.isArray(doc.links ?? []) ||
        doc.line_items.some(line => !text(line.item?.title) || !Number.isSafeInteger(line.item.price) || line.item.price < 0 || !Number.isSafeInteger(line.quantity) || line.quantity < 1) ||
        doc.totals.some(total => !text(total.display_text) || !Number.isSafeInteger(total.amount)) ||
        array(doc.messages).some(message => !text(message.content)) ||
        array(doc.links).some(link => !publicHttpsUrl(link.url) || !text(link.title ?? link.type))) throw fail();
    record.doc = doc;
    return view(record);
  }
  function view(record) {
    const doc = record.doc;
    if (!doc) throw fail();
    const money = amount => ({ amount, currency: doc.currency });
    const instruments = array(doc.payment?.instruments).filter(shopPay).map(item => ({ id: item.id, label: 'Shop Pay' }));
    const totals = doc.totals.filter(item => item.type === 'total');
    const total = totals.length === 1 ? totals[0] : null;
    const completed = doc.status === 'completed' && text(doc.order?.id);
    return { checkoutRef: record.ref, merchant: record.shop, revision: revision(doc), status: doc.status,
      attempted: Boolean(record.attempted), completed: Boolean(completed), orderId: completed ? doc.order.id : null,
      canPay: !record.attempted && doc.status === 'ready_for_complete' && instruments.length > 0 && total?.amount >= 0,
      total: total ? money(total.amount) : null,
      items: doc.line_items.map(line => ({ id: line.id, title: line.item.title, quantity: line.quantity, price: money(line.item.price) })),
      totals: doc.totals.map(item => ({ label: item.display_text, price: money(item.amount) })),
      messages: array(doc.messages).map(item => ({ content: item.content, type: item.type, path: item.path, severity: item.severity })),
      links: array(doc.links).map(item => ({ title: item.title ?? item.type, url: item.url })),
      continueUrl: doc.continue_url, instruments,
      delivery: array(doc.fulfillment?.methods).map(method => ({ id: method.id, type: method.type,
        selectedAddress: method.selected_destination_id ?? '',
        groups: array(method.groups).map(group => ({ id: group.id, selectedOption: group.selected_option_id ?? '',
          options: array(group.options).map(option => ({ id: option.id, label: option.title ?? option.description ?? option.id,
            totals: array(option.totals).filter(t => Number.isSafeInteger(t.amount)).map(t => ({ label: t.display_text ?? t.type, price: money(t.amount) })) })) })) })) };
  }
  function lookup(state, body) {
    accounts.token(state);
    const record = state.checkouts.get(body?.checkoutRef);
    if (!record) throw new ApiError(404, 'CHECKOUT_NOT_FOUND', 'This checkout session is unavailable. If you already paid, check your Shop account before starting another.');
    return record;
  }
  async function read(state, record) {
    return accept(record, await rpc('get_checkout', { shop: record.shop, id: record.doc.id }, accounts.token(state)));
  }
  async function locked(record, run) {
    if (record.busy) throw new ApiError(409, 'CHECKOUT_BUSY', 'Checkout is updating. Wait, then refresh its status.');
    record.busy = true;
    try { return await run(); } finally { record.busy = false; }
  }
  async function create(state, body) {
    const token = accounts.token(state), signature = fingerprint(body?.items);
    let record = [...state.checkouts.values()].find(entry => entry.requestId === body?.requestId);
    if (record) {
      if (record.signature !== signature) throw new ApiError(409, 'CHECKOUT_CHANGED', 'Review the changed bag as a new checkout.');
      if (record.doc) return locked(record, () => read(state, record));
    }
    const lines = prepareCheckout(body);
    if (!record) {
      if ([...state.checkouts.values()].some(entry => entry.attempted && !(entry.doc?.status === 'completed' && entry.doc?.order?.id))) {
        throw new ApiError(409, 'PAYMENT_UNCONFIRMED', 'A previous payment is not confirmed. Refresh that checkout or check Shop before starting another.');
      }
      if (state.checkouts.size >= 30) throw new ApiError(429, 'TOO_MANY_CHECKOUTS', 'Too many checkouts in this session.');
      record = { ref: randomUUID(), requestId: body.requestId, signature, shop: lines[0].shop,
        args: { shop: lines[0].shop, checkout: { line_items: lines.map(line => ({ item: { id: line.variantId }, quantity: line.quantity })) }, meta: { 'idempotency-key': body.requestId } } };
      state.checkouts.set(record.ref, record);
    }
    return locked(record, async () => accept(record, await rpc('create_checkout', record.args, token)));
  }
  async function update(state, body) {
    const record = lookup(state, body);
    return locked(record, async () => {
      await read(state, record);
      if (record.attempted || !['incomplete', 'ready_for_complete'].includes(record.doc.status)) throw new ApiError(409, 'CHECKOUT_LOCKED', 'This checkout cannot be edited. Refresh its status.');
      if (body.revision !== revision(record.doc)) return { ...view(record), reviewRequired: true };
      const doc = structuredClone(record.doc);
      delete doc.next; delete doc.signals; delete doc.attribution;
      const method = array(doc.fulfillment?.methods).find(item => item.id === body.methodId);
      if (!method) throw new ApiError(400, 'INVALID_DELIVERY', 'Choose a delivery method offered by this store.');
      if (body.addressId) {
        if (method.type !== 'shipping') throw new ApiError(400, 'INVALID_DELIVERY', 'Choose a shipping method for this address.');
        await accounts.account(state);
        const address = state.addresses.find(item => item.id === body.addressId);
        if (!address) throw new ApiError(400, 'INVALID_ADDRESS', 'Choose an address saved in Shop.');
        method.destinations = [...array(method.destinations).filter(item => item.id !== address.id), structuredClone(address)];
        method.selected_destination_id = address.id;
      } else {
        const group = array(method.groups).find(item => item.id === body.groupId);
        if (!group || !array(group.options).some(item => item.id === body.optionId)) throw new ApiError(400, 'INVALID_DELIVERY', 'Choose a delivery option offered by this store.');
        group.selected_option_id = body.optionId;
      }
      return accept(record, await rpc('update_checkout', { shop: record.shop, id: doc.id, checkout: doc, meta: { 'idempotency-key': randomUUID() } }, accounts.token(state)));
    });
  }
  async function pay(state, body) {
    const record = lookup(state, body);
    return locked(record, async () => {
      if (record.attempted) return read(state, record); // Never resubmit a payment, even after an error.
      if (body.confirmed !== true || !text(body.instrumentId)) throw new ApiError(400, 'CONFIRM_PAYMENT', 'Choose Shop Pay and confirm the displayed total.');
      await read(state, record);
      if (body.revision !== revision(record.doc)) return { ...view(record), reviewRequired: true };
      const instrument = array(record.doc.payment?.instruments).find(item => item.id === body.instrumentId && shopPay(item));
      if (!view(record).canPay || !instrument) throw new ApiError(409, 'PAYMENT_NOT_READY', 'This store cannot complete this checkout here. Review its notices.');
      record.attempted = true;
      try {
        return accept(record, await rpc('complete_checkout', { shop: record.shop, id: record.doc.id,
          checkout: { payment: { instruments: [{ ...structuredClone(instrument), selected: true }] } } }, accounts.token(state)));
      } catch {
        // Even an HTTP error can follow a successful charge. Read only from now on.
        try { return await read(state, record); }
        catch { return { ...view(record), outcomeUnknown: true }; }
      }
    });
  }
  return { create, update, pay, async refresh(state, body) { const record = lookup(state, body); return locked(record, () => read(state, record)); } };
}
