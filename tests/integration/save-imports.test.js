import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, utimes, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { parse } from '../../shared/domain/config.js';
import { managementFixture } from '../helpers/management-fixture.js';

const run = promisify(execFile);
const saved = f => f.runtime.saved;
const sevenZip = ['7zz', '7z'].find(name => spawnSync(name, ['i'], { stdio: 'ignore' }).status === 0);

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
  const selection = path.join(saved(f), 'Config/LinuxServer/GameUserSettings.ini');
  await writeFile(selection, 'DedicatedServerName=ACTIVE\n');
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
  await rm(selection);
  const missingSelection = await f.task('import-save', { id: staged.id });
  assert.equal(missingSelection.state, 'failed');
  assert.match(missingSelection.message, /GameUserSettings\.ini/);
  assert.equal(f.runtime.game.pid, oldPid, '缺少世界 ID 时不停止正在运行的游戏');
  assert.equal(await readFile(path.join(world, 'Level.sav'), 'utf8'), 'old-world');
  await writeFile(selection, 'DedicatedServerName=ACTIVE\n');
  const retry = await (await f.upload('/api/save-import', bytes)).json();
  await waitTask(f, 'import-save', { id: retry.id });
  assert.equal(await readFile(path.join(world, 'Level.sav'), 'utf8'), 'new-world');
  assert.equal(await readFile(path.join(world, 'Players/new.sav'), 'utf8'), 'new-player');
  await assert.rejects(access(path.join(world, 'Players/old.sav')), { code: 'ENOENT' });
  await assert.rejects(access(path.join(world, 'WorldOption.sav')), { code: 'ENOENT' });
  await assert.rejects(access(path.join(world, 'backup')), { code: 'ENOENT' });
  assert.deepEqual(await readFile(f.runtime.config), config);
  assert.equal(f.runtime.ready, true);
  assert.notEqual(f.runtime.game.pid, oldPid);
  const backups = await f.manager.backups();
  assert.equal(backups.length, 1);
  assert.equal(backups[0].category, 'before-import');
  assert.deepEqual(await readdir(path.join(f.directory, 'palbox/imports')), []);
  assert.equal((await f.task('stop')).state, 'succeeded');
});

test('SaveGames 布局导入到游戏当前 ID，不创建归档中的世界 ID，保持停服', { skip: process.platform !== 'linux' }, async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  const tmp = await mkdtemp(path.join(tmpdir(), 'palbox-import-')); t.after(() => rm(tmp, { recursive: true, force: true }));
  const world = path.join(saved(f), 'SaveGames/0/WORLDID');
  await mkdir(world, { recursive: true });
  await writeFile(path.join(world, 'Level.sav'), 'old');
  await writeFile(path.join(world, 'LevelMeta.sav'), 'old');
  assert.equal((await f.task('install')).state, 'succeeded');
  await writeFile(path.join(saved(f), 'Config/LinuxServer/GameUserSettings.ini'), 'DedicatedServerName=WORLDID\n');
  const bytes = await archive(tmp, {
    'SaveGames/0/ARCHIVEID/Level.sav': 'imported',
    'SaveGames/0/ARCHIVEID/LevelMeta.sav': 'imported-meta',
    'SaveGames/0/ARCHIVEID/Players/p.sav': 'player',
    'SaveGames/0/ARCHIVEID/backup/world/history/Level.sav': 'imported-history',
    'SaveGames/0/ARCHIVEID/extra/data.txt': 'extra-content',
    'SaveGames/0/ARCHIVEID/empty.txt': ''
  });
  const staged = await (await f.upload('/api/save-import', bytes)).json();
  assert.equal(staged.layout, 'savegames');
  assert.equal(staged.worldId, 'ARCHIVEID');
  await waitTask(f, 'import-save', { id: staged.id });
  assert.equal(await readFile(path.join(world, 'Level.sav'), 'utf8'), 'imported');
  assert.equal(await readFile(path.join(world, 'backup/world/history/Level.sav'), 'utf8'), 'imported-history');
  assert.equal(await readFile(path.join(world, 'extra/data.txt'), 'utf8'), 'extra-content');
  assert.equal(await readFile(path.join(world, 'empty.txt'), 'utf8'), '');
  assert.deepEqual(await readdir(path.dirname(world)), ['WORLDID']);
  assert.equal(f.runtime.game, null);
});

