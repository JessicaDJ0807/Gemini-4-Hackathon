import { randomBytes } from 'node:crypto';
import { ApiError } from '../../packages/contracts/style-analysis.mjs';
import { publicHttpsUrl } from '../../packages/contracts/product-search.mjs';

// Official public client for a shopper's local prototype, not a distributed app credential.
const prototypeClient = '5c733ab2-1903-400a-891e-7ba20c09e2a3';
export function createShopAccounts({ fetchImpl = fetch, rpc, now = Date.now } = {}) {
  const sessions = new Map();
  function session(request, response, create = false) {
    const host = new URL(`http://${request.headers.host}`).hostname;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) throw new ApiError(503, 'SHOP_APP_SETUP_REQUIRED', 'Shop Pay prototype sign-in is available locally only. A registered Shop application is required for deployment.');
    for (const [id, value] of sessions) if (value.expires <= now()) sessions.delete(id);
    const id = request.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('stylist_shop='))?.slice(13);
    if (id && sessions.has(id)) return sessions.get(id);
    if (!create) return null;
    if (sessions.size >= 100) throw new ApiError(503, 'SHOP_BUSY', 'Please try again later.');
    const key = randomBytes(32).toString('hex');
    const value = { expires: now() + 8 * 60 * 60 * 1000, checkouts: new Map() }; sessions.set(key, value);
    response.setHeader('Set-Cookie', `stylist_shop=${key}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
    return value;
  }
  function token(state) {
    if (!state?.accessToken || state.tokenExpires <= now()) throw new ApiError(401, 'SHOP_SIGN_IN_REQUIRED', 'Connect Shop to use your saved address and Shop Pay.');
    return state.accessToken;
  }
  async function oauth(path, fields) {
    try {
      const response = await fetchImpl(`https://accounts.shop.app/oauth/${path}`, { method: 'POST', redirect: 'error',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields), signal: AbortSignal.timeout(20000) });
      const data = await response.json();
      if (!response.ok && !data.error) throw Error();
      return data;
    } catch { throw new ApiError(502, 'SHOP_SIGN_IN_UNAVAILABLE', 'Shop sign-in is unavailable. Please try again.', true); }
  }
  async function connect(state) {
    if (state.connecting) throw new ApiError(409, 'SHOP_BUSY', 'Sign-in is already starting.');
    if (state.pending && state.pending.expires > now()) return state.pending.public;
    if ([...state.checkouts.values()].some(entry => entry.busy || entry.attempted && !(entry.doc?.status === 'completed' && entry.doc?.order?.id))) throw new ApiError(409, 'PAYMENT_UNCONFIRMED', 'Check the existing payment status before changing Shop accounts.');
    state.connecting = true;
    try {
    const data = await oauth('device', { client_id: prototypeClient, resource: 'https://mcp.shop.com', scope: 'openid email personal_agent', device_name: 'Travel AI Stylist local demo' });
    const url = data.verification_uri_complete || data.verification_uri;
    if (typeof data.device_code !== 'string' || typeof data.user_code !== 'string' || !Number.isFinite(data.expires_in) || data.expires_in <= 0 ||
        typeof url !== 'string' || !/^https:\/\/(?:accounts\.shop\.app|shop\.app|shop\.com)\//.test(url)) throw new ApiError(502, 'SHOP_SIGN_IN_UNAVAILABLE', 'Shop sign-in could not start.');
    const interval = Math.max(5, Number(data.interval) || 5);
    const view = { signedIn: false, verificationUrl: url, userCode: data.user_code, interval };
    state.pending = { deviceCode: data.device_code, expires: now() + data.expires_in * 1000, interval, nextPoll: now() + interval * 1000, public: view };
    state.accessToken = null; state.checkouts.clear();
    return view;
    } finally { state.connecting = false; }
  }
  async function account(state) {
    const data = await rpc('get_account', {}, token(state));
    state.addresses = Array.isArray(data.addresses) ? data.addresses : [];
    return { signedIn: true, addresses: state.addresses.filter(a => typeof a.id === 'string').map(a => ({ id: a.id,
      label: [a.first_name, a.last_name, a.street_address, a.extended_address, a.address_locality, a.address_region, a.postal_code, a.address_country].filter(v => typeof v === 'string').join(', ') })),
      messages: (Array.isArray(data.messages) ? data.messages : []).filter(m => typeof m.content === 'string').map(m => m.content),
      links: (Array.isArray(data.links) ? data.links : []).filter(link => publicHttpsUrl(link.url) && typeof (link.title ?? link.type) === 'string').map(link => ({ title: link.title ?? link.type, url: link.url })) };
  }
  async function poll(state) {
    if (state?.accessToken && state.tokenExpires > now()) return account(state);
    const pending = state?.pending;
    if (!pending || pending.expires <= now()) { if (state) state.pending = null; throw new ApiError(401, 'SHOP_SIGN_IN_EXPIRED', 'Sign-in expired. Choose Connect Shop to start again.'); }
    if (now() < pending.nextPoll || pending.busy) return { signedIn: false, interval: pending.interval };
    pending.busy = true; pending.nextPoll = now() + pending.interval * 1000;
    try {
      const data = await oauth('token', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: prototypeClient, device_code: pending.deviceCode });
      if (state.pending !== pending) throw new ApiError(401, 'SHOP_SIGN_IN_EXPIRED', 'This sign-in was canceled.');
      if (data.error === 'authorization_pending') return { signedIn: false, interval: pending.interval };
      if (data.error === 'slow_down') { pending.interval += 5; pending.nextPoll = now() + pending.interval * 1000; return { signedIn: false, interval: pending.interval }; }
      if (typeof data.access_token !== 'string' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
        state.pending = null; throw new ApiError(401, 'SHOP_SIGN_IN_DECLINED', 'Shop sign-in was declined or expired. Connect again only when you’re ready.');
      }
      state.accessToken = data.access_token; state.tokenExpires = now() + data.expires_in * 1000; state.pending = null;
      return await account(state);
    } finally { pending.busy = false; }
  }
  return { session, token, connect, poll, account,
    disconnect(state) {
      if (state && ([...state.checkouts.values()].some(entry => entry.busy) || state.connecting)) throw new ApiError(409, 'SHOP_BUSY', 'Wait for the current Shop request before disconnecting.');
      if (state) { state.accessToken = null; state.pending = null; state.addresses = []; state.checkouts.clear(); }
      return { signedIn: false };
    } };
}
