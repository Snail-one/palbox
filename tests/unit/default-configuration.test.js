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
import { createProfile, createWorkspace, DERIVED_DEFAULT_ORIGIN, GAME_DEFAULT_PROFILE_NAME, OFFICIAL_DEFAULT_ORIGIN } from '../../shared/domain/workspace.js';

const official = '; Official defaults\r\n[/Script/Pal.PalGameWorldSettings]\r\nOptionSettings=(ServerName="Official World",ExpRate=2.500000,FutureFlag=(Enabled=True),RESTAPIEnabled=False,AdminPassword="",PublicPort=8211)\r\n';
const values = source => new Map(parse(source).entries.map(entry => [entry.key, entry.raw]));
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-default-config-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'server/DefaultPalWorldSettings.ini');
  await mkdir(path.dirname(file), { recursive: true });
  return { directory, file };
}

test('导入的配置合并进游戏默认配置，缺项沿用官方默认，REST 保持开启且不采用导入密码', async t => {
  const { directory, file } = await fixture(t);
  await writeFile(file, official);
  const store = new ManagementStore(directory, 9000);
  await store.initialize();
  const baseline = store.active().initialSource;
  const password = values(baseline).get('AdminPassword');
  const merged = await store.applyImportedConfig('[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ExpRate=9.000000,ExtraRate=3)\n');
  const settings = values(merged);
  assert.equal(settings.get('ExpRate'), '9.000000');
  assert.equal(settings.get('ExtraRate'), '3');
  assert.equal(settings.get('ServerName'), '"Official World"');
  assert.equal(settings.get('RESTAPIEnabled'), 'True');
  assert.equal(settings.get('PublicPort'), '9000');
  assert.equal(settings.get('AdminPassword'), password);
  assert.equal(store.active().locked, true);
  assert.equal(store.active().source, merged);
  assert.equal(store.active().initialSource, baseline);
  const replaced = await store.applyImportedConfig('[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(RESTAPIEnabled=False,AdminPassword="imported-secret",ExpRate=4.000000,PublicPort=8211)\n');
  assert.equal(values(replaced).get('AdminPassword'), password);
  assert.notEqual(values(replaced).get('AdminPassword'), '"imported-secret"');
  assert.equal(values(replaced).get('ExpRate'), '4.000000');
  assert.equal(values(replaced).get('ServerName'), '"Official World"');
  assert.equal(values(replaced).get('RESTAPIEnabled'), 'True');
  assert.equal(values(replaced).get('PublicPort'), '8211');
});

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
  const locked = store.workspace.profiles.find(profile => profile.locked);
  assert.ok(locked);
  assert.equal(locked.name, GAME_DEFAULT_PROFILE_NAME);
  assert.equal(locked.origin, OFFICIAL_DEFAULT_ORIGIN);
  const lockedSettings = values(locked.source);
  assert.equal(lockedSettings.get('ServerName'), '"Official World"');
  assert.equal(lockedSettings.get('RESTAPIEnabled'), 'True');
  assert.equal(lockedSettings.get('PublicPort'), '9000');
  assert.ok(decodeString(lockedSettings.get('AdminPassword')), '默认项自动生成管理员密码');
  const lockedPassword = decodeString(lockedSettings.get('AdminPassword'));
  assert.equal(store.active().id, locked.id);
  assert.equal(store.workspace.profiles.length, 1);
  const changed = official.replace('ExpRate=2.500000', 'ExpRate=8.000000');
  await writeFile(file, changed);
  assert.equal(values(await store.defaultTemplate()).get('ExpRate'), '8.000000', '新建时读取当前官方文件');
  const restarted = new ManagementStore(directory, 9000);
  await restarted.initialize();
  assert.equal(restarted.workspace.profiles.length, 1);
  const restartedLocked = restarted.workspace.profiles.find(profile => profile.locked);
  assert.equal(values(restartedLocked.source).get('ExpRate'), '8.000000', '只读默认项跟随官方文件更新');
  assert.equal(decodeString(values(restartedLocked.source).get('AdminPassword')), lockedPassword, '密码跨同步保留');
  assert.equal(restartedLocked.source, restartedLocked.initialSource);
});

