import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { replaceDirectory } from '../../backend/management/replace-directory.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'palbox-replace-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const target = path.join(root, 'target');
  await fs.mkdir(source); await fs.mkdir(target);
  await fs.writeFile(path.join(source, 'new'), 'new-data');
  await fs.writeFile(path.join(target, 'old'), 'old-data');
  return { root, source, target };
}

test('整体替换移除旧文件，保留空目录和空文件', async t => {
  const { root, source, target } = await fixture(t);
  await fs.mkdir(path.join(source, 'empty-directory'));
  await fs.writeFile(path.join(source, 'empty-file'), '');
  await replaceDirectory(source, target);
  assert.deepEqual(await fs.readdir(target), ['empty-directory', 'empty-file', 'new']);
  assert.equal(await fs.readFile(path.join(target, 'new'), 'utf8'), 'new-data');
  assert.deepEqual(await fs.readdir(root), ['source', 'target']);
});

test('写入失败会还原完整的旧目录并清理临时目录', async t => {
  const { root, source, target } = await fixture(t);
  const rename = fs.rename;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (path.basename(from) === 'replacement') throw new Error('simulated install failure');
    return rename(from, to);
  });
  await assert.rejects(replaceDirectory(source, target), /simulated install failure/);
  assert.deepEqual(await fs.readdir(target), ['old']);
  assert.equal(await fs.readFile(path.join(target, 'old'), 'utf8'), 'old-data');
  assert.deepEqual(await fs.readdir(root), ['source', 'target']);
});

test('回滚失败保留原数据并报告位置', async t => {
  const { root, source, target } = await fixture(t);
  const rename = fs.rename;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (['replacement', 'previous'].includes(path.basename(from))) throw new Error('simulated rename failure');
    return rename(from, to);
  });
  await assert.rejects(replaceDirectory(source, target), error => error.rollbackFailed === true && /原数据已保留/.test(error.message));
  const stage = (await fs.readdir(root)).find(name => name.startsWith('.import-'));
  assert.equal(await fs.readFile(path.join(root, stage, 'previous/old'), 'utf8'), 'old-data');
});

test('后续配置提交失败会回滚已经替换的目录，包括原目录不存在的情况', async t => {
  for (const existed of [true, false]) {
    const { root, source, target } = await fixture(t);
    if (!existed) await fs.rm(target, { recursive: true });
    await assert.rejects(replaceDirectory(source, target, { afterReplace: async () => {
      assert.equal(await fs.readFile(path.join(target, 'new'), 'utf8'), 'new-data');
      throw new Error('configuration commit failed');
    } }), /configuration commit failed/);
    if (existed) assert.equal(await fs.readFile(path.join(target, 'old'), 'utf8'), 'old-data');
    else await assert.rejects(fs.access(target), { code: 'ENOENT' });
    assert.deepEqual(await fs.readdir(root), existed ? ['source', 'target'] : ['source']);
  }
});
