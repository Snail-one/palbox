import { test } from 'node:test';
import { BACKUP_CATEGORIES } from '../../backend/management/backup-paths.js';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm, readdir, symlink, copyFile } from 'node:fs/promises';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
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
  assert.equal(download.headers.get('content-disposition'), `attachment; filename="${backup.timestamp}-pal-${backup.worldId}.tar.gz"`);
  const file = path.join(f.directory, 'download.tar.gz');
  await writeFile(file, Buffer.from(await download.arrayBuffer()));
  const listing = await f.runtime.run('tar', ['-tzf', file]);
  const world = backup.worldId;
  assert.match(listing, new RegExp(`^${world}/Level.sav$`, 'm'));
  assert.match(listing, new RegExp(`^${world}/LevelMeta.sav$`, 'm'));
  assert.match(listing, new RegExp(`^${world}/Players/original.sav$`, 'm'));
  assert.match(listing, /^Config\/LinuxServer\/PalWorldSettings.ini$/m);
  assert.doesNotMatch(listing, /GameUserSettings|current\.sav|backup\/world/);
  assert.equal(await f.runtime.run('tar', ['-xOf', file, 'Config/LinuxServer/PalWorldSettings.ini']), await readFile(f.runtime.config, 'utf8'));
  await rm(f.runtime.config);
  const missing = await f.request('/api/native-backup?id=' + encodeURIComponent(backup.id));
  assert.equal(missing.status, 409);
  assert.match((await missing.json()).error, /PalWorldSettings\.ini/);
  await writeFile(f.runtime.config, 'OptionSettings=(ExpRate=1)\n');
  assert.equal(f.runtime.game.pid, pid);
  assert.equal(f.manager.tasks.length, tasks);
  await assert.rejects(f.manager.submit('backup', { category: 'scheduled' }), /官方机制/);
  assert.equal(f.runtime.game.pid, pid);
  // A rotating snapshot must not yield a partial download or stop the live game.
  await rm(backup.snapshot, { recursive: true });
  assert.equal((await f.request('/api/native-backup?id=' + encodeURIComponent(backup.id))).status, 404);
  assert.equal(f.runtime.game.pid, pid);
});

test('官方备份下载文件名使用请求时区，处理跨日、夏令时与无效时区', async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  const cases = [
    ['Asia/Shanghai', '2026.10.18-23.01.02', '2026.10.19-07.01.02'],
    ['America/Los_Angeles', '2026.01.18-06.00.00', '2026.01.17-22.00.00'],
    ['America/Los_Angeles', '2026.07.18-06.00.00', '2026.07.17-23.00.00'],
    ['Asia/Kathmandu', '2026.07.18-00.00.00', '2026.07.18-05.45.00'],
    ['Asia/Shanghai', '2026.10.18-16.00.00', '2026.10.19-00.00.00']
  ];
  for (const [timeZone, timestamp, localTimestamp] of cases) {
    const backup = await nativeBackupFixture(f.runtime.saved, { timestamp });
    await writeFile(path.join(f.runtime.saved, 'Config/LinuxServer/PalWorldSettings.ini'), 'OptionSettings=(ExpRate=1)\n');
    const query = new URLSearchParams({ id: backup.id, timeZone });
    const response = await f.request('/api/native-backup?' + query);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-disposition'), `attachment; filename="${localTimestamp}-pal-${backup.worldId}.tar.gz"`);
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
  const invalid = await f.request('/api/native-backup?' + new URLSearchParams({ id: 'WORLD/2026.10.18-23.01.02', timeZone: 'invalid-zone' }));
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /时区无效/);
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
  await f.runtime.run('tar', ['-xzf', f.manager.backupFile(archives[0].id), '-C', f.directory, '--', `${backup.worldId}/Level.sav`]);
  await copyFile(path.join(f.directory, `${backup.worldId}/Level.sav`), original);
  assert.equal(await readFile(original, 'utf8'), 'current-world');
  await f.task('stop');
  assert.equal((await f.task('restore-native', { id: backup.id })).state, 'succeeded');
  assert.equal(f.runtime.game, null);
});

