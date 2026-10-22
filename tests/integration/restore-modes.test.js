import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { parse } from '../../shared/domain/config.js';
import path from 'node:path';
import { managementFixture } from '../helpers/management-fixture.js';
import { nativeBackupFixture } from '../helpers/native-backup-fixture.js';

const values = source => new Map(parse(source).entries.map(entry => [entry.key, entry.raw]));

test('恢复统一替换当前加载的世界并恢复配置，保留世界 ID、其他数据及原运行状态', async t => {
  for (const running of [false, true]) await t.test(running ? '运行中恢复后重新启动' : '停服恢复后保持停止', async t => {
    const f = await managementFixture(); t.after(() => f.close()); await f.login();
    assert.equal((await f.task('install')).state, 'succeeded');
    const originalConfig = await readFile(f.runtime.config, 'utf8');
    const managedPassword = values(f.manager.store.workspace.profiles.find(profile => profile.locked).initialSource).get('AdminPassword');
    const archived = await nativeBackupFixture(f.runtime.saved, { worldId: 'SAVED_WORLD' });
    const id = await f.manager.backup('manual');
    await writeFile(path.join(archived.world, 'Level.sav'), 'other-world-must-stay');
    const current = await nativeBackupFixture(f.runtime.saved, { worldId: 'CURRENT_WORLD' });
    await writeFile(path.join(current.world, 'Level.sav'), 'current-data');
    await writeFile(path.join(current.world, 'old-only.sav'), 'remove-from-world');
    await writeFile(path.join(f.runtime.saved, 'outside-world.txt'), 'keep');
    await writeFile(f.runtime.config, originalConfig.replace('ExpRate=1.000000', 'ExpRate=9.000000'));
    if (running) assert.equal((await f.task('start')).state, 'succeeded');
    const pid = f.runtime.game?.pid;

    const restored = await f.task('restore', { id });
    assert.equal(restored.state, 'succeeded', restored.message);
    assert.equal(await f.manager.targetWorld(), 'CURRENT_WORLD');
    assert.equal(await readFile(path.join(current.world, 'Level.sav'), 'utf8'), 'current-world');
    await assert.rejects(access(path.join(current.world, 'old-only.sav')), { code: 'ENOENT' });
    assert.equal(await readFile(path.join(current.world, 'backup/world', current.timestamp, 'Level.sav'), 'utf8'), 'official-world');
    assert.equal(await readFile(path.join(archived.world, 'Level.sav'), 'utf8'), 'other-world-must-stay');
    const restoredConfig = await readFile(f.runtime.config, 'utf8');
    assert.equal(restoredConfig, f.manager.store.active().source);
    assert.equal(f.manager.store.active().name, '游戏默认配置');
    assert.equal(values(restoredConfig).get('ExpRate'), values(originalConfig).get('ExpRate'));
    assert.equal(values(restoredConfig).get('AdminPassword'), managedPassword);
    assert.equal(values(restoredConfig).get('RESTAPIEnabled'), 'True');
    assert.equal(await readFile(path.join(f.runtime.saved, 'outside-world.txt'), 'utf8'), 'keep');
    assert.deepEqual(await readdir(path.join(f.runtime.saved, 'SaveGames/0')), ['CURRENT_WORLD', 'SAVED_WORLD']);
    assert.equal((await f.manager.backups()).filter(backup => backup.category === 'before-restore').length, 1);
    assert.equal(Boolean(f.runtime.game), running);
    if (running) assert.notEqual(f.runtime.game.pid, pid);
  });
});

test('拒绝已移除的完整恢复方式；当前世界 ID 缺失时保留运行中的游戏和数据', async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  assert.equal((await f.task('install')).state, 'succeeded');
  await nativeBackupFixture(f.runtime.saved, { worldId: 'SAVED_WORLD' });
  const id = await f.manager.backup('manual');
  assert.equal((await f.task('start')).state, 'succeeded');
  const pid = f.runtime.game.pid;
  const count = f.manager.tasks.length;
  for (const mode of ['full', 'invalid', '', null, true, {}, []]) {
    const response = await f.request('/api/tasks', { method: 'POST', body: { action: 'restore', id, mode } });
    assert.equal(response.status, 400);
  }
  await assert.rejects(f.manager.restore(id, { mode: 'full' }), /恢复方式已统一/);
  assert.equal(f.manager.tasks.length, count);
  await rm(path.join(f.runtime.saved, 'Config/LinuxServer/GameUserSettings.ini'));
  for (const payload of [{ id }, { id, mode: 'world' }]) {
    const task = await f.task('restore', payload);
    assert.equal(task.state, 'failed');
    assert.match(task.message, /GameUserSettings.ini/);
    assert.equal(f.runtime.game.pid, pid);
  }
  assert.equal(await readFile(path.join(f.runtime.saved, 'SaveGames/0/SAVED_WORLD/Level.sav'), 'utf8'), 'current-world');
  assert.equal((await f.manager.backups()).filter(backup => backup.category === 'before-restore').length, 0);
});