test('未知当前世界 ID 时拒绝导入；已有游戏配置 ID 时使用该 ID 恢复', { skip: process.platform !== 'linux' }, async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  const tmp = await mkdtemp(path.join(tmpdir(), 'palbox-import-')); t.after(() => rm(tmp, { recursive: true, force: true }));
  assert.equal((await f.task('install')).state, 'succeeded');
  for (const entries of [{ 'Level.sav': 'a', 'LevelMeta.sav': 'b' }, { 'SaveGames/0/ARCHIVEID/Level.sav': 'a', 'SaveGames/0/ARCHIVEID/LevelMeta.sav': 'b' }]) {
    await rm(path.join(tmp, 'source'), { recursive: true, force: true });
    const bytes = await archive(tmp, entries);
    const staged = await (await f.upload('/api/save-import', bytes)).json();
    const task = await f.task('import-save', { id: staged.id });
    assert.equal(task.state, 'failed');
    assert.match(task.message, /无法确定游戏运行的世界 ID/);
    await assert.rejects(readdir(path.join(saved(f), 'SaveGames/0')), { code: 'ENOENT' });
  }
  await writeFile(path.join(saved(f), 'Config/LinuxServer/GameUserSettings.ini'), 'DedicatedServerName=GAMEID\n');
  const bytes = await archive(tmp, { 'SaveGames/0/ARCHIVEID/Level.sav': 'a', 'SaveGames/0/ARCHIVEID/LevelMeta.sav': 'b' });
  const staged = await (await f.upload('/api/save-import', bytes)).json();
  await waitTask(f, 'import-save', { id: staged.id });
  assert.deepEqual(await readdir(path.join(saved(f), 'SaveGames/0')), ['GAMEID']);
  assert.equal(await readFile(path.join(saved(f), 'SaveGames/0/GAMEID/Level.sav'), 'utf8'), 'a');
});

