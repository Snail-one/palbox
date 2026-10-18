import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const watch = process.argv.includes('--watch');
const apiPort = process.env.API_PORT || '8081';
const apiHost = process.env.API_HOST || '127.0.0.1';
const port = process.env.PORT || '8080';
if (apiPort === port) throw new Error('PORT 和 API_PORT 必须使用不同端口。');
const address = apiHost === '0.0.0.0' ? '127.0.0.1' : apiHost === '::' ? '[::1]' : apiHost.includes(':') ? `[${apiHost}]` : apiHost;
const children = new Set();
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
}
function start(entry, env) {
  const child = spawn(process.execPath, [...(watch ? ['--watch'] : []), entry], { cwd: root, env: { ...process.env, ...env }, stdio: 'inherit' });
  children.add(child);
  child.on('error', error => { console.error(error.message); close(1); });
  child.on('exit', code => { children.delete(child); close(code ?? 1); });
}
start('backend/index.js', { HOST: apiHost, PORT: apiPort });
start('frontend/index.js', { PORT: port, PALBOX_API_URL: process.env.PALBOX_API_URL || `http://${address}:${apiPort}` });
process.on('SIGINT', () => close());
process.on('SIGTERM', () => close());
