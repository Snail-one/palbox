import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, readdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NativeBackups } from '../../backend/management/native-backups.js';
import { Manager } from '../../backend/management/manager.js';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-reset-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const saved = path.join(directory, 'Saved');
  const native = new NativeBackups(saved, directory);
  return { directory, saved, native };
}

test('重置拒绝父目录链接，0 内的链接只移除链接本身', async t => {
  for (const parent of ['Saved', 'Saved/SaveGames', 'Saved/SaveGames/0']) {
    const { directory, native } = await fixture(t);
    const outside = path.join(directory, 'outside'); await mkdir(outside);
    await writeFile(path.join(outside, 'keep'), 'outside');
    const link = path.join(directory, parent); await mkdir(path.dirname(link), { recursive: true });
    await symlink(outside, link, 'dir');
    await assert.rejects(native.clearWorld('WORLD', () => {}), /存档目录不能包含链接/);
    assert.equal(await readFile(path.join(outside, 'keep'), 'utf8'), 'outside');
  }
  const { directory, saved, native } = await fixture(t);
  const outside = path.join(directory, 'outside'); await mkdir(outside);
  await writeFile(path.join(outside, 'keep'), 'outside');
  const root = path.join(saved, 'SaveGames/0/WORLD'); await mkdir(root, { recursive: true });
  await symlink(outside, path.join(root, 'linked-world'), 'dir');
  assert.equal(await native.clearWorld('WORLD', () => {}), 1);
  assert.deepEqual(await readdir(root), []);
  assert.equal(await readFile(path.join(outside, 'keep'), 'utf8'), 'outside');
});

test('删除前再次检查游戏状态，检查期间启动则保留存档', async t => {
  const { directory, saved, native } = await fixture(t);
  const file = path.join(saved, 'SaveGames/0/WORLD/Level.sav');
  await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, 'keep');
  const manager = new Manager({ directory, runtime: { saved, game: null } });
  const locate = native.safeDirectory.bind(native);
  native.safeDirectory = async parts => { const root = await locate(parts); manager.runtime.game = {}; return root; };
  await assert.rejects(native.clearWorld('WORLD', () => manager.requireResetAllowed({ confirmation: 'delete' })), { status: 409 });
  assert.equal(await readFile(file, 'utf8'), 'keep');
});

test('没有存档目录时重置成功，不创建占位目录', async t => {
  const { saved, native } = await fixture(t);
  assert.equal(await native.clearWorld('WORLD', () => {}), 0);
  await assert.rejects(access(saved), { code: 'ENOENT' });
});
