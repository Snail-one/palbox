import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
