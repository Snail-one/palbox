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
  const listenPort = port(process.env.PORT || '8081', 'PORT');
  const host = process.env.HOST || '127.0.0.1';
  const secureCookie = /^(?:true|1)$/i.test(process.env.PALBOX_SECURE_COOKIE || '');
  manager = new Manager({ directory: process.env.PALBOX_DATA_DIR || fileURLToPath(new URL('../data', import.meta.url)), steamcmd: process.env.PALBOX_STEAMCMD || '/opt/steamcmd/steamcmd.sh', port: port(process.env.PALBOX_GAME_PORT || '8211', 'PALBOX_GAME_PORT'), webPort: listenPort });
  await manager.initialize();
  const api = createManagementApi(manager, { secureCookie, trustedProxies: process.env.PALBOX_TRUSTED_PROXIES });
  const server = createServer({ api });
  server.on('error', error => { console.error(`启动失败：${error.message}`); process.exitCode = 1; manager?.close(); });
  server.listen(listenPort, host, () => {
    console.log(`Palbox 游戏管理已启动：http://${host}:${listenPort}`);
    if (!secureCookie && !['127.0.0.1', '::1', 'localhost'].includes(host)) {
      console.warn('提示：未启用 Secure Cookie；若通过 HTTPS 反向代理访问面板，请设置 PALBOX_SECURE_COOKIE=true。');
    }
    manager.autoStartServer().catch(error => console.error(`自动启动失败：${error.message}`));
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
