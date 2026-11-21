import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const serviceDir = fileURLToPath(new URL('../services/ai/', import.meta.url));
const python = fileURLToPath(new URL('../services/ai/.venv/bin/python', import.meta.url));
if (!process.env.GEMINI_API_KEY) throw new Error('Set GEMINI_API_KEY in the root .env before running the live A+B app.');
try { await access(python); } catch { throw new Error('Create services/ai/.venv and install services/ai/requirements.txt first. See apps/web/README.md.'); }
const port = Number(process.env.PORT || 3000), aiPort = Number(process.env.AI_PORT || 8001);
for (const value of [port, aiPort]) if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error('PORT and AI_PORT must be ports between 1024 and 65535.');
if (port === aiPort) throw new Error('PORT and AI_PORT must differ.');
const env = { ...process.env, AI_BASE_URL: `http://127.0.0.1:${aiPort}`,
  AI_SERVICE_TOKEN: process.env.AI_SERVICE_TOKEN || randomBytes(32).toString('hex'),
  PUBLIC_APP_URL: process.env.PUBLIC_APP_URL || `http://127.0.0.1:${port}`,
  MEDIA_ALLOWED_HOSTS: process.env.MEDIA_ALLOWED_HOSTS || '127.0.0.1,localhost',
  OUTFIT_MODEL: process.env.OUTFIT_MODEL || process.env.GEMINI_MODEL || 'gemini-4-hydrogen' };
let web, stopping = false;
const ai = spawn(python, ['-m', 'uvicorn', 'src.api.app:app', '--host', '127.0.0.1', '--port', String(aiPort)], {cwd: serviceDir, env, stdio: 'inherit'});
function stop(code = 0) {
  if (stopping) return; stopping = true; process.exitCode = code;
  ai.kill('SIGTERM'); web?.kill('SIGTERM');
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
ai.on('error', () => { console.error('Could not start A. Check the Python setup.'); stop(1); });
ai.on('exit', code => { if (!stopping) { console.error('A stopped; stopping the app.'); stop(code || 1); } });
let ready = false;
for (let attempt = 0; attempt < 80 && !stopping; attempt++) {
  try { const response = await fetch(`${env.AI_BASE_URL}/health`, {signal: AbortSignal.timeout(500)}); if (response.ok && ai.exitCode === null) { ready = true; break; } }
  catch { /* A is still starting. */ }
  await delay(250);
}
if (!ready) { console.error('A did not become ready. Check its startup messages.'); stop(1); }
else if (!stopping) {
  web = spawn(process.execPath, ['scripts/dev.mjs'], { cwd: root, env, stdio: 'inherit' });
  web.on('error', () => { console.error('Could not start B.'); stop(1); });
  web.on('exit', code => { if (!stopping) stop(code || 1); });
}
