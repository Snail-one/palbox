import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { createTransaction, finishTransaction, cleanupTransactions } from '../../backend/management/transactions.js';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'palbox-transaction-cleanup-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, root: path.join(directory, 'palbox/transactions'), journal: path.join(directory, 'palbox/transaction-journal') };
}

async function absent(file) { await assert.rejects(fs.lstat(file), { code: 'ENOENT' }); }

async function interrupted(f, { state = 'active', recoverable = true, root = f.root } = {}) {
  await fs.mkdir(root, { recursive: true });
  const stage = await fs.mkdtemp(path.join(root, 'reset-'));
  await fs.writeFile(path.join(stage, 'previous.sav'), 'original-world');
  await fs.mkdir(f.journal, { recursive: true });
  const file = path.join(f.journal, `${randomUUID()}.json`);
  await fs.writeFile(file, JSON.stringify({ version: 1, stage, state, recoverable }));
  return { stage, file };
}

test('完成后删除操作目录、空事务根目录及清理记录目录', async t => {
  const f = await fixture(t);
  const stage = await createTransaction(f.directory, f.directory, 'reset-');
  await fs.writeFile(path.join(stage, 'previous.sav'), 'old-world');
  await finishTransaction(stage);
  await absent(f.root);
  await absent(f.journal);
});

test('并发操作只清理自己的目录，最后一个操作结束后清理空父目录', async t => {
  const f = await fixture(t);
  const [first, second] = await Promise.all([createTransaction(f.directory, f.directory, 'reset-'), createTransaction(f.directory, f.directory, '.official-export-')]);
  await fs.writeFile(path.join(second, 'download'), 'in-use');
  await finishTransaction(first);
  await cleanupTransactions(f.directory, { startup: true });
  assert.equal(await fs.readFile(path.join(second, 'download'), 'utf8'), 'in-use');
  await finishTransaction(second);
  await absent(f.root);
  await absent(f.journal);
});

test('清理失败不改变已提交结果，仅尝试一次并在下次启动清理', async t => {
  const f = await fixture(t);
  const stage = await createTransaction(f.directory, f.directory, 'reset-');
  const remove = fs.rm;
  const mock = t.mock.method(fs, 'rm', async (file, ...args) => {
    if (file === stage) throw Object.assign(new Error('disk busy'), { code: 'EBUSY' });
    return remove(file, ...args);
  });
  const errors = [];
  await finishTransaction(stage, { onCleanupError: error => errors.push(error.message) });
  assert.match(errors[0], /disk busy.*暂存目录/);
  const [record] = await fs.readdir(f.journal);
  const saved = JSON.parse(await fs.readFile(path.join(f.journal, record)));
  assert.equal(saved.state, 'cleanup');
  assert.equal(saved.attempts, undefined);
  assert.equal(saved.nextAttemptAt, undefined);
  assert.equal(mock.mock.callCount(), 1);
  assert.equal(errors.length, 1);
  mock.mock.restore();
  await cleanupTransactions(f.directory, { startup: true });
  await absent(stage);
  await absent(f.root);
  await absent(f.journal);
});

test('重启清理已完成事务和中断的只读暂存，包括存档盘目录', async t => {
  const f = await fixture(t);
  const targetRoot = path.join(f.directory, 'server/Pal/Saved/SaveGames/0/.palbox-transactions');
  await interrupted(f, { state: 'cleanup', root: targetRoot });
  await interrupted(f, { recoverable: false });
  await cleanupTransactions(f.directory, { startup: true });
  await absent(targetRoot);
  await absent(f.root);
  await absent(f.journal);
});

