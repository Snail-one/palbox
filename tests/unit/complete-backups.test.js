import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Manager } from '../../backend/management/manager.js';
import template from '../../shared/domain/template.js';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-complete-backup-'));
  const manager = new Manager({ directory });
  t.after(async () => { await manager.close(); await rm(directory, { recursive: true, force: true }); });
  await mkdir(path.join(directory, 'server'), { recursive: true });
  await writeFile(path.join(directory, 'server/DefaultPalWorldSettings.ini'), template);
  await manager.initialize();
  return { manager, runtime: manager.runtime, directory };
}

test('缺失、空目录、配置文件、空存档和链接不能冒充可备份世界', async t => {
  const { manager, runtime, directory } = await fixture(t);
  async function rejected() {
    const count = manager.tasks.length;
    assert.equal((await manager.status()).hasWorldSave, false);
    await assert.rejects(manager.submit('backup'), { status: 409, message: /尚无可备份的世界存档/ });
    assert.equal(manager.tasks.length, count);
    assert.deepEqual(await manager.backups(), []);
  }
  await rejected();
  await mkdir(runtime.saved, { recursive: true });
  await rejected();
  // Applying the first configuration must still work before a world exists.
  await manager.submit('apply', { revision: manager.store.revision, profileId: manager.store.active().id });
  await manager.operation;
  assert.equal(manager.tasks[0].state, 'succeeded', manager.tasks[0].message);
  assert.ok((await readFile(runtime.config, 'utf8')).includes('OptionSettings='));
  await rejected();
  const world = path.join(runtime.saved, 'SaveGames/0/WORLD1');
  await mkdir(world, { recursive: true });
  await rejected();
  const level = path.join(world, 'Level.sav');
  await writeFile(level, '');
  await rejected();
  await rm(level);
  const outside = path.join(directory, 'outside.sav');
  await writeFile(outside, 'not-a-world');
  await symlink(outside, level);
  await rejected();
});

test('停服时有实际世界存档才能生成可读取的完整备份', async t => {
  const { manager, runtime, directory } = await fixture(t);
  const world = path.join(runtime.saved, 'SaveGames/0/WORLD1');
  await mkdir(world, { recursive: true });
  await writeFile(path.join(world, 'Level.sav'), 'world-data');
  await manager.ensureConfig();
  assert.equal((await manager.status()).hasWorldSave, true);
  await manager.submit('backup');
  await manager.operation;
  const task = manager.tasks[0];
  assert.equal(task.state, 'succeeded', task.message);
  assert.ok(task.backup);
  const list = await runtime.run('tar', ['-tzf', manager.backupFile(task.backup)]);
  assert.match(list, /Pal\/Saved\/SaveGames\/0\/WORLD1\/Level\.sav/);
  assert.match(list, /Pal\/Saved\/Config\/LinuxServer\/PalWorldSettings\.ini/);
  assert.equal(runtime.game, null);
  assert.equal((await manager.backups()).length, 1);
  assert.equal((await readdir(path.join(directory, 'backups/manual'))).some(name => name.endsWith('.partial')), false);
});

test('自动保护备份跳过空目录，但保留已有游戏配置的恢复能力', async t => {
  const { manager, runtime } = await fixture(t);
  await mkdir(path.join(runtime.saved, 'SaveGames/0/EMPTY'), { recursive: true });
  assert.equal(await manager.backup('manual'), null);
  assert.deepEqual(await manager.backups(), []);
  await manager.ensureConfig();
  const id = await manager.backup('manual');
  assert.ok(id);
  const list = await runtime.run('tar', ['-tzf', manager.backupFile(id)]);
  assert.match(list, /Pal\/Saved\/Config\/LinuxServer\/PalWorldSettings\.ini/);
  await assert.rejects(manager.submit('backup'), /尚无可备份的世界存档/);
});

test('备份期间存档消失不能显示成功，也不清理已有归档', async t => {
  const { manager, runtime, directory } = await fixture(t);
  const world = path.join(runtime.saved, 'SaveGames/0/WORLD1');
  await mkdir(world, { recursive: true });
  await writeFile(path.join(world, 'Level.sav'), 'world-data');
  const existing = path.join(directory, 'backups/manual/existing.tar.gz');
  await writeFile(existing, 'existing-archive');
  manager.backup = async () => null;
  await manager.submit('backup');
  await manager.operation;
  assert.equal(manager.tasks[0].state, 'failed');
  assert.match(manager.tasks[0].message, /未创建备份/);
  assert.equal(await readFile(existing, 'utf8'), 'existing-archive');
});

test('运行中拒绝手动备份，不停止或重启游戏，也不创建任务与归档', async t => {
  const { manager, runtime } = await fixture(t);
  const world = path.join(runtime.saved, 'SaveGames/0/WORLD1');
  await mkdir(world, { recursive: true });
  await writeFile(path.join(world, 'Level.sav'), 'world-data');
  const game = {};
  runtime.game = game;
  runtime.ready = true;
  runtime.stop = async () => { assert.fail('不应停止游戏'); };
  runtime.start = async () => { assert.fail('不应启动游戏'); };
  try {
    await assert.rejects(manager.submit('backup'), { status: 409, message: /请先停止游戏服/ });
    assert.equal(runtime.game, game);
    assert.equal(runtime.ready, true);
    assert.deepEqual(manager.tasks, []);
    assert.equal(manager.busy, null);
    assert.deepEqual(await manager.backups(), []);
    assert.equal(await readFile(path.join(world, 'Level.sav'), 'utf8'), 'world-data');
  } finally { runtime.game = null; runtime.stop = async () => {}; }
});

test('存档预检查期间游戏启动后拒绝手动备份', async t => {
  const { manager, runtime } = await fixture(t);
  manager.requireWorldSave = async () => { runtime.game = {}; };
  try {
    await assert.rejects(manager.submit('backup'), { status: 409, message: /请先停止游戏服/ });
    assert.deepEqual(manager.tasks, []);
    assert.equal(manager.busy, null);
    assert.deepEqual(await manager.backups(), []);
  } finally { runtime.game = null; }
});
