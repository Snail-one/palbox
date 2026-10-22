import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { managementFixture } from '../helpers/management-fixture.js';

const reset = f => f.request('/api/tasks', { method: 'POST', body: { action: 'reset-save', confirmation: 'delete' } });

test('重置必须登录、通过 CSRF 且准确输入 delete，只清空 0 目录并保持停服', async t => {
  const f = await managementFixture(); t.after(() => f.close());
  assert.equal((await reset(f)).status, 401);
  await f.login();
  await f.manager.ensureConfig();
  const root = path.join(f.runtime.saved, 'SaveGames/0');
  for (const name of ['WORLD1/Level.sav', 'WORLD1/Players/player.sav', 'WORLD1/backup/world/history/Level.sav', 'WORLD2/Level.sav', '.hidden', 'loose-file']) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), name);
  }
  const config = path.join(f.runtime.saved, 'Config/LinuxServer/GameUserSettings.ini');
  await mkdir(path.dirname(config), { recursive: true }); await writeFile(config, 'DedicatedServerName=WORLD1\n');
  const banlist = path.join(f.runtime.saved, 'SaveGames/banlist.txt'); await writeFile(banlist, 'keep-ban');
  const archive = path.join(f.directory, 'backups/manual/keep.tar.gz'); await writeFile(archive, 'keep-archive');
  const workspace = await readFile(f.manager.store.file);
  assert.equal((await f.request('/api/tasks', { method: 'POST', headers: { 'X-Palbox-CSRF': 'invalid' }, body: { action: 'reset-save', confirmation: 'delete' } })).status, 403);
  for (const confirmation of [undefined, '', 'DELETE', 'delete ', ' delete', true, 1]) {
    const response = await f.request('/api/tasks', { method: 'POST', body: { action: 'reset-save', confirmation } });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /delete/);
  }
  assert.equal((await readdir(root)).length, 4);
  assert.equal(f.manager.tasks.length, 0);
  assert.equal((await reset(f)).status, 202); await f.manager.operation;
  assert.equal(f.manager.tasks[0].state, 'succeeded', f.manager.tasks[0].message);
  assert.equal(f.manager.tasks[0].removedEntries, 4);
  const resetBackup = f.manager.tasks[0].backup;
  assert.match(resetBackup, /^before-reset\//);
  assert.equal((await f.manager.backups()).filter(backup => backup.category === 'before-reset').length, 1);
  const archivedWorld = await f.runtime.run('tar', ['-xOzf', f.manager.backupFile(resetBackup), '--', 'WORLD1/Level.sav']);
  assert.equal(archivedWorld, 'WORLD1/Level.sav');
  const archivedPlayer = await f.runtime.run('tar', ['-xOzf', f.manager.backupFile(resetBackup), '--', 'WORLD1/Players/player.sav']);
  assert.equal(archivedPlayer, 'WORLD1/Players/player.sav');
  const archivedHistory = await f.runtime.run('tar', ['-xOzf', f.manager.backupFile(resetBackup), '--', 'WORLD1/backup/world/history/Level.sav']);
  assert.equal(archivedHistory, 'WORLD1/backup/world/history/Level.sav');
  assert.doesNotMatch(await f.runtime.run('tar', ['-tzf', f.manager.backupFile(resetBackup)]), /WORLD2|GameUserSettings|banlist|Pal\/Saved/);
  assert.equal((await stat(root)).isDirectory(), true);
  assert.deepEqual(await readdir(root), []);
  assert.equal(await readFile(config, 'utf8'), 'DedicatedServerName=WORLD1\n');
  assert.equal(await readFile(banlist, 'utf8'), 'keep-ban');
  assert.equal(await readFile(archive, 'utf8'), 'keep-archive');
  assert.deepEqual(await readFile(f.manager.store.file), workspace);
  assert.deepEqual(await readdir(path.dirname(archive)), ['keep.tar.gz']);
  assert.equal(f.runtime.game, null);
  assert.equal((await f.manager.status({ scope: 'local' })).hasWorldSave, false);
  assert.equal((await reset(f)).status, 202); await f.manager.operation;
  assert.equal(f.manager.tasks[0].removedEntries, 0);
  const restored = await f.task('restore', { id: resetBackup, mode: 'full' });
  assert.equal(restored.state, 'succeeded', restored.message);
  assert.equal(await readFile(path.join(root, 'WORLD1/Level.sav'), 'utf8'), 'WORLD1/Level.sav');
  assert.equal(f.runtime.game, null);
});

test('重置前世界备份失败时保留所有存档，不开始清空', async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  await f.manager.ensureConfig();
  const file = path.join(f.runtime.saved, 'SaveGames/0/WORLD/Level.sav');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, 'must-keep');
  const run = f.runtime.run.bind(f.runtime);
  f.runtime.run = async (command, args, ...rest) => {
    if (command === 'tar' && args[0] === '-czf') throw new Error('模拟备份磁盘写入失败');
    return run(command, args, ...rest);
  };
  const task = await f.task('reset-save', { confirmation: 'delete' });
  assert.equal(task.state, 'failed');
  assert.match(task.message, /备份磁盘写入失败/);
  assert.equal(task.removedEntries, undefined);
  assert.equal(await readFile(file, 'utf8'), 'must-keep');
  assert.deepEqual(await readdir(path.join(f.directory, 'backups/before-reset')), []);
  assert.deepEqual(await f.manager.backups(), []);
  assert.equal(f.runtime.game, null);
});

test('游戏运行时拒绝重置，不自动停止；停止后才能执行', async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  await f.task('install'); await f.task('start');
  const file = path.join(f.runtime.saved, 'SaveGames/0/WORLD/Level.sav');
  await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, 'keep-while-running');
  const game = f.runtime.game, count = f.manager.tasks.length;
  assert.equal((await reset(f)).status, 409);
  assert.equal(f.runtime.game, game);
  assert.equal(f.manager.tasks.length, count);
  assert.equal(await readFile(file, 'utf8'), 'keep-while-running');
  await f.task('stop');
  assert.equal((await reset(f)).status, 202); await f.manager.operation;
  assert.equal(f.manager.tasks[0].state, 'succeeded');
  assert.deepEqual(await readdir(path.dirname(path.dirname(file))), []);
  assert.equal(f.runtime.game, null);
});

test('重置使用任务锁，执行期间不能启动服务器或并发重置', async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const clear = f.manager.native.clearWorlds.bind(f.manager.native);
  f.manager.native.clearWorlds = async check => { await gate; return clear(check); };
  try {
    assert.equal((await reset(f)).status, 202);
    assert.equal(f.manager.busy.action, 'reset-save');
    assert.equal((await f.request('/api/tasks', { method: 'POST', body: { action: 'start' } })).status, 409);
    assert.equal((await reset(f)).status, 409);
  } finally { release(); await f.manager.operation; }
  assert.equal(f.manager.tasks[0].state, 'succeeded');
});
