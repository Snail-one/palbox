import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, utimes, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { managementFixture } from '../helpers/management-fixture.js';

const run = promisify(execFile);
const saved = f => f.runtime.saved;

async function archive(base, entries) {
  const source = path.join(base, 'source');
  const target = path.join(base, 'import.tar.gz');
  for (const [name, content] of Object.entries(entries)) {
    const file = path.join(source, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  await run('tar', ['-czf', target, '-C', source, '.']);
  return readFile(target);
}

async function waitTask(f, action, payload) {
  const task = await f.task(action, payload);
  assert.equal(task.state, 'succeeded', task.message);
  return task;
}

test('导入根目录官方快照并恢复运行中的世界', { skip: process.platform !== 'linux' }, async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  const tmp = await mkdtemp(path.join(tmpdir(), 'palbox-import-')); t.after(() => rm(tmp, { recursive: true, force: true }));
  const world = path.join(saved(f), 'SaveGames/0/ACTIVE');
  await mkdir(path.join(world, 'Players'), { recursive: true });
  await mkdir(path.join(world, 'backup/world/2026.01.01-00.00.00'), { recursive: true });
  await writeFile(path.join(world, 'Level.sav'), 'old-world');
  await writeFile(path.join(world, 'LevelMeta.sav'), 'old-meta');
  await writeFile(path.join(world, 'WorldOption.sav'), 'keep-option');
  await writeFile(path.join(world, 'Players/old.sav'), 'old-player');
  await writeFile(path.join(world, 'backup/world/2026.01.01-00.00.00/Level.sav'), 'history');
  assert.equal((await f.task('install')).state, 'succeeded');
  assert.equal((await f.task('start')).state, 'succeeded');
  const config = await readFile(f.runtime.config);
  const oldPid = f.runtime.game.pid;
  const bytes = await archive(tmp, {
    'Level.sav': 'new-world',
    'LevelMeta.sav': 'new-meta',
    'Players/new.sav': 'new-player'
  });
  const response = await f.upload('/api/save-import', bytes);
  assert.equal(response.status, 201);
  const staged = await response.json();
  assert.equal(staged.layout, 'root');
  assert.equal(staged.worldId, null);
  await waitTask(f, 'import-save', { id: staged.id });
  assert.equal(await readFile(path.join(world, 'Level.sav'), 'utf8'), 'new-world');
  assert.equal(await readFile(path.join(world, 'Players/new.sav'), 'utf8'), 'new-player');
  await assert.rejects(access(path.join(world, 'Players/old.sav')), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(world, 'WorldOption.sav'), 'utf8'), 'keep-option');
  assert.equal(await readFile(path.join(world, 'backup/world/2026.01.01-00.00.00/Level.sav'), 'utf8'), 'history');
  assert.deepEqual(await readFile(f.runtime.config), config);
  assert.equal(f.runtime.ready, true);
  assert.notEqual(f.runtime.game.pid, oldPid);
  const backups = await f.manager.backups();
  assert.equal(backups.length, 1);
  assert.equal(backups[0].category, 'before-import');
  assert.deepEqual(await readdir(path.join(f.directory, 'palbox/imports')), []);
  assert.equal((await f.task('stop')).state, 'succeeded');
});

test('支持 SaveGames 布局，停服导入后保持停止', { skip: process.platform !== 'linux' }, async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  const tmp = await mkdtemp(path.join(tmpdir(), 'palbox-import-')); t.after(() => rm(tmp, { recursive: true, force: true }));
  const world = path.join(saved(f), 'SaveGames/0/WORLDID');
  await mkdir(world, { recursive: true });
  await writeFile(path.join(world, 'Level.sav'), 'old');
  await writeFile(path.join(world, 'LevelMeta.sav'), 'old');
  assert.equal((await f.task('install')).state, 'succeeded');
  const bytes = await archive(tmp, {
    'SaveGames/0/WORLDID/Level.sav': 'imported',
    'SaveGames/0/WORLDID/LevelMeta.sav': 'imported-meta',
    'SaveGames/0/WORLDID/Players/p.sav': 'player'
  });
  const staged = await (await f.upload('/api/save-import', bytes)).json();
  assert.equal(staged.layout, 'savegames');
  assert.equal(staged.worldId, 'WORLDID');
  await waitTask(f, 'import-save', { id: staged.id });
  assert.equal(await readFile(path.join(world, 'Level.sav'), 'utf8'), 'imported');
  assert.equal(f.runtime.game, null);
});