test('完整备份整体替换 Saved，恢复多个世界和配置，保持原运行状态', async t => {
  for (const running of [false, true]) await t.test(running ? '运行中导入后重新启动' : '停服导入后保持停止', async t => {
    const f = await managementFixture(); t.after(() => f.close()); await f.login();
    const tmp = await mkdtemp(path.join(tmpdir(), 'palbox-full-import-')); t.after(() => rm(tmp, { recursive: true, force: true }));
    await waitTask(f, 'install');
    const oldConfig = await readFile(f.runtime.config, 'utf8');
    const oldWorld = path.join(saved(f), 'SaveGames/0/OLD');
    await mkdir(oldWorld, { recursive: true });
    await writeFile(path.join(oldWorld, 'Level.sav'), 'old-world');
    await writeFile(path.join(saved(f), 'old-only.txt'), 'remove-me');
    // Full imports do not depend on the current server having a world ID.
    if (running) await waitTask(f, 'start');
    const oldPid = f.runtime.game?.pid;
    const importedConfig = oldConfig + '\n; imported-full-backup\n';
    const bytes = await archive(tmp, {
      'Pal/Saved/Config/LinuxServer/PalWorldSettings.ini': importedConfig,
      'Pal/Saved/Config/LinuxServer/GameUserSettings.ini': 'DedicatedServerName=IMPORTED\n',
      'Pal/Saved/SaveGames/0/IMPORTED/Level.sav': 'imported-world',
      'Pal/Saved/SaveGames/0/IMPORTED/LevelMeta.sav': 'imported-meta',
      'Pal/Saved/SaveGames/0/IMPORTED/Players/new.sav': 'imported-player',
      'Pal/Saved/SaveGames/0/IMPORTED/backup/world/history/Level.sav': 'imported-history',
      'Pal/Saved/SaveGames/0/SECOND/Level.sav': 'second-world',
      'Pal/Saved/Logs/previous.log': 'archived-log',
      'Pal/Saved/SaveGames/banlist.txt': 'steam_archived\n',
      'Pal/Saved/extra/empty.txt': ''
    });
    const upload = await f.upload('/api/save-import', bytes);
    assert.equal(upload.status, 201, await upload.clone().text());
    const staged = await upload.json();
    assert.equal(staged.kind, 'full');
    assert.equal(staged.worldId, 'IMPORTED');
    const task = await waitTask(f, 'import-save', { id: staged.id });
    assert.deepEqual(await readdir(path.join(saved(f), 'SaveGames/0')), ['IMPORTED', 'SECOND']);
    await assert.rejects(access(path.join(saved(f), 'old-only.txt')), { code: 'ENOENT' });
    const managedPassword = parse(f.manager.store.workspace.profiles.find(profile => profile.locked).initialSource).entries.find(entry => entry.key === 'AdminPassword').raw;
    const disk = await readFile(f.runtime.config, 'utf8');
    const diskValues = new Map(parse(disk).entries.map(entry => [entry.key, entry.raw]));
    const importedValues = new Map(parse(importedConfig).entries.map(entry => [entry.key, entry.raw]));
    assert.equal(disk, f.manager.store.active().source);
    assert.equal(f.manager.store.active().name, '游戏默认配置');
    assert.equal(diskValues.get('ExpRate'), importedValues.get('ExpRate'));
    assert.equal(diskValues.get('AdminPassword'), managedPassword);
    assert.notEqual(diskValues.get('AdminPassword'), importedValues.get('AdminPassword'));
    assert.equal(diskValues.get('RESTAPIEnabled'), 'True');
    assert.equal(await readFile(path.join(saved(f), 'SaveGames/0/IMPORTED/backup/world/history/Level.sav'), 'utf8'), 'imported-history');
    assert.equal(await readFile(path.join(saved(f), 'Logs/previous.log'), 'utf8'), 'archived-log');
    assert.equal(await readFile(path.join(saved(f), 'SaveGames/banlist.txt'), 'utf8'), 'steam_archived\n');
    assert.equal(await readFile(path.join(saved(f), 'extra/empty.txt'), 'utf8'), '');
    const before = await f.runtime.run('tar', ['-xOzf', f.manager.backupFile(task.backup), '--', 'OLD/Level.sav']);
    assert.equal(before, 'old-world');
    assert.equal(Boolean(f.runtime.game), running);
    if (running) { assert.notEqual(f.runtime.game.pid, oldPid); assert.equal(f.runtime.ready, true); }
    assert.deepEqual(await readdir(path.join(f.directory, 'palbox/imports')), []);
  });
});

test('世界包不含 Players 时清除旧玩家，保留世界外的配置和其他世界', async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  const tmp = await mkdtemp(path.join(tmpdir(), 'palbox-world-import-')); t.after(() => rm(tmp, { recursive: true, force: true }));
  await waitTask(f, 'install');
  const world = path.join(saved(f), 'SaveGames/0/CURRENT');
  await mkdir(path.join(world, 'Players'), { recursive: true });
  await writeFile(path.join(world, 'Level.sav'), 'old');
  await writeFile(path.join(world, 'Players/old.sav'), 'old-player');
  await mkdir(path.join(saved(f), 'SaveGames/0/OTHER'), { recursive: true });
  await writeFile(path.join(saved(f), 'SaveGames/0/OTHER/Level.sav'), 'other-world');
  await writeFile(path.join(saved(f), 'Config/LinuxServer/GameUserSettings.ini'), 'DedicatedServerName=CURRENT\n');
  const config = await readFile(f.runtime.config);
  const bytes = await archive(tmp, { 'SOURCE/Level.sav': 'new', 'SOURCE/LevelMeta.sav': 'meta' });
  const upload = await f.upload('/api/save-import', bytes);
  assert.equal(upload.status, 201);
  const staged = await upload.json();
  assert.equal(staged.kind, 'world');
  await waitTask(f, 'import-save', { id: staged.id });
  assert.deepEqual(await readdir(world), ['Level.sav', 'LevelMeta.sav']);
  assert.equal(await readFile(path.join(saved(f), 'SaveGames/0/OTHER/Level.sav'), 'utf8'), 'other-world');
  assert.deepEqual(await readFile(f.runtime.config), config);
  assert.equal(await f.manager.targetWorld(), 'CURRENT');
});

