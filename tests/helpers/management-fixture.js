import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { createServer as createNetServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Manager } from '../../server/management/manager.js';
import { Runtime } from '../../server/management/runtime.js';
import { createManagementApi } from '../../server/management/api.js';
import { createServer } from '../../server/http-server.js';
import { serialize, parse } from '../../src/domain/config.js';

const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

export async function managementFixture({ setup = true, username = 'admin', password = 'test-management-password-123', importLimits } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-manager-'));
  const portServer = createNetServer(); portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening');
  const restPort = portServer.address().port;
  await new Promise(resolve => portServer.close(resolve));
  const config = path.join(directory, 'server/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini');
  const game = fileURLToPath(new URL('./fake-game.mjs', import.meta.url));
  const argvFile = path.join(directory, 'game-argv.json');
  const launcher = `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(game)} ${quote(config)} ${quote(argvFile)} "$@"\n`;
  const steamcmd = path.join(directory, 'steamcmd.sh');
  const installScript = path.join(directory, 'install.mjs');
  await writeFile(installScript, `import {mkdir,writeFile} from 'node:fs/promises';\nimport assert from 'node:assert/strict';\nconst args=process.argv.slice(2);\nassert.equal(args[0],'+force_install_dir');\nassert.deepEqual(args.slice(2),['+login','anonymous','+app_update','2394010','validate','+quit']);\nawait mkdir(args[1]+'/Pal/Binaries/Linux',{recursive:true});\nawait writeFile(args[1]+'/Pal/Binaries/Linux/PalServer-Linux-Shipping','fixture',{mode:0o755});\nawait writeFile(args[1]+'/PalServer.sh',${JSON.stringify(launcher)},{mode:0o755});\nconsole.log("Success! App '2394010' fully installed.");\nconsole.log('SteamCMD simulated installation complete');\n`);
  await writeFile(steamcmd, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(installScript)} "$@"\n`, { mode: 0o755 });
  const runtime = new Runtime(directory, { steamcmd, readyTimeout: 10000, stopTimeout: 5000 });
  const manager = new Manager({ directory, runtime, importLimits });
  await manager.initialize();
  if (setup) await manager.setupAdmin(username, password);
  const snapshot = manager.store.snapshot();
  snapshot.workspace.profiles[0].source = serialize(parse(snapshot.workspace.profiles[0].source), new Map([['RESTAPIPort', String(restPort)]]));
  snapshot.workspace.profiles[0].initialSource = snapshot.workspace.profiles[0].source;
  // Fixtures provision their original input before the first managed edit.
  manager.store.workspace = snapshot.workspace;
  await manager.store.persist();
  const server = createServer({ api: createManagementApi(manager) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  let csrf = '';
  async function request(route, { method = 'GET', body, headers = {}, authenticated = true } = {}) {
    return fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(authenticated ? { Cookie: cookie, 'X-Palbox-CSRF': csrf } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async function login() {
    const response = await request('/api/login', { method: 'POST', body: { username, password }, authenticated: false });
    cookie = response.headers.get('set-cookie').split(';')[0];
    csrf = (await response.json()).csrf;
    return { cookie, csrf };
  }
  async function upload(route, bytes, { contentType = 'application/gzip', headers = {}, authenticated = true } = {}) {
    return fetch(base + route, {
      method: 'POST',
      headers: { 'Content-Type': contentType, ...(authenticated ? { Cookie: cookie, 'X-Palbox-CSRF': csrf } : {}), ...headers },
      body: bytes
    });
  }
  async function task(action, payload = {}) {
    const response = await request('/api/tasks', { method: 'POST', body: { action, ...payload } });
    if (response.status !== 202) throw new Error(await response.text());
    const initial = await response.json();
    await manager.operation;
    return manager.tasks.find(t => t.id === initial.id);
  }
  return { directory, manager, runtime, server, base, restPort, username, password, argvFile, request, upload, login, task,
    async close() { await manager.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
  };
}
