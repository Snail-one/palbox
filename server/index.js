import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from './http-server.js';
import { Manager } from './management/manager.js';
import { createManagementApi } from './management/api.js';

function port(value, name) {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw new Error(`${name} 必须是 1 到 65535 的整数。`);
  return Number(value);
}

let manager;
try {
  const listenPort = port(process.env.PORT || '8080', 'PORT');
  const password = process.env.PALBOX_ADMIN_PASSWORD_FILE
    ? (await readFile(process.env.PALBOX_ADMIN_PASSWORD_FILE, 'utf8')).trim()
    : process.env.PALBOX_ADMIN_PASSWORD;
  const args = JSON.parse(process.env.PALBOX_GAME_ARGS || '[]');
  if (!Array.isArray(args) || args.some(v => typeof v !== 'string' || v.includes('\0'))) throw new Error('PALBOX_GAME_ARGS 必须是字符串 JSON 数组。');
  manager = new Manager({ directory: process.env.PALBOX_DATA_DIR || fileURLToPath(new URL('../data', import.meta.url)), password, steamcmd: process.env.PALBOX_STEAMCMD || '/opt/steamcmd/steamcmd.sh', port: port(process.env.PALBOX_GAME_PORT || '8211', 'PALBOX_GAME_PORT'), webPort: listenPort, args });
  await manager.initialize();
  const api = createManagementApi(manager, { secureCookie: process.env.PALBOX_SECURE_COOKIE === 'true' });
  const server = createServer({ api });
  const host = process.env.HOST || '127.0.0.1';
  server.on('error', error => { console.error(`启动失败：${error.message}`); process.exitCode = 1; manager?.close(); });
  server.listen(listenPort, host, async () => {
    console.log(`Palbox 游戏管理已启动：http://${host}:${listenPort}`);
    try {
      if (process.env.PALBOX_AUTO_INSTALL === 'true' && !(await manager.runtime.installed())) await manager.submit('install', { start: process.env.PALBOX_AUTO_START === 'true' });
      else if (process.env.PALBOX_AUTO_START === 'true' && await manager.runtime.installed()) await manager.submit('start');
    } catch (error) { manager.runtime.log('palbox', `自动启动失败：${error.message}\n`); }
  });
  let closing = false;
  async function close() {
    if (closing) return; closing = true;
    server.close();
    await manager?.close();
    server.closeAllConnections();
  }
  process.on('SIGTERM', () => close().catch(error => { console.error(error.message); process.exitCode = 1; }));
  process.on('SIGINT', () => close().catch(error => { console.error(error.message); process.exitCode = 1; }));
} catch (error) {
  console.error(`启动失败：${error.message}`);
  await manager?.close();
  process.exitCode = 1;
}