test('空父目录删除失败只尝试一次，下次启动再清理', async t => {
  const f = await fixture(t);
  const stage = await createTransaction(f.directory, f.directory, 'reset-');
  const rmdir = fs.rmdir;
  const mock = t.mock.method(fs, 'rmdir', async (file, ...args) => {
    if (file === f.root) throw Object.assign(new Error('parent busy'), { code: 'EBUSY' });
    return rmdir(file, ...args);
  });
  const errors = [];
  await finishTransaction(stage, { onCleanupError: error => errors.push(error.message) });
  await absent(stage);
  assert.match(errors[0], /parent busy/);
  assert.deepEqual(await fs.readdir(f.root), []);
  assert.equal(mock.mock.callCount(), 1);
  assert.equal(errors.length, 1);
  mock.mock.restore();
  await cleanupTransactions(f.directory, { startup: true });
  await absent(f.root);
  await absent(f.journal);
});

test('清理状态写入失败不重试，下次启动保留可能的原数据副本', async t => {
  const f = await fixture(t);
  const stage = await createTransaction(f.directory, f.directory, 'reset-');
  const rename = fs.rename;
  const mock = t.mock.method(fs, 'rename', async (from, to) => {
    if (path.dirname(to) === f.journal) throw new Error('journal write failed');
    return rename(from, to);
  });
  syncBuiltinESMExports();
  t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
  const errors = [];
  await finishTransaction(stage, { onCleanupError: error => errors.push(error.message) });
  assert.match(errors[0], /journal write failed/);
  const [record] = await fs.readdir(f.journal);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.journal, record))).state, 'active');
  assert.equal(mock.mock.callCount(), 1);
  assert.equal(errors.length, 1);
  mock.mock.restore();
  syncBuiltinESMExports();
  await cleanupTransactions(f.directory, { startup: true });
  const [saved] = await fs.readdir(f.journal);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.journal, saved))).state, 'recovery');
  assert.equal((await fs.lstat(stage)).isDirectory(), true);
});

test('写操作中断或回滚失败时标记保留副本，普通清理不会删除', async t => {
  const f = await fixture(t);
  const { stage, file } = await interrupted(f);
  const errors = [];
  await cleanupTransactions(f.directory, { startup: true, onCleanupError: error => errors.push(error.message) });
  assert.match(errors[0], /副本已保留/);
  assert.equal(JSON.parse(await fs.readFile(file)).state, 'recovery');
  const failed = await createTransaction(f.directory, f.directory, 'reset-');
  await fs.writeFile(path.join(failed, 'original.sav'), 'rollback-failed');
  await finishTransaction(failed, { preserve: true });
  await cleanupTransactions(f.directory);
  assert.equal(await fs.readFile(path.join(stage, 'previous.sav'), 'utf8'), 'original-world');
  assert.equal(await fs.readFile(path.join(failed, 'original.sav'), 'utf8'), 'rollback-failed');
  // Removing a manually recovered copy also releases its bookkeeping.
  await fs.rm(stage, { recursive: true });
  await fs.rm(failed, { recursive: true });
  await cleanupTransactions(f.directory);
  await absent(f.root);
  await absent(f.journal);
});

test('启动忽略旧重试计数，清理失败只执行一次并保留完成状态', async t => {
  const f = await fixture(t);
  const { stage, file } = await interrupted(f, { state: 'exhausted' });
  const original = JSON.parse(await fs.readFile(file));
  await fs.writeFile(file, JSON.stringify({ ...original, attempts: 3, nextAttemptAt: Date.now() + 86_400_000, lastError: 'old failure' }));
  const remove = fs.rm;
  const mock = t.mock.method(fs, 'rm', async (target, ...args) => {
    if (target === stage) throw new Error('disk busy');
    return remove(target, ...args);
  });
  const errors = [];
  await cleanupTransactions(f.directory, { startup: true, onCleanupError: error => errors.push(error.message) });
  assert.equal(mock.mock.callCount(), 1);
  assert.equal(errors.length, 1);
  const saved = JSON.parse(await fs.readFile(file));
  assert.equal(saved.state, 'cleanup');
  assert.equal(saved.attempts, undefined);
  assert.equal(saved.nextAttemptAt, undefined);
  mock.mock.restore();
  await cleanupTransactions(f.directory, { startup: true });
  await absent(f.root);
  await absent(f.journal);
});

