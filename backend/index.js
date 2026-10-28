import paths from '../shared/data-paths.cjs';
import { createServer } from './http-server.js';
import { Manager } from './management/manager.js';
import { createManagementApi } from './management/api.js';
import { logPolicyFromEnv } from './management/log-retention.js';
import { assertNonRoot } from '../shared/runtime-user.js';

process.env.TZ = 'UTC';

function port(value, name) {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw new Error(`${name} 必须是 1 到 65535 的整数。`);
  return Number(value);
}

let manager;
try {
  assertNonRoot();
  const listenPort = port(process.env.PORT || '8081', 'PORT');
  const host = process.env.HOST || '127.0.0.1';
  const secureCookie = /^(?:true|1)$/i.test(process.env.PALBOX_SECURE_COOKIE || '');
  // The launcher supplies this only when the frontend shares the backend's host.
  // Separate Docker containers may use the same TCP port without a conflict.
  const webPort = process.env.PALBOX_WEB_PORT ? port(process.env.PALBOX_WEB_PORT, 'PALBOX_WEB_PORT') : null;
  manager = new Manager({ directory: paths.dataPaths().root, steamcmd: process.env.PALBOX_STEAMCMD || undefined, port: port(process.env.PALBOX_GAME_PORT || '8211', 'PALBOX_GAME_PORT'), apiPort: listenPort, webPort, logs: logPolicyFromEnv(process.env) });
  await manager.initialize();
  const api = createManagementApi(manager, { secureCookie, trustedProxies: process.env.PALBOX_TRUSTED_PROXIES });
  const server = createServer({ api });
  server.on('error', error => { console.error(`启动失败：${error.message}`); process.exitCode = 1; manager?.close(); });
  server.listen(listenPort, host, () => {
    if (manager.needsSetup()) console.log(`首次初始化码：${manager.setupCode}（仅本次启动有效，创建管理员后失效）`);
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
