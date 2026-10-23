import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { Manager } from '../../backend/management/manager.js';

const original = 'OptionSettings=(RESTAPIEnabled=True,AdminPassword="old",RESTAPIPort=8212)';
const next = original.replace('"old"', '"new"');

async function fixture(t, { running = true, existed = true } = {}) {
  const directory = await fs.mkdtemp('/tmp/palbox-apply-');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const calls = [], logs = [];
  const runtime = {
    config: path.join(directory, 'config.ini'), port: 8211,
    game: running ? {} : null,
    async stop() { calls.push('stop'); runtime.game = null; },
    async start() { calls.push('start'); assert.equal(await fs.readFile(runtime.config, 'utf8'), runtime.expectedSource); runtime.game = {}; },
    log(channel, message) { logs.push(message); }
  };
  if (existed) await fs.writeFile(runtime.config, original);
  const manager = new Manager({ directory, runtime, webPort: 8090, apiPort: 8091 });
  const rename = fs.rename;
  function failRename(fn) {
    t.mock.method(fs, 'rename', (from, to) => fn(from, to, rename));
    syncBuiltinESMExports();
    t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  }
  return { directory, runtime, manager, calls, logs, failRename };
}

test('应用配置在准备文件失败时不停止原游戏，也不留下临时目录', async t => {
  const { directory, runtime, manager, calls, failRename } = await fixture(t);
  const process = runtime.game;
  failRename(async (from, to, rename) => {
    if (path.basename(to) === 'next.ini') throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    return rename(from, to);
  });
  await assert.rejects(manager.applyConfiguration(next), { code: 'ENOSPC' });
  assert.equal(runtime.game, process);
  assert.deepEqual(calls, []);
  assert.equal(await fs.readFile(runtime.config, 'utf8'), original);
  assert.deepEqual(await fs.readdir(directory), ['config.ini']);
});

test('应用配置提交失败会恢复旧配置与原运行状态，包括替换后报错', async t => {
  for (const running of [true, false]) for (const afterWrite of [true, false]) {
    await t.test(`running=${running}, afterWrite=${afterWrite}`, async t => {
      const { directory, runtime, manager, calls, failRename } = await fixture(t, { running });
      runtime.expectedSource = original;
      failRename(async (from, to, rename) => {
        if (to === runtime.config && path.basename(from) === 'next.ini') {
          if (afterWrite) await rename(from, to);
          throw new Error('commit failed');
        }
        return rename(from, to);
      });
      await assert.rejects(manager.applyConfiguration(next), /commit failed/);
      assert.equal(await fs.readFile(runtime.config, 'utf8'), original);
      assert.equal(Boolean(runtime.game), running);
      assert.deepEqual(calls, running ? ['stop', 'start'] : []);
      assert.deepEqual(await fs.readdir(directory), ['config.ini']);
    });
  }
});

test('应用回滚失败时保留旧配置副本并保持停服', async t => {
  const { directory, runtime, manager, calls, failRename } = await fixture(t);
  failRename(async (from, to, rename) => {
    if (to === runtime.config) {
      if (path.basename(from) === 'next.ini') await rename(from, to);
      throw new Error('persistent disk error');
    }
    return rename(from, to);
  });
  await assert.rejects(manager.applyConfiguration(next), error => error.rollbackFailed && /原文件副本已保留/.test(error.message));
  assert.equal(runtime.game, null);
  assert.deepEqual(calls, ['stop']);
  const stage = (await fs.readdir(directory)).find(name => name.startsWith('.apply-'));
  assert.ok(stage);
  assert.equal(await fs.readFile(path.join(directory, stage, 'previous.ini'), 'utf8'), original);
});

test('应用配置成功后使用新配置重启，初次写入不会启动已停止的游戏', async t => {
  for (const running of [true, false]) {
    const { directory, runtime, manager, calls } = await fixture(t, { running, existed: running });
    runtime.expectedSource = next;
    await manager.applyConfiguration(next);
    assert.equal(await fs.readFile(runtime.config, 'utf8'), next);
    assert.equal(Boolean(runtime.game), running);
    assert.deepEqual(calls, running ? ['stop', 'start'] : []);
    assert.deepEqual(await fs.readdir(directory), ['config.ini']);
  }
});

test('校验和正常停服失败时不提交新配置', async t => {
  const { directory, runtime, manager, calls } = await fixture(t);
  const process = runtime.game;
  for (const port of ['8090', '8091']) {
    await assert.rejects(manager.applyConfiguration(next.replace('8212', port)), /REST API 端口无效/);
  }
  assert.deepEqual(calls, []);
  runtime.stop = async () => { throw new Error('save failed'); };
  await assert.rejects(manager.applyConfiguration(next), /save failed/);
  assert.equal(runtime.game, process);
  assert.equal(await fs.readFile(runtime.config, 'utf8'), original);
  assert.deepEqual(await fs.readdir(directory), ['config.ini']);
});