test('首次部署没有配置或占位项，检测到官方文件后只有一个默认条目', async t => {
  const { directory, file } = await fixture(t);
  const store = new ManagementStore(directory);
  await store.initialize();
  assert.deepEqual(store.workspace, { version: 1, activeId: null, profiles: [] });
  assert.deepEqual(JSON.parse(await readFile(store.file, 'utf8')).workspace.profiles, []);
  await assert.rejects(store.defaultTemplate(), { status: 409 });
  const restarted = new ManagementStore(directory);
  await restarted.initialize();
  assert.deepEqual(restarted.workspace, store.workspace);
  await writeFile(file, official);
  assert.equal(await restarted.syncDefaultProfile(), true);
  assert.equal(restarted.workspace.profiles.length, 1);
  assert.equal(restarted.active().name, GAME_DEFAULT_PROFILE_NAME);
  assert.equal(restarted.active().source, restarted.active().initialSource);
  assert.equal(values(restarted.active().source).get('ServerName'), '"Official World"');
  assert.equal(await restarted.syncDefaultProfile(), false);
});

test('未安装时允许手动新建，检测到官方配置后保留手动配置和当前选择', async t => {
  const { directory, file } = await fixture(t);
  const store = new ManagementStore(directory);
  await store.initialize();
  const template = await store.newConfigurationTemplate();
  assert.equal(template.origin, '手动创建的配置');
  assert.deepEqual([...values(template.source).keys()], ['RESTAPIEnabled', 'AdminPassword', 'PublicPort']);
  assert.equal(store.workspace.profiles.length, 0, '获取新建内容不会创建配置');
  const profile = createProfile('手动世界', template.source, { origin: template.origin });
  await store.update(createWorkspace(profile), store.revision);
  await writeFile(file, official);
  await store.syncDefaultProfile();
  assert.equal(store.workspace.profiles.length, 2);
  assert.equal(store.active().id, profile.id);
  const locked = store.workspace.profiles.find(entry => entry.locked);
  const activeValues = values(store.active().source);
  assert.equal(activeValues.get('ServerName'), '"Official World"');
  assert.equal(activeValues.get('RESTAPIEnabled'), 'True');
  assert.equal(decodeString(activeValues.get('AdminPassword')), decodeString(values(template.source).get('AdminPassword')));
  assert.equal(store.active().initialSource, locked.initialSource);
  assert.equal((await store.newConfigurationTemplate()).source, locked.initialSource);
  assert.equal((await store.newConfigurationTemplate()).origin, DERIVED_DEFAULT_ORIGIN);
  assert.equal(await store.syncDefaultProfile(), false);
});

test('其他配置以官方默认为底，未修改的跟随文件，已修改的保留参数', async t => {
  const { directory, file } = await fixture(t);
  await writeFile(file, official);
  const store = new ManagementStore(directory, 9000);
  await store.initialize();
  const managed = store.workspace.profiles.find(profile => profile.locked).initialSource;
  const follower = createProfile('跟随文件', managed, { origin: DERIVED_DEFAULT_ORIGIN });
  const edited = createProfile('已修改', managed.replace('ExpRate=2.500000', 'ExpRate=4.000000'), { origin: DERIVED_DEFAULT_ORIGIN });
  const snapshot = store.snapshot();
  snapshot.workspace.profiles.push(follower, edited);
  await store.update(snapshot.workspace, snapshot.revision);
  assert.equal(store.workspace.profiles.find(profile => profile.id === follower.id).initialSource, managed);
  assert.equal(store.workspace.profiles.find(profile => profile.id === edited.id).initialSource, managed);
  const changed = official.replace('ExpRate=2.500000', 'ExpRate=7.000000').replace('ServerName="Official World"', 'ServerName="Next World"');
  await writeFile(file, changed);
  await store.syncDefaultProfile();
  const nextManaged = store.workspace.profiles.find(profile => profile.locked).initialSource;
  const followed = store.workspace.profiles.find(profile => profile.id === follower.id);
  const kept = store.workspace.profiles.find(profile => profile.id === edited.id);
  assert.equal(followed.source, nextManaged);
  assert.equal(followed.initialSource, nextManaged);
  assert.equal(values(followed.source).get('ExpRate'), '7.000000');
  assert.equal(values(kept.source).get('ExpRate'), '4.000000');
  assert.equal(values(kept.source).get('ServerName'), '"Next World"');
  assert.equal(kept.initialSource, nextManaged);
  assert.equal(await store.syncDefaultProfile(), false);
});

