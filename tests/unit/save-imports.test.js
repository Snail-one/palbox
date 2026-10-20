import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSnapshot, SaveImports } from '../../backend/management/save-imports.js';
import { NativeBackups } from '../../backend/management/native-backups.js';
import { mkdtemp, mkdir, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PassThrough, Readable } from 'node:stream';
import { gunzipSync, gzipSync } from 'node:zlib';

const file = (name, size = 16) => ({ name, type: 'file', size });
const dir = name => ({ name, type: 'directory', size: 0 });
const snapshot = root => {
  const prefix = root ? `${root}/` : '';
  return [dir(root ? prefix.slice(0, -1) : './'), file(`${prefix}Level.sav`, 32), file(`${prefix}LevelMeta.sav`, 16), dir(`${prefix}Players`), file(`${prefix}Players/player.sav`)];
};

test('识别根目录、SaveGames 和 Pal/Saved 三种布局', () => {
  assert.deepEqual(detectSnapshot(snapshot('')), {
    kind: 'world', root: '', layout: 'root', worldId: null, copy: ['Level.sav', 'LevelMeta.sav', 'Players/player.sav']
  });
  assert.deepEqual(detectSnapshot(snapshot('SaveGames/0/WORLD1')).root, 'SaveGames/0/WORLD1');
  assert.deepEqual(detectSnapshot(snapshot('SaveGames/0/WORLD1')).layout, 'savegames');
  assert.deepEqual(detectSnapshot(snapshot('SaveGames/0/WORLD1')).worldId, 'WORLD1');
  assert.deepEqual(detectSnapshot(snapshot('Pal/Saved/SaveGames/0/WORLD2')).layout, 'pal-saved');
  assert.deepEqual(detectSnapshot(snapshot('Pal/Saved/SaveGames/0/WORLD2')).worldId, 'WORLD2');
  assert.equal(detectSnapshot(snapshot('WORLD3')).layout, 'world');
});

test('规范化 ./ 前缀并允许缺少 Players', () => {
  const result = detectSnapshot([file('./Level.sav'), file('./LevelMeta.sav')]);
  assert.deepEqual(result, { kind: 'world', root: '', layout: 'root', worldId: null, copy: ['Level.sav', 'LevelMeta.sav'] });
});

test('完整保留世界目录中的 backup 历史与额外文件', () => {
  const entries = [
    file('SaveGames/0/WORLD1/Level.sav'), file('SaveGames/0/WORLD1/LevelMeta.sav'),
    dir('SaveGames/0/WORLD1/Players'), file('SaveGames/0/WORLD1/Players/a.sav'),
    dir('SaveGames/0/WORLD1/backup'), dir('SaveGames/0/WORLD1/backup/world'), dir('SaveGames/0/WORLD1/backup/world/2026.01.01-00.00.00'),
    file('SaveGames/0/WORLD1/backup/world/2026.01.01-00.00.00/Level.sav'),
    file('SaveGames/0/WORLD1/backup/world/2026.01.01-00.00.00/LevelMeta.sav'),
    file('SaveGames/0/WORLD1/WorldOption.sav'),
    file('SaveGames/0/WORLD1/Extra.log')
  ];
  const result = detectSnapshot(entries);
  assert.equal(result.root, 'SaveGames/0/WORLD1');
  assert.deepEqual(result.copy, ['Level.sav', 'LevelMeta.sav', 'Players/a.sav', 'backup/world/2026.01.01-00.00.00/Level.sav', 'backup/world/2026.01.01-00.00.00/LevelMeta.sav', 'WorldOption.sav', 'Extra.log']);
});

test('完整备份按目录内容识别，支持多个世界并保留配置和日志', () => {
  const entries = [file('Pal/Saved/Config/LinuxServer/PalWorldSettings.ini'),
    file('Pal/Saved/Config/LinuxServer/GameUserSettings.ini'), file('Pal/Saved/Logs/game.log'),
    ...snapshot('Pal/Saved/SaveGames/0/ONE'), ...snapshot('Pal/Saved/SaveGames/0/TWO')];
  const result = detectSnapshot(entries);
  assert.equal(result.kind, 'full');
  assert.equal(result.root, 'Pal/Saved');
  assert.equal(result.copy.length, entries.filter(entry => entry.type === 'file').length);
  assert.throws(() => detectSnapshot([file('Pal/Saved/Config/LinuxServer/GameUserSettings.ini'), ...snapshot('Pal/Saved/SaveGames/0/ONE')]), /PalWorldSettings/);
  for (const root of ['', 'Saved']) {
    const prefix = root ? `${root}/` : '';
    assert.equal(detectSnapshot([file(`${prefix}Config/LinuxServer/PalWorldSettings.ini`), ...snapshot(`${prefix}SaveGames/0/ONE`)]).kind, 'full');
  }
  assert.equal(detectSnapshot([...snapshot(''), file('Config/extra.txt')]).kind, 'world');
});

test('世界存档拒绝多个世界或缺少元数据，保留 Players 内的全部普通文件', () => {
  assert.throws(() => detectSnapshot([
    ...snapshot('SaveGames/0/ONE'), ...snapshot('SaveGames/0/TWO')
  ]), /多个世界存档/);
  assert.throws(() => detectSnapshot([file('Level.sav')]), /没有可导入/);
  assert.ok(detectSnapshot([
    file('Level.sav'), file('LevelMeta.sav'), dir('Players'), file('Players/readme.txt')
  ]).copy.includes('Players/readme.txt'));
  assert.ok(detectSnapshot([
    file('Level.sav'), file('LevelMeta.sav'), dir('Players'), dir('Players/nested'), file('Players/nested/a.sav')
  ]).copy.includes('Players/nested/a.sav'));
});