test('官方备份恢复在保护备份失败后重新启动游戏，世界保持原样', async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  await f.task('install');
  const backup = await nativeBackupFixture(f.runtime.saved);
  await f.task('start');
  const pid = f.runtime.game.pid;
  f.manager.backup = async () => { throw new Error('模拟保护备份失败'); };
  const task = await f.task('restore-native', { id: backup.id });
  assert.equal(task.state, 'failed');
  assert.match(task.message, /保护备份失败/);
  assert.ok(f.runtime.game);
  assert.notEqual(f.runtime.game.pid, pid);
  assert.equal(f.runtime.ready, true);
  assert.equal(await readFile(path.join(backup.world, 'Level.sav'), 'utf8'), 'current-world');
  assert.equal(await readFile(path.join(backup.world, 'Players/current.sav'), 'utf8'), 'current-player');
});

test('官方恢复成功后两层临时目录清理失败只记录日志，不误报任务失败', async t => {
  for (const running of [false, true]) await t.test(running ? '恢复运行中的游戏' : '恢复后保持停止', async t => {
    const f = await managementFixture(); t.after(() => f.close()); await f.login();
    assert.equal((await f.task('install')).state, 'succeeded');
    const backup = await nativeBackupFixture(f.runtime.saved);
    if (running) assert.equal((await f.task('start')).state, 'succeeded');
    const config = await readFile(f.runtime.config);
    const remove = fs.rm;
    let cleanupFailures = 0;
    t.mock.method(fs, 'rm', async (file, ...options) => {
      if (path.basename(String(file)).startsWith('.official-restore-')) {
        cleanupFailures++;
        throw new Error('模拟官方恢复清理失败');
      }
      return remove(file, ...options);
    });
    syncBuiltinESMExports();
    t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
    const task = await f.task('restore-native', { id: backup.id });
    assert.equal(task.state, 'succeeded', task.message);
    assert.equal(cleanupFailures, 2);
    assert.equal(await readFile(path.join(backup.world, 'Level.sav'), 'utf8'), 'official-world');
    assert.equal(await readFile(path.join(backup.world, 'Players/original.sav'), 'utf8'), 'official-player');
    assert.deepEqual(await readFile(f.runtime.config), config);
    assert.equal(Boolean(f.runtime.game), running);
    assert.match(await f.runtime.logs('palbox'), /官方恢复临时文件清理失败：模拟官方恢复清理失败/);
  });
});