test('已有游戏配置仍被保留，不被官方配置覆盖', async t => {
  const { directory, file } = await fixture(t);
  const config = path.join(directory, 'server/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini');
  await mkdir(path.dirname(config), { recursive: true });
  await writeFile(config, 'OptionSettings=(ServerName="Existing Server")');
  await writeFile(file, official);
  const store = new ManagementStore(directory);
  await store.initialize();
  const activeValues = values(store.active().source);
  assert.equal(activeValues.get('ServerName'), '"Existing Server"');
  assert.equal(activeValues.get('ExpRate'), '2.500000');
  assert.equal(activeValues.get('RESTAPIEnabled'), 'True');
  assert.equal(store.active().initialSource, store.workspace.profiles.find(entry => entry.locked).initialSource);
  assert.equal(store.workspace.profiles.length, 2);
  assert.equal(await store.syncDefaultProfile(), false);
});

test('旧占位配置只在未编辑时移除，已编辑配置保留', async t => {
  const { directory } = await fixture(t);
  const source = 'OptionSettings=(RESTAPIEnabled=True,AdminPassword="old")';
  for (const edited of [false, true]) {
    const profile = createProfile('我的帕鲁世界', edited ? source.replace('old', 'edited') : source, { id: () => 'old' });
    const store = new ManagementStore(directory);
    await mkdir(path.dirname(store.file), { recursive: true });
    await writeFile(store.file, JSON.stringify({ workspace: createWorkspace(profile), revision: 1, pendingDefault: { id: 'old', source } }));
    await store.initialize();
    assert.equal(store.workspace.profiles.length, edited ? 1 : 0);
    assert.equal(JSON.parse(await readFile(store.file, 'utf8')).pendingDefault, undefined);
  }
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
  assert.equal((await request('/api/configuration-template')).status, 401);
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
  const manualTemplate = await request('/api/configuration-template', { cookie });
  assert.equal(manualTemplate.status, 200);
  assert.equal(manualTemplate.body.origin, '手动创建的配置');
  assert.equal((await request('/api/workspace', { cookie })).body.workspace.activeId, manager.store.active().id);
});

test('游戏默认配置可修改参数并应用，但名称和来源由服务端维护', async t => {
  const { directory, file } = await fixture(t);
  await writeFile(file, official);
  const store = new ManagementStore(directory, 9000);
  await store.initialize();
  const working = createProfile('手动世界', await store.defaultTemplate());
  const workingSnapshot = store.snapshot();
  workingSnapshot.workspace.profiles.push(working);
  workingSnapshot.workspace.activeId = working.id;
  await store.update(workingSnapshot.workspace, workingSnapshot.revision);
  const workingId = working.id;
  const initialLocked = store.workspace.profiles.find(profile => profile.locked);
  const lockedId = initialLocked.id;
  const initialBaseline = initialLocked.initialSource;
  const generatedPassword = decodeString(values(initialLocked.source).get('AdminPassword'));
  const editedSource = 'OptionSettings=(ServerName="Edited Default",ExpRate=5)';

  // Parameter edits are accepted; identity fields and the restore baseline stay canonical.
  let snapshot = store.snapshot();
  const target = snapshot.workspace.profiles.find(profile => profile.id === lockedId);
  target.source = editedSource;
  target.name = '篡改的默认配置';
  target.origin = '伪造来源';
  target.initialSource = 'OptionSettings=(Wrong=1)';
  await store.update(snapshot.workspace, snapshot.revision);
  let current = store.snapshot().workspace;
  let kept = current.profiles.find(profile => profile.id === lockedId);
  assert.equal(kept.source, editedSource);
  assert.equal(kept.name, GAME_DEFAULT_PROFILE_NAME);
  assert.equal(kept.origin, OFFICIAL_DEFAULT_ORIGIN);
  assert.equal(kept.locked, true);
  assert.equal(kept.initialSource, initialBaseline);
  assert.equal(current.activeId, workingId);

  // Removal is still corrected and the edited working source is retained.
  snapshot = store.snapshot();
  snapshot.workspace.profiles = snapshot.workspace.profiles.filter(profile => profile.id !== lockedId);
  await store.update(snapshot.workspace, snapshot.revision);
  current = store.snapshot().workspace;
  kept = current.profiles.find(profile => profile.id === lockedId);
  assert.ok(kept);
  assert.equal(kept.source, editedSource);

  // A file refresh moves the restore baseline but does not overwrite edits.
  const changed = official.replace('ExpRate=2.500000', 'ExpRate=7.000000');
  await writeFile(file, changed);
  await store.syncDefaultProfile();
  kept = store.snapshot().workspace.profiles.find(profile => profile.id === lockedId);
  assert.equal(values(kept.source).get('ServerName'), '"Edited Default"');
  assert.equal(values(kept.source).get('RESTAPIEnabled'), 'True');
  assert.equal(decodeString(values(kept.source).get('AdminPassword')), generatedPassword);
  assert.equal(values(kept.initialSource).get('ExpRate'), '7.000000');
  assert.equal(values(kept.initialSource).get('RESTAPIEnabled'), 'True');
  assert.equal(decodeString(values(kept.initialSource).get('AdminPassword')), generatedPassword);

  // Resetting to the managed baseline makes the entry follow later file updates again.
  snapshot = store.snapshot();
  const baseline = store.snapshot().workspace.profiles.find(profile => profile.id === lockedId).initialSource;
  snapshot.workspace.profiles.find(profile => profile.id === lockedId).source = baseline;
  await store.update(snapshot.workspace, snapshot.revision);
  const nextFile = changed.replace('ExpRate=7.000000', 'ExpRate=9.000000');
  await writeFile(file, nextFile);
  await store.syncDefaultProfile();
  kept = store.snapshot().workspace.profiles.find(profile => profile.id === lockedId);
  assert.equal(kept.source, kept.initialSource);
  assert.equal(values(kept.source).get('ExpRate'), '9.000000');
  assert.equal(decodeString(values(kept.source).get('AdminPassword')), generatedPassword);

  // The default entry can be selected and therefore applied by the manager.
  snapshot = store.snapshot();
  snapshot.workspace.activeId = lockedId;
  await store.update(snapshot.workspace, snapshot.revision);
  assert.equal(store.snapshot().workspace.activeId, lockedId);
  assert.equal(store.active().locked, true);

  // Other profiles cannot claim locked/official identity.
  snapshot = store.snapshot();
  const fake = structuredClone(snapshot.workspace.profiles.find(profile => profile.id === workingId));
  fake.id = 'fake-locked'; fake.name = '伪只读'; fake.locked = true; fake.origin = OFFICIAL_DEFAULT_ORIGIN;
  snapshot.workspace.profiles.push(fake);
  await store.update(snapshot.workspace, snapshot.revision);
  const savedFake = store.snapshot().workspace.profiles.find(profile => profile.id === 'fake-locked');
  assert.equal(savedFake.locked, undefined);
  assert.equal(savedFake.origin, DERIVED_DEFAULT_ORIGIN);
});