test('拒绝穿越、绝对路径、反斜杠、重复路径和文件作为父路径', () => {
  const base = [file('Level.sav'), file('LevelMeta.sav')];
  assert.throws(() => detectSnapshot([...base, file('../Level.sav')]), /不允许的路径/);
  assert.throws(() => detectSnapshot([...base, file('/Level.sav')]), /无效路径/);
  assert.throws(() => detectSnapshot([...base, file('bad\\Level.sav')]), /无效路径/);
  assert.throws(() => detectSnapshot([...base, file('Level.sav')]), /重复路径/);
  assert.throws(() => detectSnapshot([...base, file('Players'), file('Players/a.sav')]), /不允许的路径/);
  assert.throws(() => detectSnapshot([...base, file(' Save.sav')]), /无效路径/);
});

async function importFixture(t, limits = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-import-limits-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const imports = new SaveImports({ directory, native: new NativeBackups('', directory), limits });
  await imports.initialize();
  const source = path.join(directory, 'source');
  await mkdir(source);
  await writeFile(path.join(source, 'Level.sav'), 'level');
  await writeFile(path.join(source, 'LevelMeta.sav'), 'metadata');
  const archive = path.join(directory, 'import.tar.gz');
  await promisify(execFile)('tar', ['-czf', archive, '-C', source, '.']);
  const compressed = await readFile(archive);
  return { imports, archive, compressed };
}

const upload = bytes => Object.assign(Readable.from([bytes]), { headers: { 'content-type': 'application/gzip' } });

test('慢速上传有绝对时限，期间拒绝并发请求，失败后释放锁并清理部分文件', async t => {
  const { imports, compressed } = await importFixture(t, { uploadTimeoutMs: 100 });
  const slow = Object.assign(new PassThrough(), { headers: { 'content-type': 'application/gzip' } });
  slow.write(compressed.subarray(0, 2));
  const pending = assert.rejects(imports.receive(slow), { status: 408 });
  await assert.rejects(imports.receive(upload(compressed)), { status: 429 });
  await pending;
  assert.equal(imports.receiving.size, 0);
  assert.deepEqual(await readdir(imports.root), []);
  imports.limits.uploadTimeoutMs = 10000;
  assert.ok((await imports.receive(upload(compressed))).id);
});

test('暂存数量限制覆盖重复上传，并在清理过期存档后释放容量', async t => {
  const { imports, compressed } = await importFixture(t, { maxStagedImports: 1 });
  const first = await imports.receive(upload(compressed));
  await assert.rejects(imports.receive(upload(compressed)), { status: 413 });
  assert.deepEqual(await readdir(imports.root), [first.id]);
  const past = new Date(Date.now() - 2 * imports.limits.ttlMs);
  await utimes(imports.resolve(first.id).directory, past, past);
  assert.notEqual((await imports.receive(upload(compressed))).id, first.id);
});

test('暂存总量在解压前计算已有快照与本次压缩包，拒绝后保留已有存档', async t => {
  const { imports, compressed } = await importFixture(t);
  const first = await imports.receive(upload(compressed));
  const used = (await imports.usage()).bytes;
  imports.limits.maxStagedBytes = used + compressed.length + 1;
  let extracted = false;
  const extract = imports.extract.bind(imports);
  imports.extract = (...args) => { extracted = true; return extract(...args); };
  await assert.rejects(imports.receive(upload(compressed)), { status: 413 });
  assert.equal(extracted, false);
  assert.deepEqual(await readdir(imports.root), [first.id]);
  assert.equal((await imports.usage()).bytes, used);
});

test('扫描时即拒绝解压大小、条目、清单大小与路径长度超限，清理失败上传', async t => {
  for (const [limits, status] of [[{ maxUncompressedBytes: 1 }, 413], [{ maxEntries: 1 }, 413], [{ maxListingBytes: 1 }, 413], [{ maxListingLine: 1 }, 400], [{ maxCompressedBytes: 1 }, 413]]) {
    const { imports, compressed } = await importFixture(t, limits);
    await assert.rejects(imports.receive(upload(compressed)), { status });
    assert.deepEqual(await readdir(imports.root), []);
    assert.equal(imports.receiving.size, 0);
  }
});

test('完整读取 tar 结束标记后的填充，拼接归档中的重复文件也会被校验', async t => {
  const { imports, compressed } = await importFixture(t);
  const padded = Buffer.concat([compressed, gzipSync(Buffer.alloc(256 * 1024))]);
  assert.ok((await imports.receive(upload(padded))).id);
  const concatenated = gzipSync(Buffer.concat([gunzipSync(compressed), gunzipSync(compressed)]));
  await assert.rejects(imports.receive(upload(concatenated)), /重复路径/);
  assert.equal((await readdir(imports.root)).length, 1);
});

test('gzip 实际膨胀量受限，不能通过伪造或隐藏 tar 内容绕过', async t => {
  const { imports, archive } = await importFixture(t, { maxUncompressedBytes: 1, maxEntries: 1, maxListingBytes: 1024 });
  await writeFile(archive, gzipSync(Buffer.alloc(1024 * 1024)));
  await assert.rejects(imports.scan(archive), { status: 413 });
});

test('扫描后会话撤销不会进入解压，也不会保留上传或元数据', async t => {
  const { imports, compressed } = await importFixture(t);
  let revoked = false, extracted = false;
  const scan = imports.scan.bind(imports);
  imports.scan = async (...args) => { const detected = await scan(...args); revoked = true; return detected; };
  imports.extract = async () => { extracted = true; };
  await assert.rejects(imports.receive(upload(compressed), { authorize: () => {
    if (revoked) throw Object.assign(new Error('revoked'), { status: 401 });
  } }), { status: 401 });
  assert.equal(extracted, false);
  assert.deepEqual(await readdir(imports.root), []);
});