test('孤立临时记录删除失败只记录一次，保留到下次启动检查', async t => {
  const f = await fixture(t);
  await fs.mkdir(f.journal, { recursive: true });
  const temporary = path.join(f.journal, `${randomUUID()}.json.${randomUUID()}.tmp`);
  await fs.writeFile(temporary, 'interrupted');
  const remove = fs.rm;
  const mock = t.mock.method(fs, 'rm', async (file, ...args) => {
    if (file === temporary) throw new Error('temporary file busy');
    return remove(file, ...args);
  });
  const errors = [];
  await cleanupTransactions(f.directory, { startup: true, onCleanupError: error => errors.push(error.message) });
  assert.equal(mock.mock.callCount(), 1);
  assert.equal(errors.length, 1);
  assert.equal((await fs.readdir(f.journal)).length, 1);
  mock.mock.restore();
  await cleanupTransactions(f.directory, { startup: true });
  await absent(f.journal);
});

test('旧版本的空父目录和普通暂存会清理，原数据副本会登记保留', async t => {
  const f = await fixture(t);
  const empty = path.join(f.directory, 'server/Pal/Saved/SaveGames/0/.palbox-transactions');
  await fs.mkdir(empty, { recursive: true });
  await fs.mkdir(path.join(f.root, 'backup-obsolete'), { recursive: true });
  await fs.writeFile(path.join(f.root, 'backup-obsolete/archive'), 'disposable');
  await fs.mkdir(path.join(f.root, 'reset-old/previous'), { recursive: true });
  await fs.writeFile(path.join(f.root, 'reset-old/previous/Level.sav'), 'original');
  await cleanupTransactions(f.directory, { startup: true });
  await absent(empty);
  await absent(path.join(f.root, 'backup-obsolete'));
  assert.equal(await fs.readFile(path.join(f.root, 'reset-old/previous/Level.sav'), 'utf8'), 'original');
  const [record] = await fs.readdir(f.journal);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.journal, record))).state, 'recovery');
});

test('清理拒绝数据目录外路径和被替换为链接的父目录', async t => {
  const f = await fixture(t);
  const outside = await fs.mkdtemp(path.join(tmpdir(), 'palbox-cleanup-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const externalRoot = path.join(outside, '.palbox-transactions');
  const external = await interrupted(f, { state: 'cleanup', root: externalRoot });
  await fs.symlink(outside, path.join(f.directory, 'server'));
  const linked = await interrupted(f, { state: 'cleanup', root: path.join(outside, 'nested/.palbox-transactions') });
  const record = JSON.parse(await fs.readFile(linked.file));
  record.stage = path.join(f.directory, 'server/nested/.palbox-transactions', path.basename(linked.stage));
  await fs.writeFile(linked.file, JSON.stringify(record));
  const errors = [];
  await cleanupTransactions(f.directory, { startup: true, onCleanupError: error => errors.push(error.message) });
  assert.ok(errors.some(message => message.includes('不在数据目录内')));
  assert.ok(errors.some(message => message.includes('不能包含链接')));
  assert.equal(await fs.readFile(path.join(external.stage, 'previous.sav'), 'utf8'), 'original-world');
  assert.equal(await fs.readFile(path.join(linked.stage, 'previous.sav'), 'utf8'), 'original-world');
});

test('清理记录目录为链接时不在链接目标创建或删除任何文件', async t => {
  const f = await fixture(t);
  const outside = await fs.mkdtemp(path.join(tmpdir(), 'palbox-journal-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.mkdir(path.dirname(f.journal), { recursive: true });
  await fs.symlink(outside, f.journal);
  const errors = [];
  await cleanupTransactions(f.directory, { startup: true, onCleanupError: error => errors.push(error.message) });
  assert.ok(errors.some(message => message.includes('不能包含链接')));
  assert.deepEqual(await fs.readdir(outside), []);
  assert.equal((await fs.lstat(f.journal)).isSymbolicLink(), true);
});
