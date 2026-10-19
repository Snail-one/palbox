import { test } from 'node:test';
import { BACKUP_CATEGORIES } from '../../backend/management/backup-paths.js';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm, readdir, symlink, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { managementFixture } from '../helpers/management-fixture.js';
import { nativeBackupFixture } from '../helpers/native-backup-fixture.js';
import { Manager } from '../../backend/management/manager.js';

test('官方备份在线查看和下载不停止游戏，下载包包含世界和玩家数据', async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  await f.task('install');
  const backup = await nativeBackupFixture(f.runtime.saved);
  await f.task('start');
  const pid = f.runtime.game.pid;
  const tasks = f.manager.tasks.length;
  const response = await f.request('/api/native-backups');
  const result = await response.json();
  assert.equal(result.enabled, true);
  assert.equal(result.activeWorld, backup.worldId);
  assert.equal(result.backups.length, 1);
  assert.equal(result.backups[0].canRestore, true);
  assert.equal(result.backups[0].createdAt, '2026-10-17T12:00:00.000Z');
  assert.equal(result.backups[0].timestamp, backup.timestamp);
  const download = await f.request('/api/native-backup?id=' + encodeURIComponent(backup.id));
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /official-/);
  const file = path.join(f.directory, 'download.tar.gz');
  await writeFile(file, Buffer.from(await download.arrayBuffer()));
  const listing = await f.runtime.run('tar', ['-tzf', file]);
  assert.match(listing, /^Level.sav$/m);
  assert.match(listing, /^LevelMeta.sav$/m);
  assert.match(listing, /^Players\/original.sav$/m);
  assert.doesNotMatch(listing, /Config|current.sav|backup\/world/);
  assert.equal(f.runtime.game.pid, pid);
  assert.equal(f.manager.tasks.length, tasks);
  await assert.rejects(f.manager.submit('backup', { category: 'scheduled' }), /官方机制/);
  assert.equal(f.runtime.game.pid, pid);
  // A rotating snapshot must not yield a partial download or stop the live game.
  await rm(backup.snapshot, { recursive: true });
  assert.equal((await f.request('/api/native-backup?id=' + encodeURIComponent(backup.id))).status, 404);
  assert.equal(f.runtime.game.pid, pid);
});

test('官方备份恢复先备份停服，替换世界与玩家，保留配置和官方历史', async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  await f.task('install');
  const backup = await nativeBackupFixture(f.runtime.saved);
  await f.task('start');
  const pid = f.runtime.game.pid;
  const config = await readFile(f.runtime.config, 'utf8');
  await writeFile(path.join(f.runtime.saved, 'fail-save'), 'fail');
  const failed = await f.task('restore-native', { id: backup.id });
  assert.equal(failed.state, 'failed');
  assert.equal(f.runtime.game.pid, pid);
  assert.equal(await readFile(path.join(backup.world, 'Level.sav'), 'utf8'), 'current-world');
  await rm(path.join(f.runtime.saved, 'fail-save'));
  const restored = await f.task('restore-native', { id: backup.id });
  assert.equal(restored.state, 'succeeded', restored.message);
  assert.notEqual(f.runtime.game.pid, pid);
  assert.equal(f.runtime.ready, true);
  assert.equal(await readFile(path.join(backup.world, 'Level.sav'), 'utf8'), 'official-world');
  assert.equal(await readFile(path.join(backup.world, 'Players/original.sav'), 'utf8'), 'official-player');
  assert.deepEqual(await readdir(path.join(backup.world, 'Players')), ['original.sav']);
  assert.equal(await readFile(path.join(backup.world, 'WorldOption.sav'), 'utf8'), 'current-options');
  assert.equal(await readFile(f.runtime.config, 'utf8'), config);
  assert.equal(await readFile(path.join(backup.snapshot, 'Level.sav'), 'utf8'), 'official-world');
  const archives = await f.manager.backups();
  assert.equal(archives.length, 1);
  assert.equal(archives[0].category, 'before-restore');
  const original = path.join(f.directory, 'original-world.sav');
  await f.runtime.run('tar', ['-xzf', f.manager.backupFile(archives[0].id), '-C', f.directory, '--', `Pal/Saved/SaveGames/0/${backup.worldId}/Level.sav`]);
  await copyFile(path.join(f.directory, `Pal/Saved/SaveGames/0/${backup.worldId}/Level.sav`), original);
  assert.equal(await readFile(original, 'utf8'), 'current-world');
  await f.task('stop');
  assert.equal((await f.task('restore-native', { id: backup.id })).state, 'succeeded');
  assert.equal(f.runtime.game, null);
});