test('旧版官方来源配置迁移为可编辑副本，并自动补充只读默认项', async t => {
  const { directory, file } = await fixture(t);
  await writeFile(file, official);
  const legacy = {
    version: 1,
    activeId: 'legacy',
    profiles: [{
      id: 'legacy', name: '旧配置', source: 'OptionSettings=(ExpRate=2)',
      initialSource: 'OptionSettings=(ExpRate=2)', updatedAt: '2026-01-01T00:00:00Z',
      origin: OFFICIAL_DEFAULT_ORIGIN
    }]
  };
  await mkdir(path.join(directory, 'palbox'), { recursive: true });
  await writeFile(path.join(directory, 'palbox/workspace.json'), JSON.stringify({ workspace: legacy, revision: 4 }));
  const store = new ManagementStore(directory);
  await store.initialize();
  const profile = store.workspace.profiles.find(candidate => candidate.id === 'legacy');
  assert.equal(profile.origin, DERIVED_DEFAULT_ORIGIN);
  assert.equal(profile.locked, undefined);
  assert.equal(store.active().id, 'legacy');
  const locked = store.workspace.profiles.find(candidate => candidate.locked);
  assert.ok(locked);
  const lockedSettings = values(locked.source);
  assert.equal(lockedSettings.get('ServerName'), '"Official World"');
  assert.equal(lockedSettings.get('RESTAPIEnabled'), 'True');
  assert.ok(decodeString(lockedSettings.get('AdminPassword')));
  assert.equal(locked.origin, OFFICIAL_DEFAULT_ORIGIN);
});

test('空配置库仍可查询服务状态，拒绝写入或应用空配置，状态轮询能检测官方文件', async t => {
  const { directory, file } = await fixture(t);
  const manager = new Manager({ directory });
  await manager.initialize();
  t.after(() => manager.close());
  assert.equal((await manager.status()).hasConfiguration, false);
  await assert.rejects(manager.ensureConfig(), { status: 409, message: /尚无可用配置/ });
  await assert.rejects(manager.execute('apply', { revision: manager.store.revision, profileId: null }), { status: 409, message: /尚无可用配置/ });
  await assert.rejects(readFile(manager.runtime.config), { code: 'ENOENT' });
  await writeFile(file, official);
  assert.equal((await manager.status()).hasConfiguration, true);
  assert.equal(manager.store.workspace.profiles.length, 1);
});