test('世界包旁的配置按官方默认导入到游戏默认配置，存档仍只替换当前世界', async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  const tmp = await mkdtemp(path.join(tmpdir(), 'palbox-import-config-')); t.after(() => rm(tmp, { recursive: true, force: true }));
  await waitTask(f, 'install');
  const world = path.join(saved(f), 'SaveGames/0/CURRENT');
  await mkdir(path.join(world, 'Players'), { recursive: true });
  await writeFile(path.join(world, 'Level.sav'), 'old');
  await writeFile(path.join(world, 'Players/old.sav'), 'old-player');
  await mkdir(path.join(saved(f), 'SaveGames/0/OTHER'), { recursive: true });
  await writeFile(path.join(saved(f), 'SaveGames/0/OTHER/Level.sav'), 'other-world');
  await writeFile(path.join(saved(f), 'Config/LinuxServer/GameUserSettings.ini'), 'DedicatedServerName=CURRENT\n');
  await writeFile(path.join(saved(f), 'outside.txt'), 'keep');
  const bytes = await archive(tmp, {
    'SOURCE/Level.sav': 'new',
    'SOURCE/LevelMeta.sav': 'meta',
    'Config/LinuxServer/PalWorldSettings.ini': '[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(RESTAPIEnabled=False,AdminPassword="imported-secret",ExpRate=7.500000)\n'
  });
  const managedPassword = parse(f.manager.store.workspace.profiles.find(profile => profile.locked).initialSource).entries.find(entry => entry.key === 'AdminPassword').raw;
  const upload = await f.upload('/api/save-import', bytes);
  assert.equal(upload.status, 201, await upload.clone().text());
  const staged = await upload.json();
  assert.equal(staged.kind, 'world');
  assert.equal(staged.hasConfiguration, true);
  await waitTask(f, 'import-save', { id: staged.id });
  assert.equal(await readFile(path.join(world, 'Level.sav'), 'utf8'), 'new');
  assert.equal(await readFile(path.join(saved(f), 'SaveGames/0/OTHER/Level.sav'), 'utf8'), 'other-world');
  assert.equal(await readFile(path.join(saved(f), 'outside.txt'), 'utf8'), 'keep');
  assert.equal(await readFile(path.join(saved(f), 'Config/LinuxServer/GameUserSettings.ini'), 'utf8'), 'DedicatedServerName=CURRENT\n');
  const disk = await readFile(f.runtime.config, 'utf8');
  const settings = new Map(parse(disk).entries.map(entry => [entry.key, entry.raw]));
  assert.equal(f.manager.store.active().name, '游戏默认配置');
  assert.equal(disk, f.manager.store.active().source);
  assert.equal(settings.get('ExpRate'), '7.500000');
  assert.equal(settings.get('RESTAPIEnabled'), 'True');
  assert.equal(settings.get('DayTimeSpeedRate'), '1.000000');
  assert.equal(settings.get('AdminPassword'), managedPassword);
  assert.notEqual(settings.get('AdminPassword'), '"imported-secret"');
});