test('仅含配置的保护备份可独立恢复，不要求或创建世界 ID', async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  assert.equal((await f.task('install')).state, 'succeeded');
  const id = await f.manager.backup('before-import');
  const original = await readFile(f.runtime.config, 'utf8');
  await writeFile(f.runtime.config, original.replace('ExpRate=1.000000', 'ExpRate=9.000000'));
  const restored = await f.task('restore', { id });
  assert.equal(restored.state, 'succeeded', restored.message);
  assert.equal(values(await readFile(f.runtime.config, 'utf8')).get('ExpRate'), '1.000000');
  assert.equal(await f.manager.native.configuredWorld(), null);
  await assert.rejects(access(path.join(f.runtime.saved, 'SaveGames/0')), { code: 'ENOENT' });
});

test('统一恢复预览只检测内容，返回当前世界路径和配置选择，并拒绝过期目标', async t => {
  const f = await managementFixture(); t.after(() => f.close());
  assert.equal((await f.request('/api/restore-preview', { method: 'POST', body: { action: 'restore', id: 'manual/a.tar.gz' } })).status, 401);
  await f.login();
  assert.equal((await f.task('install')).state, 'succeeded');
  await nativeBackupFixture(f.runtime.saved, { worldId: 'SOURCE' });
  const id = await f.manager.backup('manual');
  const current = await nativeBackupFixture(f.runtime.saved, { worldId: 'CURRENT' });
  await writeFile(path.join(current.world, 'Level.sav'), 'must-keep');
  const before = f.manager.store.snapshot();
  const taskCount = f.manager.tasks.length;
  const response = await f.request('/api/restore-preview', { method: 'POST', body: { action: 'restore', id } });
  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.equal(preview.hasWorld, true);
  assert.equal(preview.sourceWorldId, 'SOURCE');
  assert.equal(preview.targetWorldId, 'CURRENT');
  assert.equal(preview.targetDirectory, path.join(f.runtime.saved, 'SaveGames/0/CURRENT'));
  assert.equal(preview.hasConfiguration, true);
  assert.equal(preview.configurationProfile, '游戏默认配置');
  assert.equal(preview.selectConfiguration, true);
  assert.deepEqual(f.manager.store.snapshot(), before);
  assert.equal(f.manager.tasks.length, taskCount);
  assert.equal(await readFile(path.join(current.world, 'Level.sav'), 'utf8'), 'must-keep');
  await writeFile(path.join(f.runtime.saved, 'Config/LinuxServer/GameUserSettings.ini'), 'DedicatedServerName=CHANGED\n');
  const task = await f.task('restore', { id, targetWorldId: preview.targetWorldId });
  assert.equal(task.state, 'failed');
  assert.match(task.message, /恢复目标已改变/);
  assert.equal(await readFile(path.join(current.world, 'Level.sav'), 'utf8'), 'must-keep');
  assert.equal((await f.manager.backups()).filter(backup => backup.category === 'before-restore').length, 0);
});

test('上传存档和官方快照均提供统一预览，确认后按显示目标恢复并选中配置', async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  assert.equal((await f.task('install')).state, 'succeeded');
  await nativeBackupFixture(f.runtime.saved, { worldId: 'SOURCE' });
  const id = await f.manager.backup('manual');
  const current = await nativeBackupFixture(f.runtime.saved, { worldId: 'CURRENT' });
  const upload = await f.upload('/api/save-import', await readFile(f.manager.backupFile(id)));
  assert.equal(upload.status, 201);
  const staged = await upload.json();
  const response = await f.request('/api/restore-preview', { method: 'POST', body: { action: 'import-save', id: staged.id } });
  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.equal(preview.targetWorldId, 'CURRENT');
  assert.equal(preview.sourceWorldId, 'SOURCE');
  assert.equal(preview.hasConfiguration, true);
  assert.equal(preview.protectionCategory, 'before-import');
  const task = await f.task('import-save', { id: staged.id, targetWorldId: preview.targetWorldId });
  assert.equal(task.state, 'succeeded', task.message);
  assert.equal(await f.manager.targetWorld(), 'CURRENT');
  assert.equal(f.manager.store.active().name, '游戏默认配置');
  const native = await f.request('/api/restore-preview', { method: 'POST', body: { action: 'restore-native', id: current.id } });
  assert.equal(native.status, 200);
  const snapshot = await native.json();
  assert.equal(snapshot.hasWorld, true);
  assert.equal(snapshot.targetWorldId, 'CURRENT');
  assert.equal(snapshot.hasConfiguration, false);
  assert.equal(snapshot.selectConfiguration, false);
});
