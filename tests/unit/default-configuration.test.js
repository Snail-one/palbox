import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { ManagementStore } from '../../backend/management/store.js';
import { Manager } from '../../backend/management/manager.js';
import { createManagementApi } from '../../backend/management/api.js';
import { parse, decodeString } from '../../shared/domain/config.js';

const official = '; Official defaults\r\n[/Script/Pal.PalGameWorldSettings]\r\nOptionSettings=(ServerName="Official World",ExpRate=2.500000,FutureFlag=(Enabled=True),RESTAPIEnabled=False,AdminPassword="",PublicPort=8211)\r\n';
const values = source => new Map(parse(source).entries.map(entry => [entry.key, entry.raw]));
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-default-config-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'server/DefaultPalWorldSettings.ini');
  await mkdir(path.dirname(file), { recursive: true });
  return { directory, file };
}

test('初始默认配置读取游戏官方文件，保留注释、未知参数和数值，只设置管理必需项', async t => {
  const { directory, file } = await fixture(t);
  await writeFile(file, official);
  const store = new ManagementStore(directory, 9000);
  await store.initialize();
  const source = store.active().source;
  const settings = values(source);
  assert.equal(settings.get('ServerName'), '"Official World"');
  assert.equal(settings.get('ExpRate'), '2.500000');
  assert.equal(settings.get('FutureFlag'), '(Enabled=True)');
  assert.equal(settings.get('RESTAPIEnabled'), 'True');
  assert.equal(settings.get('PublicPort'), '9000');
  assert.ok(decodeString(settings.get('AdminPassword')));
  assert.ok(source.startsWith('; Official defaults\r\n'));
  assert.equal(settings.size, values(official).size, '不能混入内置模板中的游戏参数');
  assert.equal(store.active().initialSource, source);
  await writeFile(file, official.replace('ExpRate=2.500000', 'ExpRate=8.000000'));
  assert.equal(values(await store.defaultTemplate()).get('ExpRate'), '8.000000', '新建时读取当前官方文件');
  const restarted = new ManagementStore(directory, 9000);
  await restarted.initialize();
  assert.equal(restarted.active().source, source, '更新官方文件不覆盖已经保存的配置');
});

test('未安装时只建立管理占位配置，安装后导入官方文件并更新恢复基准', async t => {
  const { directory, file } = await fixture(t);
  const store = new ManagementStore(directory);
  await store.initialize();
  assert.deepEqual([...values(store.active().source).keys()], ['RESTAPIEnabled', 'AdminPassword', 'PublicPort']);
  await assert.rejects(store.defaultTemplate(), { status: 409, message: /DefaultPalWorldSettings\.ini/ });
  assert.equal(await store.defaultTemplate({ optional: true }), null);
  const id = store.active().id;
  const revision = store.revision;
  await writeFile(file, official);
  const restarted = new ManagementStore(directory);
  await restarted.initialize();
  assert.equal(await restarted.importDefaultIfPending(), true);
  assert.equal(restarted.active().id, id);
  assert.equal(restarted.revision, revision + 1);
  assert.equal(values(restarted.active().source).get('ServerName'), '"Official World"');
  assert.equal(restarted.active().initialSource, restarted.active().source);
  assert.equal(await restarted.importDefaultIfPending(), false);
  assert.equal(JSON.parse(await readFile(restarted.file, 'utf8')).pendingDefault, undefined);
});

test('安装前已修改的配置和现有游戏配置不会被默认文件覆盖', async t => {
  const { directory, file } = await fixture(t);
  const store = new ManagementStore(directory);
  await store.initialize();
  const snapshot = store.snapshot();
  snapshot.workspace.profiles[0].source = 'OptionSettings=(ServerName="My World")';
  await store.update(snapshot.workspace, snapshot.revision);
  await writeFile(file, official);
  assert.equal(await store.importDefaultIfPending(), false);
  assert.equal(store.active().source, 'OptionSettings=(ServerName="My World")');
  await rm(store.file);
  const config = path.join(directory, 'server/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini');
  await mkdir(path.dirname(config), { recursive: true });
  await writeFile(config, 'OptionSettings=(ServerName="Existing Server")');
  const existing = new ManagementStore(directory);
  await existing.initialize();
  assert.equal(existing.active().source, 'OptionSettings=(ServerName="Existing Server")');
  assert.equal(await existing.importDefaultIfPending(), false);
});

