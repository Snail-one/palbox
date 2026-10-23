import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('真实启动入口区分原生共用端口和独立后端的端口边界', { timeout: 20000 }, async t => {
  for (const native of [true, false]) {
    await t.test(native ? '原生双进程' : '独立后端', async t => {
      const directory = await mkdtemp('/tmp/palbox-port-startup-');
      t.after(() => rm(directory, { recursive: true, force: true }));
      await mkdir(path.join(directory, 'server'));
      await writeFile(path.join(directory, 'server/DefaultPalWorldSettings.ini'), 'OptionSettings=(RESTAPIEnabled=False,AdminPassword="",RESTAPIPort=8212)');
      const apiPort = await freePort();
      let webPort = await freePort();
      while (webPort === apiPort) webPort = await freePort();
      const env = { ...process.env, HOST: '127.0.0.1', API_HOST: '127.0.0.1', PORT: String(native ? webPort : apiPort), API_PORT: String(apiPort), PALBOX_DATA_DIR: directory, PALBOX_GAME_PORT: '8211' };
      for (const key of ['PALBOX_WEB_PORT', 'PALBOX_API_URL', 'PALBOX_SERVICE_USER']) delete env[key];
      const entry = native ? 'scripts/start.js' : 'backend/index.js';
      const child = spawn(process.execPath, [path.join(root, entry)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      const closed = once(child, 'close');
      let output = '';
      child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { output += value; });
      t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await closed; });
      const deadline = Date.now() + 5000;
      while (!output.includes('游戏管理已启动') && Date.now() < deadline && child.exitCode === null) await pause();
      assert.match(output, /游戏管理已启动/);
      const base = `http://127.0.0.1:${apiPort}`;
      async function request(route, { method = 'GET', body } = {}) {
        return fetch(base + '/api/' + route, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-Palbox-CSRF': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
      }
      let cookie = '', csrf = '';
      const credentials = { username: 'admin', password: 'test-configuration-ports-123' };
      assert.equal((await request('setup', { method: 'POST', body: credentials })).status, 201);
      const login = await request('login', { method: 'POST', body: credentials });
      assert.equal(login.status, 200);
      cookie = login.headers.get('set-cookie').split(';')[0]; csrf = (await login.json()).csrf;
      for (const [port, rejected] of [[native ? webPort : 8080, native], [apiPort, true]]) {
        const state = await (await request('workspace')).json();
        state.workspace.profiles[0].source = state.workspace.profiles[0].source.replace(/RESTAPIPort=\d+/, `RESTAPIPort=${port}`);
        const saved = await (await request('workspace', { method: 'PUT', body: state })).json();
        const submitted = await request('tasks', { method: 'POST', body: { action: 'apply', profileId: saved.workspace.activeId, revision: saved.revision } });
        assert.equal(submitted.status, 202);
        const task = await submitted.json();
        let result;
        const until = Date.now() + 3000;
        do {
          const state = await (await request('status?scope=local')).json();
          result = state.tasks.find(value => value.id === task.id);
          if (result?.state !== 'running') break;
          await pause();
        } while (Date.now() < until);
        assert.equal(result?.state, rejected ? 'failed' : 'succeeded', output);
        if (rejected) assert.match(result.message, /REST API 端口无效/);
      }
    });
  }
});
