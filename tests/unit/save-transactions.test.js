import { tmpdir } from 'node:os';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { NativeBackups } from '../../backend/management/native-backups.js';
import { nativeBackupFixture } from '../helpers/native-backup-fixture.js';

async function fixture(t) {
  const directory = await fs.mkdtemp(tmpdir() + '/palbox-save-transactions-');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const saved = path.join(directory, 'server/Pal/Saved');
  const world = await nativeBackupFixture(saved, { worldId: 'WORLD' });
  const native = new NativeBackups(saved, directory);
  const transactions = path.join(directory, 'palbox/transactions');
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return { directory, saved, world, native, transactions };
}

test('重置目录安装失败时还原世界和玩家文件，不出现半删除世界', async t => {
  const { world, native, transactions } = await fixture(t);
  const rename = fs.rename;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (path.basename(from) === 'replacement') throw new Error('injected swap failure');
    return rename(from, to);
  });
  syncBuiltinESMExports();
  await assert.rejects(native.clearWorld('WORLD', () => {}), /swap failure/);
  assert.equal(await fs.readFile(path.join(world.world, 'Level.sav'), 'utf8'), 'current-world');
  assert.equal(await fs.readFile(path.join(world.world, 'Players/current.sav'), 'utf8'), 'current-player');
  assert.equal(await fs.readFile(path.join(world.snapshot, 'Level.sav'), 'utf8'), 'official-world');
  await assert.rejects(fs.lstat(transactions), { code: 'ENOENT' });
});

test('重置提交后清理失败只保留暂存，不把完整空世界误报为失败', async t => {
  const { world, native, transactions } = await fixture(t);
  const remove = fs.rm;
  const logs = [];
  t.mock.method(fs, 'rm', async (file, ...options) => {
    if (path.dirname(file) === transactions) throw new Error('injected cleanup failure');
    return remove(file, ...options);
  });
  syncBuiltinESMExports();
  const count = (await fs.readdir(world.world)).length;
  assert.equal(await native.clearWorld('WORLD', () => {}, { onCleanupError: error => logs.push(error.message) }), count);
  assert.deepEqual(await fs.readdir(world.world), []);
  const [stage] = await fs.readdir(transactions);
  assert.equal(await fs.readFile(path.join(transactions, stage, 'previous/Level.sav'), 'utf8'), 'current-world');
  assert.match(logs[0], /cleanup failure.*暂存目录/);
});

test('重置回滚失败时保留完整旧目录并返回副本位置', async t => {
  const { native, transactions } = await fixture(t);
  const rename = fs.rename;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (['replacement', 'previous'].includes(path.basename(from))) throw new Error('injected persistent failure');
    return rename(from, to);
  });
  syncBuiltinESMExports();
  await assert.rejects(native.clearWorld('WORLD', () => {}), error => error.rollbackFailed && error.message.includes(transactions));
  const [stage] = await fs.readdir(transactions);
  assert.equal(await fs.readFile(path.join(transactions, stage, 'previous/Level.sav'), 'utf8'), 'current-world');
  assert.equal(await fs.readFile(path.join(transactions, stage, 'previous/Players/current.sav'), 'utf8'), 'current-player');
});

test('官方恢复按目标设备选择事务目录，跨盘只复制，不执行跨盘 rename', async t => {
  const { saved, world, native, transactions } = await fixture(t);
  const lstat = fs.lstat, rename = fs.rename;
  const device = file => path.resolve(file).startsWith(saved + path.sep) || path.resolve(file) === saved ? 2 : 1;
  t.mock.method(fs, 'lstat', async file => Object.assign(await lstat(file), { dev: device(file) }));
  let moves = 0;
  t.mock.method(fs, 'rename', async (from, to) => {
    moves++;
    if (device(from) !== device(path.dirname(to))) throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
    return rename(from, to);
  });
  syncBuiltinESMExports();
  await native.restore(world.id, async () => {});
  assert.ok(moves > 0);
  assert.equal(await fs.readFile(path.join(world.world, 'Level.sav'), 'utf8'), 'official-world');
  assert.equal(await fs.readFile(path.join(world.world, 'Players/original.sav'), 'utf8'), 'official-player');
  assert.equal(await fs.readFile(path.join(world.world, 'WorldOption.sav'), 'utf8'), 'current-options');
  assert.equal(await fs.readFile(path.join(world.snapshot, 'Level.sav'), 'utf8'), 'official-world');
  await assert.rejects(fs.lstat(transactions), { code: 'ENOENT' });
  await assert.rejects(fs.lstat(path.join(path.dirname(world.world), '.palbox-transactions')), { code: 'ENOENT' });
});

test('事务目录为链接时拒绝操作，原存档保持不变', async t => {
  const { directory, world, native, transactions } = await fixture(t);
  const outside = path.join(directory, 'outside'); await fs.mkdir(outside);
  await fs.mkdir(path.dirname(transactions)); await fs.symlink(outside, transactions);
  await assert.rejects(native.clearWorld('WORLD', () => {}), /事务暂存目录不能包含链接/);
  assert.equal(await fs.readFile(path.join(world.world, 'Level.sav'), 'utf8'), 'current-world');
  assert.deepEqual(await fs.readdir(outside), []);
});