test('不完整、链接、越界和其他世界的官方备份不能恢复，写入中的备份不能导出', async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  await f.task('install');
  const backup = await nativeBackupFixture(f.runtime.saved);
  const broken = path.join(backup.world, 'backup/world/2026.10.17-12.01.00');
  await mkdir(path.join(broken, 'Players'), { recursive: true });
  await writeFile(path.join(broken, 'Level.sav'), 'incomplete');
  const linked = await nativeBackupFixture(f.runtime.saved, { timestamp: '2026.10.17-12.02.00' });
  await rm(path.join(linked.snapshot, 'Players/original.sav'));
  await symlink('/etc/passwd', path.join(linked.snapshot, 'Players/link.sav'));
  const foreign = await nativeBackupFixture(f.runtime.saved, { worldId: 'OTHERWORLD' });
  await writeFile(path.join(f.runtime.saved, 'Config/LinuxServer/GameUserSettings.ini'), `DedicatedServerName=${backup.worldId}\n`);
  await f.task('start');
  const pid = f.runtime.game.pid;
  const listed = await f.manager.nativeBackups();
  assert.deepEqual(listed.backups.map(entry => entry.id).sort(), [backup.id, foreign.id].sort());
  assert.equal(listed.backups.find(entry => entry.id === foreign.id).canRestore, false);
  for (const id of ['../../etc/passwd', `${backup.worldId}/../anything`, linked.id, foreign.id]) {
    const task = await f.task('restore-native', { id });
    assert.equal(task.state, 'failed', id);
    assert.equal(f.runtime.game.pid, pid);
  }
  const get = f.manager.native.get.bind(f.manager.native);
  let first = true;
  f.manager.native.get = async id => {
    const value = await get(id);
    if (first) { first = false; await writeFile(path.join(backup.snapshot, 'Level.sav'), 'world-still-being-written'); }
    return value;
  };
  await assert.rejects(f.manager.native.export(backup.id), /正在写入/);
  assert.equal(f.runtime.game.pid, pid);
  assert.equal((await readdir(path.join(f.directory, 'backups'))).some(name => name.startsWith('.official-')), false);
});

test('旧定时计划自动移除，已有定时归档继续保留', async t => {
  const f = await managementFixture(); t.after(() => f.close());
  await f.manager.close();
  const settingsFile = path.join(f.directory, 'palbox/settings.json');
  const settings = JSON.parse(await readFile(settingsFile, 'utf8'));
  const { gameArgs: _gameArgs, shutdownMessage: _shutdownMessage, ...withoutArgs } = settings;
  await writeFile(settingsFile, JSON.stringify({ ...withoutArgs, backupIntervalHours: 1 }));
  await writeFile(path.join(f.directory, 'backups/scheduled/old.tar.gz'), 'old-backup');
  const manager = new Manager({ directory: f.directory }); t.after(() => manager.close());
  await manager.initialize();
  assert.deepEqual(manager.publicSettings(), {
    backupRetention: 5, backupRetentions: Object.fromEntries(BACKUP_CATEGORIES.map(category => [category, 5])), autoStart: false, shutdownWait: 5, shutdownMessage: 'Palbox 正在维护服务器', gameArgs: [],
    installArgs: ['+force_install_dir', path.join(f.directory, 'server'), '+login', 'anonymous', '+app_update', '2394010', 'validate', '+quit']
  });
  const migrated = JSON.parse(await readFile(settingsFile, 'utf8'));
  assert.equal(Object.hasOwn(migrated, 'backupIntervalHours'), false);
  assert.deepEqual(migrated.gameArgs, []);
  assert.equal(migrated.shutdownMessage, 'Palbox 正在维护服务器');
  assert.equal(manager.runtime.shutdownMessage, 'Palbox 正在维护服务器');
  assert.equal((await manager.backups())[0].category, 'scheduled');
  await assert.rejects(manager.updateSettings({ backupIntervalHours: 1, backupRetention: 10 }), /定时备份已移除/);
});
