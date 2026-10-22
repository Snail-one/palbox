import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { parse } from '../../shared/domain/config.js';
import path from 'node:path';
import { managementFixture } from '../helpers/management-fixture.js';
import { nativeBackupFixture } from '../helpers/native-backup-fixture.js';

test('世界备份按选择恢复当前世界，或写入配置并替换包内世界，均保留恢复前备份及原运行状态', async t => {
  for (const running of [false, true]) await t.test(running ? '运行中恢复后重新启动' : '停服恢复后保持停止', async t => {
    const f = await managementFixture(); t.after(() => f.close()); await f.login();
    assert.equal((await f.task('install')).state, 'succeeded');
    const originalConfig = await readFile(f.runtime.config, 'utf8');
    await nativeBackupFixture(f.runtime.saved, { worldId: 'SAVED_WORLD' });
    const id = await f.manager.backup('manual');
    const current = await nativeBackupFixture(f.runtime.saved, { worldId: 'CURRENT_WORLD' });
    await writeFile(path.join(current.world, 'Level.sav'), 'current-data');
    await writeFile(path.join(current.world, 'old-only.sav'), 'remove-from-world');
    await writeFile(path.join(f.runtime.saved, 'outside-world.txt'), 'keep-until-full');
    const currentConfig = originalConfig + '\n; current-config\n';
    await writeFile(f.runtime.config, currentConfig);
    if (running) assert.equal((await f.task('start')).state, 'succeeded');
    const pid = f.runtime.game?.pid;

    const world = await f.task('restore', { id, mode: 'world' });
    assert.equal(world.state, 'succeeded', world.message);
    assert.equal(await f.manager.targetWorld(), 'CURRENT_WORLD');
    assert.equal(await readFile(path.join(current.world, 'Level.sav'), 'utf8'), 'current-world');
    await assert.rejects(access(path.join(current.world, 'old-only.sav')), { code: 'ENOENT' });
    assert.equal(await readFile(path.join(current.world, 'backup/world', current.timestamp, 'Level.sav'), 'utf8'), 'official-world');
    const restoredConfig = await readFile(f.runtime.config, 'utf8');
    assert.equal(restoredConfig, f.manager.store.active().source);
    assert.equal(f.manager.store.active().name, '游戏默认配置');
    assert.doesNotMatch(restoredConfig, /current-config/);
    const wanted = new Map(parse(originalConfig).entries.map(entry => [entry.key, entry.raw]));
    const actual = new Map(parse(restoredConfig).entries.map(entry => [entry.key, entry.raw]));
    assert.equal(actual.get('ExpRate'), wanted.get('ExpRate'));
    assert.equal(actual.get('AdminPassword'), wanted.get('AdminPassword'));
    assert.equal(actual.get('RESTAPIEnabled'), 'True');
    assert.equal(await readFile(path.join(f.runtime.saved, 'outside-world.txt'), 'utf8'), 'keep-until-full');
    assert.deepEqual(await readdir(path.join(f.runtime.saved, 'SaveGames/0')), ['CURRENT_WORLD', 'SAVED_WORLD']);
    assert.equal(Boolean(f.runtime.game), running);
    if (running) assert.notEqual(f.runtime.game.pid, pid);
    const worldPid = f.runtime.game?.pid;

    const full = await f.task('restore', { id, mode: 'full' });
    assert.equal(full.state, 'succeeded', full.message);
    assert.equal(await f.manager.targetWorld(), 'CURRENT_WORLD');
    assert.equal(await readFile(f.runtime.config, 'utf8'), restoredConfig);
    assert.deepEqual((await readdir(path.join(f.runtime.saved, 'SaveGames/0'))).sort(), ['CURRENT_WORLD', 'SAVED_WORLD']);
    assert.equal(await readFile(path.join(f.runtime.saved, 'outside-world.txt'), 'utf8'), 'keep-until-full');
    assert.equal(await readFile(path.join(f.runtime.saved, 'SaveGames/0/SAVED_WORLD/Level.sav'), 'utf8'), 'current-world');
    assert.equal((await f.manager.backups()).filter(backup => backup.category === 'before-restore').length, 2);
    assert.equal(Boolean(f.runtime.game), running);
    if (running) assert.notEqual(f.runtime.game.pid, worldPid);
  });
});

test('拒绝无效恢复方式；存档模式缺少当前世界 ID 时拒绝恢复，不自动扩大为完整恢复', async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  assert.equal((await f.task('install')).state, 'succeeded');
  await nativeBackupFixture(f.runtime.saved, { worldId: 'SAVED_WORLD' });
  const id = await f.manager.backup('manual');
  assert.equal((await f.task('start')).state, 'succeeded');
  const pid = f.runtime.game.pid;
  const count = f.manager.tasks.length;
  for (const mode of ['invalid', '', null, true, {}, []]) {
    const response = await f.request('/api/tasks', { method: 'POST', body: { action: 'restore', id, mode } });
    assert.equal(response.status, 400);
  }
  assert.equal(f.manager.tasks.length, count);
  await rm(path.join(f.runtime.saved, 'Config/LinuxServer/GameUserSettings.ini'));
  const world = await f.task('restore', { id, mode: 'world' });
  assert.equal(world.state, 'failed');
  assert.match(world.message, /GameUserSettings.ini/);
  assert.equal(f.runtime.game.pid, pid);
  assert.equal((await f.manager.backups()).filter(backup => backup.category === 'before-restore').length, 0);
  const full = await f.task('restore', { id });
  assert.equal(full.state, 'succeeded', full.message);
  await assert.rejects(f.manager.targetWorld(), /GameUserSettings\.ini/);
  assert.equal(await readFile(path.join(f.runtime.saved, 'SaveGames/0/SAVED_WORLD/Level.sav'), 'utf8'), 'current-world');
  assert.notEqual(f.runtime.game.pid, pid);
  assert.equal((await f.manager.backups()).filter(backup => backup.category === 'before-restore').length, 1);
});
