import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { userInfo } from 'node:os';
import { assertNonRoot } from '../shared/runtime-user.js';
import paths from '../shared/data-paths.cjs';

try { assertNonRoot(); }
catch (error) { console.error(`启动失败：${error.message}`); process.exit(1); }

const root = fileURLToPath(new URL('../', import.meta.url));
const watch = process.argv.includes('--watch');
const apiPort = process.env.API_PORT || '8081';
const apiHost = process.env.API_HOST || '127.0.0.1';
const port = process.env.PORT || '8080';
const dataDirectory = paths.dataPaths().root;
if (process.env.PALBOX_SERVICE_USER && process.env.PALBOX_SERVICE_USER !== userInfo().username) throw new Error(`请使用配置的系统用户 ${process.env.PALBOX_SERVICE_USER} 启动 PalBox，避免 data 目录权限冲突。`);
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
// Frontend and backend have different proxy boundaries even when launched
// together. An external proxy allowlist must not replace loopback API trust.
console.log(`游戏管理：http://${process.env.HOST || '127.0.0.1'}:${port}/#game`);
console.log(`数据目录：${dataDirectory}（已有数据沿用原管理员账号）`);
start('backend/index.js', { HOST: apiHost, PORT: apiPort, PALBOX_WEB_PORT: port, PALBOX_DATA_DIR: dataDirectory, PALBOX_TRUSTED_PROXIES: process.env.API_TRUSTED_PROXIES ?? '127.0.0.1,::1' });
start('frontend/index.js', { PORT: port, PALBOX_API_URL: process.env.PALBOX_API_URL || `http://${address}:${apiPort}` });
process.on('SIGINT', () => close());
process.on('SIGTERM', () => close());