test('没有世界时使用存档 ID 或生成世界 ID', { skip: process.platform !== 'linux' }, async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  const tmp = await mkdtemp(path.join(tmpdir(), 'palbox-import-')); t.after(() => rm(tmp, { recursive: true, force: true }));
  assert.equal((await f.task('install')).state, 'succeeded');
  const bytes = await archive(tmp, { 'Level.sav': 'a', 'LevelMeta.sav': 'b' });
  const staged = await (await f.upload('/api/save-import', bytes)).json();
  await waitTask(f, 'import-save', { id: staged.id });
  const worlds = await readdir(path.join(saved(f), 'SaveGames/0'));
  assert.equal(worlds.length, 1);
  assert.match(worlds[0], /^[A-F0-9]{32}$/);
  assert.equal(await readFile(path.join(saved(f), 'SaveGames/0', worlds[0], 'Level.sav'), 'utf8'), 'a');
});

test('多个世界且没有活动世界时拒绝导入', { skip: process.platform !== 'linux' }, async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  const tmp = await mkdtemp(path.join(tmpdir(), 'palbox-import-')); t.after(() => rm(tmp, { recursive: true, force: true }));
  for (const id of ['ONE', 'TWO']) {
    await mkdir(path.join(saved(f), 'SaveGames/0', id), { recursive: true });
    await writeFile(path.join(saved(f), 'SaveGames/0', id, 'Level.sav'), id);
  }
  assert.equal((await f.task('install')).state, 'succeeded');
  const bytes = await archive(tmp, { 'Level.sav': 'new', 'LevelMeta.sav': 'new' });
  const staged = await (await f.upload('/api/save-import', bytes)).json();
  const task = await f.task('import-save', { id: staged.id });
  assert.equal(task.state, 'failed');
  assert.match(task.message, /无法确定当前世界/);
  assert.equal(await readFile(path.join(saved(f), 'SaveGames/0/ONE/Level.sav'), 'utf8'), 'ONE');
  assert.equal(await readFile(path.join(saved(f), 'SaveGames/0/TWO/Level.sav'), 'utf8'), 'TWO');
});

test('拒绝无效上传、恶意归档和非法 ID', { skip: process.platform !== 'linux' }, async t => {
  const f = await managementFixture({ importLimits: { maxCompressedBytes: 1024 * 1024, maxEntries: 20 } }); t.after(() => f.close()); await f.login();
  const tmp = await mkdtemp(path.join(tmpdir(), 'palbox-import-')); t.after(() => rm(tmp, { recursive: true, force: true }));
  assert.equal((await f.upload('/api/save-import', Buffer.from('nope'), { authenticated: false })).status, 401);
  assert.equal((await f.upload('/api/save-import', Buffer.from('nope'), { headers: { 'X-Palbox-CSRF': 'bad' } })).status, 403);
  assert.equal((await f.upload('/api/save-import', Buffer.from('nope'), { contentType: 'text/plain' })).status, 415);
  assert.equal((await f.upload('/api/save-import', Buffer.from('nope'))).status, 400);
  const bytes = await archive(tmp, { 'Level.sav': 'a', 'LevelMeta.sav': 'b' });
  const linkBase = path.join(tmp, 'links');
  await mkdir(linkBase, { recursive: true });
  await writeFile(path.join(linkBase, 'Level.sav'), 'a');
  await writeFile(path.join(linkBase, 'LevelMeta.sav'), 'b');
  await run('ln', ['-s', '/etc/passwd', path.join(linkBase, 'link')]);
  const linkArchive = path.join(tmp, 'link.tar.gz');
  await run('tar', ['-czf', linkArchive, '-C', linkBase, '.']);
  assert.equal((await f.upload('/api/save-import', await readFile(linkArchive))).status, 400);
  const staged = await (await f.upload('/api/save-import', bytes)).json();
  assert.equal((await f.task('import-save', { id: '../../etc/passwd' })).state, 'failed');
  assert.equal((await f.upload('/api/save-import', Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.alloc(2 * 1024 * 1024)]))).status, 413);
  assert.ok(staged.id);
});

test('初始化清理过期的导入暂存', { skip: process.platform !== 'linux' }, async t => {
  const f = await managementFixture(); t.after(() => f.close());
  const root = path.join(f.directory, 'palbox/imports');
  const old = path.join(root, '00000000-0000-4000-8000-000000000000');
  await mkdir(old, { recursive: true });
  const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await utimes(old, past, past);
  await f.manager.imports.cleanup();
  await assert.rejects(access(old), { code: 'ENOENT' });
});
