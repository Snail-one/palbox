import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Manager } from '../../backend/management/manager.js';

function fixture(rest) {
  const runtime = {
    game: {}, port: 8211, startedAt: '2026-10-19T00:00:00.000Z',
    runningArgs: ['-useperfthreads'],
    runningSource: '[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ExpRate=99,AdminPassword="private")\n',
    rest
  };
  return new Manager({ directory: '/tmp/palbox-running-configuration', runtime });
}

test('运行配置每次从游戏 REST API 读取，保留原始 JSON 类型，不混入 INI 快照', async () => {
  let calls = 0;
  const manager = fixture(async endpoint => {
    assert.equal(endpoint, 'settings');
    return { ExpRate: ++calls, ServerName: '游戏返回的名称', bIsPvP: false, UnknownSetting: [1, 'two'] };
  });
  const first = await manager.runningConfiguration();
  assert.deepEqual(first.settings, { ExpRate: 1, ServerName: '游戏返回的名称', bIsPvP: false, UnknownSetting: [1, 'two'] });
  assert.deepEqual(first.args, ['-useperfthreads']);
  assert.equal(first.port, 8211);
  assert.equal(first.startedAt, manager.runtime.startedAt);
  assert.equal(first.source, undefined);
  assert.equal(first.matchesCurrent, undefined);
  assert.equal(first.settings.AdminPassword, undefined);
  assert.equal((await manager.runningConfiguration()).settings.ExpRate, 2);
});

test('停服时不请求游戏接口', async () => {
  const manager = fixture(() => { throw new Error('不应调用'); });
  manager.runtime.game = null;
  assert.deepEqual(await manager.runningConfiguration(), { running: false });
});

test('接口失败或返回无效数据时明确报错，不回退显示启动快照', async () => {
  const manager = fixture(async () => { throw new Error('连接失败'); });
  await assert.rejects(manager.runningConfiguration(), { status: 502, message: '无法通过游戏 REST API 读取运行配置：连接失败' });
  for (const value of [null, [], '', {}, 42]) {
    manager.runtime.rest = async () => value;
    await assert.rejects(manager.runningConfiguration(), { status: 502, message: '游戏 REST API 返回的运行配置格式无效。' });
  }
});

test('读取期间游戏停止或重启，不将旧响应与新进程信息混合', async () => {
  for (const stopped of [true, false]) {
    for (const failed of [true, false]) {
      let finish;
      const manager = fixture(() => new Promise((resolve, reject) => { finish = () => failed ? reject(new Error('断开连接')) : resolve({ ExpRate: 2 }); }));
      const reading = manager.runningConfiguration();
      manager.runtime.game = stopped ? null : {};
      finish();
      if (stopped) assert.deepEqual(await reading, { running: false });
      else await assert.rejects(reading, { status: 409 });
    }
  }
});