test('官方恢复失败后的清理错误不能覆盖原错误或回滚失败标记', async t => {
  for (const rollbackFails of [false, true]) await t.test(rollbackFails ? '回滚失败保持停服' : '回滚成功恢复原游戏', async t => {
    const f = await managementFixture(); t.after(() => f.close()); await f.login();
    assert.equal((await f.task('install')).state, 'succeeded');
    const backup = await nativeBackupFixture(f.runtime.saved);
    assert.equal((await f.task('start')).state, 'succeeded');
    const rename = fs.rename, remove = fs.rm;
    t.mock.method(fs, 'rename', async (source, target) => {
      if (target === path.join(backup.world, 'Level.sav')) {
        if (path.basename(path.dirname(source)) === 'save') throw new Error('模拟官方存档写入失败');
        if (rollbackFails && path.basename(path.dirname(source)) === 'previous') throw new Error('模拟官方存档回滚失败');
      }
      return rename(source, target);
    });
    let cleanupFailures = 0;
    t.mock.method(fs, 'rm', async (file, ...options) => {
      if (path.basename(String(file)).startsWith('.official-restore-')) {
        cleanupFailures++;
        throw new Error('模拟失败后的清理错误');
      }
      return remove(file, ...options);
    });
    syncBuiltinESMExports();
    t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
    const task = await f.task('restore-native', { id: backup.id });
    assert.equal(task.state, 'failed');
    assert.doesNotMatch(task.message, /清理错误/);
    assert.equal(cleanupFailures, rollbackFails ? 1 : 2);
    if (rollbackFails) {
      assert.match(task.message, /恢复回滚失败，原文件已保留在/);
      assert.equal(f.runtime.game, null);
      const stages = (await readdir(path.join(f.directory, 'backups'))).filter(name => name.startsWith('.official-restore-'));
      const originals = await Promise.all(stages.map(name => readFile(path.join(f.directory, 'backups', name, 'previous/Level.sav'), 'utf8').catch(() => null)));
      assert.ok(originals.includes('current-world'));
    } else {
      assert.match(task.message, /模拟官方存档写入失败/);
      assert.equal(await readFile(path.join(backup.world, 'Level.sav'), 'utf8'), 'current-world');
      assert.equal(await readFile(path.join(backup.world, 'Players/current.sav'), 'utf8'), 'current-player');
      assert.ok(f.runtime.game);
    }
    assert.match(await f.runtime.logs('palbox'), /官方恢复临时文件清理失败：模拟失败后的清理错误/);
  });
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
  const selection = path.join(f.runtime.saved, 'Config/LinuxServer/GameUserSettings.ini');
  await rm(selection);
  const withoutSelection = await f.manager.nativeBackups();
  assert.equal(withoutSelection.activeWorld, null);
  assert.equal(withoutSelection.backups.some(entry => entry.canRestore), false);
  const missingSelection = await f.task('restore-native', { id: backup.id });
  assert.equal(missingSelection.state, 'failed');
  assert.match(missingSelection.message, /GameUserSettings\.ini/);
  assert.equal(f.runtime.game.pid, pid);
  await writeFile(selection, `DedicatedServerName=${backup.worldId}\n`);
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

test('启动移除旧备份分类与保留设置，旧归档不再展示且文件保留', async t => {
  const f = await managementFixture(); t.after(() => f.close());
  await f.manager.close();
  const settingsFile = path.join(f.directory, 'palbox/settings.json');
  const settings = JSON.parse(await readFile(settingsFile, 'utf8'));
  const { gameArgs: _gameArgs, shutdownMessage: _shutdownMessage, ...withoutArgs } = settings;
  await writeFile(settingsFile, JSON.stringify({ ...withoutArgs, backupIntervalHours: 1, backupRetentions: { ...Object.fromEntries(BACKUP_CATEGORIES.map(category => [category, 5])), manual: 7, scheduled: 5, 'before-update': 4 } }));
  for (const category of ['scheduled', 'before-update']) {
    await mkdir(path.join(f.directory, 'backups', category));
    await writeFile(path.join(f.directory, 'backups', category, 'old.tar.gz'), 'old-backup');
  }
  const manager = new Manager({ directory: f.directory }); t.after(() => manager.close());
  await manager.initialize();
  assert.deepEqual(manager.publicSettings(), {
    backupRetention: 5, backupRetentions: { ...Object.fromEntries(BACKUP_CATEGORIES.map(category => [category, 5])), manual: 7 }, autoStart: false, autoProxy: false, shutdownWait: 5, shutdownMessage: 'Palbox 正在维护服务器', gameArgs: [],
    installArgs: ['+force_install_dir', path.join(f.directory, 'server'), '+login', 'anonymous', '+app_update', '2394010', 'validate', '+quit']
  });
  const migrated = JSON.parse(await readFile(settingsFile, 'utf8'));
  assert.equal(Object.hasOwn(migrated, 'backupIntervalHours'), false);
  assert.deepEqual(migrated.gameArgs, []);
  assert.equal(migrated.shutdownMessage, 'Palbox 正在维护服务器');
  assert.equal(manager.runtime.shutdownMessage, 'Palbox 正在维护服务器');
  assert.deepEqual(await manager.backups(), []);
  assert.equal(Object.hasOwn(migrated.backupRetentions, 'scheduled'), false);
  assert.equal(Object.hasOwn(migrated.backupRetentions, 'before-update'), false);
  assert.equal(migrated.backupRetentions.manual, 7);
  for (const category of ['scheduled', 'before-update']) {
    assert.equal(await readFile(path.join(f.directory, 'backups', category, 'old.tar.gz'), 'utf8'), 'old-backup');
    assert.throws(() => manager.backupFile(`${category}/old.tar.gz`), { status: 400 });
    await assert.rejects(manager.updateSettings({ backupRetentions: { [category]: 5 } }), { status: 400 });
  }
  await assert.rejects(manager.updateSettings({ backupIntervalHours: 1, backupRetention: 10 }), /定时备份已移除/);
});