test('完整备份配置无效时上传失败，不停止游戏或替换现有内容', async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  const tmp = await mkdtemp(path.join(tmpdir(), 'palbox-invalid-full-')); t.after(() => rm(tmp, { recursive: true, force: true }));
  await waitTask(f, 'install'); await waitTask(f, 'start');
  const pid = f.runtime.game.pid;
  const bytes = await archive(tmp, {
    'Pal/Saved/Config/LinuxServer/PalWorldSettings.ini': await readFile(f.runtime.config, 'utf8'),
    'Pal/Saved/Config/LinuxServer/GameUserSettings.ini': 'DedicatedServerName=MISSING\n',
    'Pal/Saved/SaveGames/0/WORLD/Level.sav': 'world'
  });
  const response = await f.upload('/api/save-import', bytes);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /世界 ID/);
  assert.equal(f.runtime.game.pid, pid);
  assert.deepEqual(await f.manager.backups(), []);
});

test('没有 GameUserSettings 世界 ID 时拒绝从目录推断导入目标', { skip: process.platform !== 'linux' }, async t => {
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
  assert.match(task.message, /GameUserSettings\.ini/);
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

test('zip 和 7z 世界包替换当前世界，保留其他世界', { skip: process.platform !== 'linux' ? '仅 Linux' : !sevenZip ? '需要系统 7zip（7z 或 7zz）' : false }, async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  const tmp = await mkdtemp(path.join(tmpdir(), 'palbox-zip-import-')); t.after(() => rm(tmp, { recursive: true, force: true }));
  await waitTask(f, 'install');
  const world = path.join(saved(f), 'SaveGames/0/CURRENT');
  await mkdir(path.join(world, 'Players'), { recursive: true });
  await writeFile(path.join(world, 'Level.sav'), 'old');
  await writeFile(path.join(world, 'Players/old.sav'), 'old-player');
  await mkdir(path.join(saved(f), 'SaveGames/0/OTHER'), { recursive: true });
  await writeFile(path.join(saved(f), 'SaveGames/0/OTHER/Level.sav'), 'other-world');
  await writeFile(path.join(saved(f), 'Config/LinuxServer/GameUserSettings.ini'), 'DedicatedServerName=CURRENT\n');
  for (const format of ['zip', '7z']) {
    const source = path.join(tmp, format);
    await mkdir(path.join(source, 'Players'), { recursive: true });
    await writeFile(path.join(source, 'Level.sav'), `${format}-world`);
    await writeFile(path.join(source, 'LevelMeta.sav'), `${format}-meta`);
    await writeFile(path.join(source, 'Players/new.sav'), `${format}-player`);
    const archive = path.join(tmp, `world.${format}`);
    await run(sevenZip, ['a', `-t${format}`, '-bso0', '-bd', archive, 'Level.sav', 'LevelMeta.sav', 'Players/new.sav'], { cwd: source });
    const type = format === '7z' ? 'application/x-7z-compressed' : 'application/zip';
    const upload = await f.upload('/api/save-import', await readFile(archive), { contentType: type });
    assert.equal(upload.status, 201, await upload.clone().text());
    const staged = await upload.json();
    assert.equal(staged.kind, 'world');
    await waitTask(f, 'import-save', { id: staged.id });
    assert.equal(await readFile(path.join(world, 'Level.sav'), 'utf8'), `${format}-world`);
    assert.equal(await readFile(path.join(world, 'LevelMeta.sav'), 'utf8'), `${format}-meta`);
    assert.equal(await readFile(path.join(world, 'Players/new.sav'), 'utf8'), `${format}-player`);
    await assert.rejects(access(path.join(world, 'Players/old.sav')), { code: 'ENOENT' });
    assert.equal(await readFile(path.join(saved(f), 'SaveGames/0/OTHER/Level.sav'), 'utf8'), 'other-world');
    assert.deepEqual(await readdir(path.join(f.directory, 'palbox/imports')), []);
  }
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
