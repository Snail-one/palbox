import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Manager } from '../../backend/management/manager.js';
import { BACKUP_CATEGORIES } from '../../backend/management/backup-paths.js';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-delete-backup-'));
  const manager = new Manager({ directory });
  await manager.initialize();
  t.after(async () => { manager.runtime.game = null; await manager.close(); await rm(directory, { recursive: true, force: true }); });
  async function task(id) {
    await manager.submit('delete-backup', { id });
    await manager.operation;
    return manager.tasks[0];
  }
  return { manager, directory, task };
}

test('各类完整备份均可逐条删除，不停服且不改变当前存档', async t => {
  const { manager, directory, task } = await fixture(t);
  const game = {};
  manager.runtime.game = game;
  const world = path.join(manager.runtime.saved, 'SaveGames/0/WORLD1');
  await mkdir(world, { recursive: true });
  await writeFile(path.join(world, 'Level.sav'), 'current-world');
  for (const category of BACKUP_CATEGORIES) {
    const id = `${category}/selected.tar.gz`;
    const selected = path.join(directory, 'backups', id);
    const other = path.join(directory, 'backups', category, 'other.tar.gz');
    await writeFile(selected, 'selected-archive');
    await writeFile(other, 'keep-archive');
    const result = await task(id);
    assert.equal(result.state, 'succeeded', result.message);
    await assert.rejects(readFile(selected), { code: 'ENOENT' });
    assert.equal(await readFile(other, 'utf8'), 'keep-archive');
    assert.equal(manager.runtime.game, game);
    assert.equal(await readFile(path.join(world, 'Level.sav'), 'utf8'), 'current-world');
    assert.ok(!(await manager.backups()).some(backup => backup.id === id));
    assert.equal((await task(id)).state, 'failed');
    assert.match(manager.tasks[0].message, /不存在或已被删除/);
  }
});

test('删除拒绝越界路径、临时文件、目录和链接，保留目标目录外的文件', async t => {
  const { manager, directory, task } = await fixture(t);
  const outside = path.join(directory, 'outside');
  await mkdir(outside);
  const target = path.join(outside, 'outside.tar.gz');
  await writeFile(target, 'must-keep');
  for (const id of [null, '', '../outside.tar.gz', 'manual/../../outside.tar.gz', 'manual/file.tar.gz/extra', 'manual/file.tar.gz.partial', 'native/file.tar.gz']) {
    assert.equal((await task(id)).state, 'failed', String(id));
  }
  await mkdir(manager.backupFile('manual/directory.tar.gz'));
  await symlink(target, manager.backupFile('manual/link.tar.gz'));
  assert.equal((await task('manual/directory.tar.gz')).state, 'failed');
  assert.equal((await task('manual/link.tar.gz')).state, 'failed');
  await rm(path.join(directory, 'backups/before-import'), { recursive: true });
  await symlink(outside, path.join(directory, 'backups/before-import'));
  assert.equal((await task('before-import/outside.tar.gz')).state, 'failed');
  await rename(path.join(directory, 'backups'), path.join(directory, 'original-backups'));
  await symlink(outside, path.join(directory, 'backups'));
  await mkdir(path.join(outside, 'manual'));
  await writeFile(path.join(outside, 'manual/outside.tar.gz'), 'also-keep');
  assert.equal((await task('manual/outside.tar.gz')).state, 'failed');
  assert.equal(await readFile(target, 'utf8'), 'must-keep');
  assert.equal(await readFile(path.join(outside, 'manual/outside.tar.gz'), 'utf8'), 'also-keep');
});

test('删除与恢复、其他删除串行执行，不能删掉任务使用中的备份', async t => {
  const { manager, directory } = await fixture(t);
  await writeFile(path.join(directory, 'backups/manual/selected.tar.gz'), 'selected');
  await writeFile(path.join(directory, 'backups/manual/other.tar.gz'), 'other');
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const remove = manager.deleteBackup.bind(manager);
  manager.deleteBackup = async id => { await pending; await remove(id); };
  try {
    await manager.submit('delete-backup', { id: 'manual/selected.tar.gz' });
    await assert.rejects(manager.submit('restore', { id: 'manual/selected.tar.gz' }), { status: 409 });
    await assert.rejects(manager.submit('delete-backup', { id: 'manual/other.tar.gz' }), { status: 409 });
    assert.equal(await readFile(path.join(directory, 'backups/manual/selected.tar.gz'), 'utf8'), 'selected');
  } finally { release(); await manager.operation; }
  assert.equal(manager.tasks[0].state, 'succeeded');
  assert.equal(await readFile(path.join(directory, 'backups/manual/other.tar.gz'), 'utf8'), 'other');
});

test('存档检查期间开始删除任务时，备份不能覆盖正在执行的任务锁', async t => {
  const { manager, directory } = await fixture(t);
  await writeFile(path.join(directory, 'backups/manual/selected.tar.gz'), 'selected');
  let finishCheck, finishDelete;
  manager.requireWorldSave = () => new Promise(resolve => { finishCheck = resolve; });
  const remove = manager.deleteBackup.bind(manager);
  manager.deleteBackup = async id => { await new Promise(resolve => { finishDelete = resolve; }); await remove(id); };
  const backup = manager.submit('backup');
  try {
    await manager.submit('delete-backup', { id: 'manual/selected.tar.gz' });
    finishCheck();
    await assert.rejects(backup, { status: 409 });
    assert.equal(manager.busy.action, 'delete-backup');
  } finally { finishCheck(); finishDelete?.(); await manager.operation; }
});
