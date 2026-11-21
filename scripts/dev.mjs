import { randomBytes } from 'node:crypto';
import { createMockAiServer } from './mock-ai.mjs';
import { createWebServer } from '../apps/web/server.mjs';

let aiBaseUrl = process.env.AI_BASE_URL?.replace(/\/$/, '');
let token = process.env.AI_SERVICE_TOKEN;
let mock;
const provider = aiBaseUrl ? 'live' : 'demo';
if (Boolean(aiBaseUrl) !== Boolean(token)) throw new Error('Set both AI_BASE_URL and AI_SERVICE_TOKEN, or leave both empty for demo mode.');
if (aiBaseUrl) {
  const url = new URL(aiBaseUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('AI_BASE_URL must use HTTPS, except for local development.');
  }
} else {
  token = randomBytes(32).toString('hex');
  mock = createMockAiServer({ token });
  await new Promise((resolve, reject) => mock.once('error', reject).listen(0, '127.0.0.1', resolve));
  aiBaseUrl = `http://127.0.0.1:${mock.address().port}`;
}
const web = createWebServer({ aiBaseUrl, token, provider, placesKey: process.env.GOOGLE_MAPS_API_KEY, geminiKey: process.env.GEMINI_API_KEY, geminiModel: process.env.GEMINI_MODEL || undefined,
  publicAppUrl: process.env.PUBLIC_APP_URL || `http://127.0.0.1:${process.env.PORT ?? 3000}` });
try {
  await new Promise((resolve, reject) => web.once('error', reject).listen(Number(process.env.PORT ?? 3000), '127.0.0.1', resolve));
} catch (error) { mock?.close(); throw error; }
console.log(`Style onboarding: http://127.0.0.1:${web.address().port} (${provider} mode)`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  web.close(); web.closeAllConnections(); mock?.close(); mock?.closeAllConnections();
});
