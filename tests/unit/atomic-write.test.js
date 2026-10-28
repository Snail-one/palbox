import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, stat, symlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { jsonWrite } from '../../backend/management/files.js';

test('原子写入在替换前验证授权，撤销时保留原文件并移除临时文件', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-atomic-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'settings.json');
  await writeFile(file, '{"original":true}\n');
  const error = Object.assign(new Error('revoked'), { status: 401 });
  await assert.rejects(jsonWrite(file, { changed: true }, { beforeCommit: () => { throw error; } }), error);
  assert.equal(await readFile(file, 'utf8'), '{"original":true}\n');
  assert.deepEqual(await readdir(directory), ['settings.json']);
});

test('独占原子写入并发时只发布一个完整文件，拒绝后续覆盖并清理临时文件', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-exclusive-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'settings.json');
  const results = await Promise.allSettled(Array.from({ length: 16 }, (_, id) => jsonWrite(file, { id }, { exclusive: true })));
  const winner = results.findIndex(result => result.status === 'fulfilled');
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  for (const result of results) if (result.status === 'rejected') assert.equal(result.reason.code, 'EEXIST');
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { id: winner });
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  await assert.rejects(jsonWrite(file, { replacement: true }, { exclusive: true }), { code: 'EEXIST' });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { id: winner });
  assert.deepEqual(await readdir(directory), ['settings.json']);
});

test('独占原子写入拒绝覆盖损坏文件或符号链接', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-exclusive-existing-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'settings.json');
  await writeFile(file, '{');
  await assert.rejects(jsonWrite(file, { replacement: true }, { exclusive: true }), { code: 'EEXIST' });
  assert.equal(await readFile(file, 'utf8'), '{');
  const alias = path.join(directory, 'alias.json');
  await symlink(file, alias);
  await assert.rejects(jsonWrite(alias, { replacement: true }, { exclusive: true }), { code: 'EEXIST' });
  assert.equal(await readFile(file, 'utf8'), '{');
  assert.deepEqual((await readdir(directory)).sort(), ['alias.json', 'settings.json']);
});