test('默认文件缺少管理参数时补齐，空文件或损坏内容明确拒绝', async t => {
  const { directory, file } = await fixture(t);
  const store = new ManagementStore(directory, 9001);
  await writeFile(file, 'OptionSettings=(ServerName="Minimal",Future="keep")');
  const settings = values(await store.defaultTemplate());
  assert.equal(settings.get('ServerName'), '"Minimal"');
  assert.equal(settings.get('Future'), '"keep"');
  assert.equal(settings.get('RESTAPIEnabled'), 'True');
  assert.equal(settings.get('PublicPort'), '9001');
  assert.ok(decodeString(settings.get('AdminPassword')));
  for (const source of ['', '; empty', 'OptionSettings=()', 'OptionSettings=(ServerName="broken)']) {
    await writeFile(file, source);
    await assert.rejects(store.defaultTemplate(), { status: 409, message: /内容无效/ });
  }
});

test('安装任务使用刚安装的官方默认配置生成游戏配置文件', async t => {
  const { directory, file } = await fixture(t);
  const manager = new Manager({ directory });
  await manager.initialize();
  t.after(() => manager.close());
  manager.runtime.install = async () => writeFile(file, official);
  await manager.submit('install');
  await manager.operation;
  assert.equal(manager.tasks[0].state, 'succeeded', manager.tasks[0].message);
  assert.equal(manager.tasks[0].defaultsImported, true);
  const installed = values(await readFile(manager.runtime.config, 'utf8'));
  assert.equal(installed.get('ServerName'), '"Official World"');
  assert.equal(installed.get('FutureFlag'), '(Enabled=True)');
});

test('默认配置接口要求登录，文件缺失时返回明确错误且现有工作空间仍可加载', async t => {
  const { directory, file } = await fixture(t);
  await writeFile(file, official);
  const manager = new Manager({ directory });
  await manager.initialize();
  t.after(() => manager.close());
  await manager.setupAdmin('admin', 'test-default-configuration-password');
  const api = createManagementApi(manager);
  async function request(route, { method = 'GET', body, cookie } = {}) {
    const input = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    input.method = method;
    input.headers = { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) };
    input.socket = { remoteAddress: '127.0.0.1' };
    const response = {
      headersSent: false, headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); this.headersSent = true; },
      end(value) { this.body = JSON.parse(value); }
    };
    await api(input, response, route);
    return response;
  }
  assert.equal((await request('/api/default-configuration')).status, 401);
  assert.equal((await request('/api/bootstrap')).body.template, undefined);
  const login = await request('/api/login', { method: 'POST', body: { username: 'admin', password: 'test-default-configuration-password' } });
  assert.equal(login.status, 200);
  const cookie = login.headers['Set-Cookie'].split(';')[0];
  const defaults = await request('/api/default-configuration', { cookie });
  assert.equal(defaults.status, 200);
  assert.equal(values(defaults.body.source).get('ServerName'), '"Official World"');
  const bootstrap = await request('/api/bootstrap', { cookie });
  assert.equal(values(bootstrap.body.template).get('FutureFlag'), '(Enabled=True)');
  await rm(file);
  const missing = await request('/api/default-configuration', { cookie });
  assert.equal(missing.status, 409);
  assert.match(missing.body.error, /DefaultPalWorldSettings\.ini/);
  const available = await request('/api/bootstrap', { cookie });
  assert.equal(available.status, 200);
  assert.equal(available.body.template, null);
  assert.equal((await request('/api/workspace', { cookie })).body.workspace.activeId, manager.store.active().id);
});
