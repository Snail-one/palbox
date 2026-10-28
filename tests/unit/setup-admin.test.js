import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { Manager } from '../../backend/management/manager.js';
import { createManagementApi } from '../../backend/management/api.js';
import { newSecret } from '../../backend/management/totp.js';

const original = { username: 'original-admin', password: 'original-test-password-123' };
const replacement = { username: 'replacement-admin', password: 'replacement-test-password-456' };

async function instances(t, count = 2) {
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-setup-'));
  const managers = [];
  t.after(async () => {
    for (const manager of managers) await manager.close();
    await rm(directory, { recursive: true, force: true });
  });
  for (let index = 0; index < count; index++) {
    const manager = new Manager({ directory });
    managers.push(manager);
    await manager.initialize();
  }
  return managers;
}

async function post(api, route, input) {
  const request = new PassThrough();
  request.method = 'POST';
  request.headers = { host: 'localhost', 'content-type': 'application/json' };
  request.socket = { remoteAddress: '127.0.0.1' };
  const output = { headers: {} };
  const response = {
    setHeader(name, value) { output.headers[name] = value; },
    writeHead(status, headers) { output.status = status; Object.assign(output.headers, headers); },
    end(value) { output.body = JSON.parse(value); }
  };
  request.end(JSON.stringify(input));
  await api(request, response, route);
  return output;
}

test('启动时未初始化的另一实例不能覆盖管理员，同步原账号并保留二次验证', async t => {
  const [first, stale] = await instances(t);
  const firstApi = createManagementApi(first), staleApi = createManagementApi(stale);
  assert.equal((await post(firstApi, '/api/setup', original)).status, 201);
  await first.updateAdmin(admin => ({ ...admin, totp: { secret: newSecret(), lastCounter: -1, recoveryHashes: [] } }));
  const before = await readFile(first.settingsFile, 'utf8');

  const rejected = await post(staleApi, '/api/setup', replacement);
  assert.equal(rejected.status, 409);
  assert.equal(rejected.headers['Set-Cookie'], undefined);
  assert.equal(stale.needsSetup(), false);
  assert.deepEqual(stale.settings, first.settings);
  const login = await post(staleApi, '/api/login', original);
  assert.equal(login.status, 200);
  assert.equal(login.body.totpRequired, true);
  assert.equal(login.headers['Set-Cookie'], undefined);
  assert.equal((await post(staleApi, '/api/login', replacement)).status, 401);
  assert.equal((await post(staleApi, '/api/setup', replacement)).status, 409);
  assert.equal(await readFile(first.settingsFile, 'utf8'), before);
});

test('独立实例同时注册只有一次成功，两边均使用胜出的管理员账号', async t => {
  const managers = await instances(t);
  const apis = managers.map(manager => createManagementApi(manager));
  const credentials = [original, replacement];
  const results = await Promise.all(apis.map((api, index) => post(api, '/api/setup', credentials[index])));
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  const winner = results.findIndex(result => result.status === 201);
  const before = await readFile(managers[0].settingsFile, 'utf8');
  for (const [index, api] of apis.entries()) {
    assert.equal(managers[index].needsSetup(), false);
    assert.deepEqual(managers[index].settings.admin, JSON.parse(before).admin);
    assert.equal((await post(api, '/api/login', credentials[winner])).status, 200);
    assert.equal((await post(api, '/api/login', credentials[1 - winner])).status, 401);
    assert.equal((await post(api, '/api/setup', credentials[1 - winner])).status, 409);
  }
  assert.equal(await readFile(managers[0].settingsFile, 'utf8'), before);
});

test('启动后出现损坏配置时，首次注册失败也不能覆盖该文件', async t => {
  const [manager] = await instances(t, 1);
  const api = createManagementApi(manager);
  for (const content of ['{', 'null', '{}']) {
    await writeFile(manager.settingsFile, content);
    assert.equal((await post(api, '/api/setup', replacement)).status, 500);
    assert.equal(await readFile(manager.settingsFile, 'utf8'), content);
    assert.equal(manager.settings, null);
    assert.equal(manager.setupPending, false);
  }
});
