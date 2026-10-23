import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Manager } from '../../backend/management/manager.js';

async function fixture(t, { desired = 'OptionSettings=(ExpRate=2.5)', written = 'OptionSettings=(ExpRate=1)', running = null } = {}) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'palbox-configuration-diff-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const runtime = {
    config: path.join(directory, 'current.ini'), saved: path.join(directory, 'Saved'),
    game: running === null ? null : {}, runningSource: running,
    rest() { throw new Error('差异查看不应请求游戏接口'); }
  };
  const manager = new Manager({ directory, runtime });
  manager.store.workspace = { activeId: 'working', profiles: [{ id: 'working', name: '我的配置', source: desired }] };
  manager.store.revision = 1;
  if (written !== null) await fs.writeFile(runtime.config, written);
  return manager;
}

test('停服时列出待写入的具体参数，不将缺失参数当作空字符串', async t => {
  const manager = await fixture(t, { desired: 'OptionSettings=(ExpRate=2.5,NewFlag="")', written: 'OptionSettings=(ExpRate=1,RemovedFlag=True)' });
  const value = await manager.configurationDiff();
  assert.equal(value.running, false);
  assert.equal(value.profileName, '我的配置');
  assert.deepEqual(value.changes, [
    { key: 'ExpRate', desiredValue: '2.500000', writtenValue: '1.000000', runningValue: null, needsWrite: true, needsRestart: false },
    { key: 'NewFlag', desiredValue: '""', writtenValue: null, runningValue: null, needsWrite: true, needsRestart: false },
    { key: 'RemovedFlag', desiredValue: null, writtenValue: 'True', runningValue: null, needsWrite: true, needsRestart: false }
  ]);
});

test('运行中区分待写入和待重启，已写入的修改仍显示启动时旧值', async t => {
  const manager = await fixture(t, { desired: 'OptionSettings=(ExpRate=2.5)', written: 'OptionSettings=(ExpRate=2.5)', running: 'OptionSettings=(ExpRate=1)' });
  const value = await manager.configurationDiff();
  assert.equal(value.runningKnown, true);
  assert.deepEqual(value.changes, [
    { key: 'ExpRate', desiredValue: '2.500000', writtenValue: '2.500000', runningValue: '1.000000', needsWrite: false, needsRestart: true }
  ]);
  await fs.writeFile(manager.runtime.config, 'OptionSettings=(ExpRate=3)');
  manager.runtime.runningSource = manager.store.active().source;
  const writtenOnly = (await manager.configurationDiff()).changes[0];
  assert.equal(writtenOnly.needsWrite, true);
  assert.equal(writtenOnly.needsRestart, false);
});

test('仅格式或排列不同时不伪造参数修改，数字格式按实际输出统一', async t => {
  const manager = await fixture(t, { desired: 'OptionSettings=(ExpRate=1,ServerName="World")', written: '; comment\nOptionSettings=(ServerName="World",ExpRate=1.000000)' });
  const value = await manager.configurationDiff();
  assert.deepEqual(value.changes, []);
  assert.equal(value.formatOnly, true);
});

test('配置未写入、启动快照缺失或无选中配置时提供明确状态', async t => {
  const manager = await fixture(t, { written: null });
  const missing = await manager.configurationDiff();
  assert.equal(missing.diskExists, false);
  assert.equal(missing.changes[0].writtenValue, null);
  manager.runtime.game = {};
  assert.equal((await manager.configurationDiff()).runningKnown, false);
  manager.store.workspace.activeId = null;
  await assert.rejects(manager.configurationDiff(), { status: 409, message: /尚无可用配置/ });
});

test('无法解析磁盘配置时明确报错，读取时配置或进程改变则拒绝旧结果', async t => {
  const manager = await fixture(t, { written: 'invalid configuration' });
  await assert.rejects(manager.configurationDiff(), { status: 409, message: /无法读取已写入的游戏配置/ });
  await fs.writeFile(manager.runtime.config, 'OptionSettings=(ExpRate=1)');
  const readFile = fs.readFile;
  t.mock.method(fs, 'readFile', async (...args) => {
    const value = await readFile(...args);
    if (args[0] === manager.runtime.config) manager.store.revision++;
    return value;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  await assert.rejects(manager.configurationDiff(), { status: 409, message: /已变化/ });
});
