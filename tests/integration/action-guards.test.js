import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, stat, utimes } from 'node:fs/promises';
import path from 'node:path';
import { managementFixture } from '../helpers/management-fixture.js';
import { nativeBackupFixture } from '../helpers/native-backup-fixture.js';

test('安装和更新 API 根据真实安装状态执行，重复安装不写文件或启动游戏', async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  let installs = 0;
  const install = f.runtime.install.bind(f.runtime);
  f.runtime.install = async (...args) => { installs++; return install(...args); };
  const missing = await f.task('update');
  assert.equal(missing.state, 'failed');
  assert.match(missing.message, /请先安装/);
  assert.equal(installs, 0);
  assert.equal((await f.task('install')).state, 'succeeded');
  const launcher = path.join(f.runtime.server, 'PalServer.sh');
  const before = await stat(launcher, { bigint: true });
  for (const running of [false, true]) {
    if (running) assert.equal((await f.task('start')).state, 'succeeded');
    const game = f.runtime.game;
    const task = await f.task('install', { start: true });
    assert.equal(task.state, 'succeeded');
    assert.equal(task.noChanges, true);
    assert.equal(task.message, '服务端已安装，无需重复安装。');
    assert.equal(f.runtime.game, game);
    assert.equal(installs, 1);
    assert.equal((await stat(launcher, { bigint: true })).mtimeNs, before.mtimeNs);
  }
  await f.task('stop');
  assert.equal((await f.task('update')).state, 'succeeded');
  assert.equal(installs, 2, '已安装后仍可执行更新和文件校验');
});

test('重复封禁 API 不再请求游戏，保留原理由，解封后仍可重新封禁', async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  await f.task('install'); await f.task('start');
  let bans = 0;
  const rest = f.runtime.rest.bind(f.runtime);
  f.runtime.rest = async (endpoint, ...args) => { if (endpoint === 'ban') bans++; return rest(endpoint, ...args); };
  const payload = { userid: 'steam_test', name: '玩家', message: '原始理由' };
  assert.equal((await f.task('ban', payload)).state, 'succeeded');
  const original = (await f.manager.bannedPlayers()).players[0];
  // Simulate a game version which persists its ban list only at shutdown.
  const file = path.join(f.runtime.saved, 'SaveGames/banlist.txt');
  await writeFile(file, ''); await utimes(file, new Date(0), new Date(0));
  const repeated = await f.task('ban', { ...payload, userid: 'steam_test,PLAYER', message: '重复理由' });
  assert.equal(repeated.state, 'succeeded');
  assert.equal(repeated.noChanges, true);
  assert.equal(repeated.message, '玩家已封禁，无需重复封禁。');
  assert.equal(bans, 1);
  assert.deepEqual((await f.manager.bannedPlayers()).players[0], original);
  for (let repeat = 0; repeat < 41; repeat++) assert.equal((await f.task('ban', payload)).noChanges, true);
  assert.equal(bans, 1, '任务记录轮换后仍不重复请求游戏');
  assert.deepEqual((await f.manager.bannedPlayers()).players[0], original);
  assert.equal((await f.task('unban', { userid: payload.userid })).state, 'succeeded');
  assert.equal((await f.task('ban', payload)).state, 'succeeded');
  assert.equal(bans, 2);
  await writeFile(file, 'steam_external\n');
  const external = await f.task('ban', { userid: 'steam_external' });
  assert.equal(external.noChanges, true, '游戏文件中已有的封禁也跳过');
  assert.equal(bans, 2);
});

test('三种恢复 API 均要求有效目标 ID，缺失时不创建任务或消耗上传，过期目标不覆盖存档', async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login(); await f.task('install');
  const world = await nativeBackupFixture(f.runtime.saved, { worldId: 'CURRENT' });
  const backup = await f.manager.backup('manual');
  const upload = await f.upload('/api/save-import', await readFile(f.manager.backupFile(backup)));
  assert.equal(upload.status, 201);
  const staged = await upload.json();
  const config = await readFile(f.runtime.config);
  const count = f.manager.tasks.length;
  const ids = { restore: backup, 'restore-native': world.id, 'import-save': staged.id };
  for (const [action, id] of Object.entries(ids)) {
    for (const target of [{}, { targetWorldId: '' }, { targetWorldId: '../CURRENT' }, { targetWorldId: 1 }, { targetWorldId: {} }, { targetWorldId: [] }]) {
      const response = await f.request('/api/tasks', { method: 'POST', body: { action, id, ...target } });
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /目标世界 ID/);
      assert.equal(f.manager.tasks.length, count);
    }
    await assert.rejects(f.manager.execute(action, { id }, {}), { status: 400 });
  }
  assert.ok(await f.manager.imports.get(staged.id), '缺失目标时上传仍可重新检测');
  for (const [action, id] of Object.entries(ids)) {
    const task = await f.task(action, { id, targetWorldId: 'STALE' });
    assert.equal(task.state, 'failed');
    assert.match(task.message, /恢复目标已改变/);
    assert.deepEqual(await readFile(f.runtime.config), config);
    assert.equal(await readFile(path.join(world.world, 'Level.sav'), 'utf8'), 'current-world');
    assert.equal((await f.manager.backups()).filter(item => item.category !== 'manual').length, 0);
  }
  const configOnly = await f.manager.backup('before-import', null, { configurationOnly: true });
  const restored = await f.task('restore', { id: configOnly, targetWorldId: null });
  assert.equal(restored.state, 'succeeded', restored.message);
});
