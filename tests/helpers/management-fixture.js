import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { createServer as createNetServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Manager } from '../../backend/management/manager.js';
import { Runtime } from '../../backend/management/runtime.js';
import { createManagementApi } from '../../backend/management/api.js';
import { createServer } from '../../backend/http-server.js';
import { createServer as createFrontendServer } from '../../frontend/http-server.js';
import { serialize, parse } from '../../shared/domain/config.js';
import template from '../../shared/domain/template.js';
import { createProfile, DERIVED_DEFAULT_ORIGIN } from '../../shared/domain/workspace.js';

const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

export async function managementFixture({ setup = true, username = 'admin', password = 'test-management-password-123', importLimits, editable = true, officialDefaults = true } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-manager-'));
  await mkdir(path.join(directory, 'server'), { recursive: true });
  if (officialDefaults) await writeFile(path.join(directory, 'server/DefaultPalWorldSettings.ini'), template);
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
  // Most management tests explicitly work with an independent editable world.
  if (editable) {
    const working = createProfile('我的帕鲁世界', await manager.store.defaultTemplate(), { origin: DERIVED_DEFAULT_ORIGIN });
    manager.store.workspace.profiles.unshift(working);
    manager.store.workspace.activeId = working.id;
  }
  if (setup) await manager.setupAdmin(username, password);
  const snapshot = manager.store.snapshot();
  if (snapshot.workspace.profiles.length) {
    snapshot.workspace.profiles[0].source = serialize(parse(snapshot.workspace.profiles[0].source), new Map([['RESTAPIPort', String(restPort)]]));
    snapshot.workspace.profiles[0].initialSource = snapshot.workspace.profiles[0].source;
  }
  // Fixtures provision their original input before the first managed edit.
  manager.store.workspace = snapshot.workspace;
  await manager.store.persist();
  const backend = createServer({ api: createManagementApi(manager) });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  const apiBase = `http://127.0.0.1:${backend.address().port}`;
  const server = createFrontendServer({ apiUrl: apiBase });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  let csrf = '';
  async function request(route, { method = 'GET', body, headers = {}, authenticated = true } = {}) {
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(authenticated ? { Cookie: cookie, 'X-Palbox-CSRF': csrf } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    // Like the browser, adopt successful rotation for this client only.
    if (authenticated && !Object.keys(headers).some(name => name.toLowerCase() === 'cookie') && response.ok && response.headers.has('set-cookie')) {
      cookie = response.headers.get('set-cookie').split(';')[0];
      csrf = (await response.clone().json()).csrf ?? '';
    }
    return response;
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
  return { directory, manager, runtime, server, backend, base, apiBase, restPort, username, password, argvFile, request, upload, login, task,
    async close() {
      await manager.close();
      for (const service of [server, backend]) {
        service.closeAllConnections();
        await new Promise(resolve => service.close(resolve));
      }
      await rm(directory, { recursive: true, force: true });
    }
  };
}
