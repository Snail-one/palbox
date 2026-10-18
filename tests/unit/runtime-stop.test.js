import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../../backend/management/runtime.js';

function stoppingRuntime(value) {
  const runtime = new Runtime('/tmp/palbox-runtime-stop-test', { stopTimeout: 50, shutdownWait: value });
  const calls = [];
  runtime.rest = async (endpoint, body) => {
    calls.push({ endpoint, body });
    if (endpoint === 'shutdown') runtime.game = null;
    return {};
  };
  runtime.game = { pid: 1 };
  return { runtime, calls };
}

test('停止服务时按设置发送关服倒计时，默认 5 秒', async () => {
  const { runtime, calls } = stoppingRuntime(undefined);
  await runtime.stop();
  assert.deepEqual(calls.map(call => call.endpoint), ['save', 'shutdown']);
  assert.deepEqual(calls[1].body, { waittime: 5, message: 'Palbox 正在维护服务器' });
});

test('停止服务时使用配置的关服倒计时并限制在有效范围', async () => {
  for (const [setting, expected] of [[0, 0], [30, 30], [300, 300], [-1, 5], [301, 5], [1.5, 5]]) {
    const { runtime, calls } = stoppingRuntime(setting);
    await runtime.stop();
    assert.equal(calls[1].body.waittime, expected, `shutdownWait=${setting}`);
  }
});
