import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBackupRetentionAutosave } from '../../frontend/src/ui/backup-retention-autosave.js';

function fixture(save) {
  const counts = { manual: 5, 'before-reset': 5 };
  const calls = [];
  const saver = createBackupRetentionAutosave({
    getSaved: category => counts[category],
    async save(category, count) {
      calls.push([category, count]);
      if (save) await save(category, count);
      counts[category] = count;
    },
    onState() {}
  });
  return { saver, calls, counts };
}

test('输入后延迟自动保存，只提交连续输入的最后一个有效值', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { saver, calls, counts } = fixture();
  saver.input('manual', '6');
  t.mock.timers.tick(300);
  saver.input('manual', '7');
  t.mock.timers.tick(399);
  assert.deepEqual(calls, []);
  t.mock.timers.tick(1);
  await saver.flush('manual');
  assert.deepEqual(calls, [['manual', 7]]);
  assert.equal(counts.manual, 7);
  assert.equal(saver.getState('manual').status, 'saved');
});

test('回车或失焦立即保存，不重复提交已保存的相同数值', async () => {
  const { saver, calls } = fixture();
  saver.input('manual', '8');
  await saver.flush('manual');
  await saver.flush('manual');
  saver.input('manual', '08');
  await saver.flush('manual');
  assert.deepEqual(calls, [['manual', 8]]);
});

test('空值、非整数和超出 1～20 的输入不提交', async () => {
  const { saver, calls } = fixture();
  for (const value of ['', '0', '21', '1.5', 'invalid']) {
    saver.input('manual', value);
    await saver.flush('manual');
    assert.equal(saver.getState('manual').status, 'invalid');
  }
  assert.deepEqual(calls, []);
  saver.input('manual', '20');
  await saver.flush('manual');
  assert.deepEqual(calls, [['manual', 20]]);
});

test('保存期间继续编辑会保留新输入，并在旧请求结束后保存最新值', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { saver, calls, counts } = fixture(async (_category, count) => { if (count === 6) await gate; });
  saver.input('manual', '6');
  const first = saver.flush('manual');
  saver.input('manual', '7');
  void saver.flush('manual');
  assert.deepEqual(calls, [['manual', 6]]);
  assert.equal(saver.getState('manual').value, '7');
  release(); await first;
  await saver.flush('manual');
  assert.deepEqual(calls, [['manual', 6], ['manual', 7]]);
  assert.equal(counts.manual, 7);
  assert.equal(saver.getState('manual').value, '7');
  assert.equal(saver.getState('manual').status, 'saved');
});

test('保存失败保留输入，立即重试后更新状态', async () => {
  let fail = true;
  const { saver, calls, counts } = fixture(async () => { if (fail) throw new Error('网络暂时不可用'); });
  saver.input('manual', '9');
  await saver.flush('manual');
  assert.equal(saver.getState('manual').status, 'error');
  assert.equal(saver.getState('manual').value, '9');
  assert.equal(counts.manual, 5);
  fail = false;
  await saver.flush('manual');
  assert.equal(saver.getState('manual').status, 'saved');
  assert.equal(counts.manual, 9);
  assert.equal(calls.length, 2);
});

test('一个分类正在保存时，另一个分类仍可独立修改', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { saver, counts } = fixture(async category => { if (category === 'manual') await gate; });
  saver.input('manual', '2');
  const first = saver.flush('manual');
  saver.input('before-reset', '3');
  await saver.flush('before-reset');
  assert.equal(counts['before-reset'], 3);
  assert.equal(saver.getState('manual').status, 'saving');
  release(); await first;
  assert.equal(counts.manual, 2);
});

test('回车重复触发同值保存时不重复提交，失败后保留失败状态供用户重试', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { saver, calls, counts } = fixture(async () => { await gate; throw new Error('保存失败'); });
  saver.input('manual', '8');
  const first = saver.flush('manual');
  void saver.flush('manual');
  release(); await first;
  assert.deepEqual(calls, [['manual', 8]]);
  assert.equal(counts.manual, 5);
  assert.equal(saver.getState('manual').status, 'error');
  assert.equal(saver.getState('manual').value, '8');
});
