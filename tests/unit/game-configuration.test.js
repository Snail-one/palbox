import { tmpdir } from 'node:os';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { Runtime } from '../../backend/management/runtime.js';
import { validateManagedConfiguration } from '../../backend/management/game-configuration.js';

const source = port => `OptionSettings=(RESTAPIEnabled=True,AdminPassword="secret",RESTAPIPort=${port})`;
const options = { gamePort: 8211, reservedPorts: [8090, 8091] };

test('管理配置校验拒绝无效、游戏或面板占用的 REST 端口', () => {
  for (const port of ['-1', '0', '65536', '1.5', 'True', '"8212"', '', '8211', '8090', '8091']) {
    assert.throws(() => validateManagedConfiguration(source(port), options), { status: 400, message: 'REST API 端口无效或与现有服务端口冲突。' });
  }
  assert.deepEqual(validateManagedConfiguration(source('8212'), options), { port: 8212, password: 'secret' });
  assert.deepEqual(validateManagedConfiguration(source('65535'), options), { port: 65535, password: 'secret' });
  assert.deepEqual(validateManagedConfiguration('OptionSettings=(RESTAPIEnabled=True,AdminPassword="secret")', options), { port: 8212, password: 'secret' });
});

test('管理配置校验要求可用凭据，并允许独立容器复用前端端口', () => {
  assert.throws(() => validateManagedConfiguration(source('8212').replace('True', 'False')), { status: 400 });
  assert.throws(() => validateManagedConfiguration(source('8212').replace('"secret"', '""')), { status: 400 });
  assert.throws(() => validateManagedConfiguration('not an ini'), { status: 400 });
  assert.equal(validateManagedConfiguration(source('8080'), { reservedPorts: [8081] }).port, 8080);
});

test('磁盘配置的 REST 端口无效时，启动前拒绝且不创建游戏进程', async t => {
  const directory = await mkdtemp(tmpdir() + '/palbox-configuration-');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runtime = new Runtime(directory);
  runtime.config = directory + '/config.ini';
  runtime.installed = async () => true;
  for (const port of ['-1', '8211', '8090']) {
    runtime.reservedPorts = options.reservedPorts;
    await writeFile(runtime.config, source(port));
    await assert.rejects(runtime.start(), /REST API 端口无效/);
    assert.equal(runtime.game, null);
    await assert.rejects(runtime.rest('info'), /REST API 端口无效/);
  }
});
