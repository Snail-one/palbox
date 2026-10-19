import { test } from 'node:test';
import assert from 'node:assert/strict';
import { managementFixture } from '../helpers/management-fixture.js';

test('按需状态按页面限定游戏接口，本地状态与任务推送不访问游戏 REST', { timeout: 15000 }, async t => {
  const f = await managementFixture(); t.after(() => f.close());
  assert.equal((await f.request('/api/status/stream')).status, 401);
  const { cookie } = await f.login();
  await f.task('install');
  await f.task('start');
  const calls = [];
  const rest = f.runtime.rest.bind(f.runtime);
  f.runtime.rest = (endpoint, body) => { calls.push(endpoint); return rest(endpoint, body); };
  const status = async scope => (await f.request(`/api/status?scope=${scope}`)).json();
  const local = await status('local');
  assert.equal(local.running, true);
  assert.equal('players' in local, false);
  assert.deepEqual(calls, []);
  assert.equal((await status('players')).players.length, 1);
  assert.deepEqual(calls.splice(0), ['players']);
  assert.equal((await status('overview')).metrics.serverfps, 60);
  assert.deepEqual(calls.splice(0).sort(), ['info', 'metrics', 'players']);
  assert.equal((await f.request('/api/status?scope=unknown')).status, 400);
  const controller = new AbortController(); t.after(() => controller.abort());
  const response = await fetch(f.base + '/api/status/stream', { headers: { Cookie: cookie }, signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  async function nextEvent(name, predicate = () => true) {
    for (;;) {
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (!frame.split('\n').includes('event: ' + name)) continue;
        const value = JSON.parse(frame.split('\n').find(line => line.startsWith('data: ')).slice(6));
        if (predicate(value)) return value;
      }
      const part = await reader.read(); assert.equal(part.done, false);
      buffer += decoder.decode(part.value, { stream: true });
    }
  }
  assert.equal((await nextEvent('status')).running, true);
  assert.deepEqual(calls, []);
  // Hold a real task open to verify phases and completion arrive without GETs.
  let finish;
  const execute = f.manager.execute;
  f.manager.execute = async () => { await new Promise(resolve => { finish = resolve; }); };
  const task = await f.manager.submit('save-world');
  await nextEvent('status', value => value.task?.id === task.id);
  f.manager.servicePhase('saving', '正在保存测试世界');
  assert.equal((await nextEvent('status', value => value.task?.phase === 'saving')).task.message, '正在保存测试世界');
  finish(); await f.manager.operation;
  const done = await nextEvent('status', value => !value.task && value.tasks[0]?.id === task.id);
  assert.equal(done.tasks[0].state, 'succeeded');
  assert.ok(done.stateRevision > local.stateRevision);
  assert.deepEqual(calls, []);
  f.manager.execute = execute;
  f.runtime.kill(f.runtime.game, 'SIGKILL');
  assert.equal((await nextEvent('status', value => !value.running)).ready, false);
  assert.deepEqual(calls, []);
  assert.equal((await f.request('/api/logout', { method: 'POST' })).status, 200);
  f.manager.changed();
  await nextEvent('unauthorized');
  assert.equal((await reader.read()).done, true);
});

test('游戏请求过程中进程退出时返回新状态，不再返回旧指标', { timeout: 10000 }, async t => {
  const f = await managementFixture(); t.after(() => f.close());
  await f.login();
  await f.task('install'); await f.task('start');
  const releases = [];
  f.runtime.rest = () => new Promise(resolve => releases.push(resolve));
  const pending = f.manager.status({ scope: 'overview' });
  while (releases.length < 3) await new Promise(resolve => setImmediate(resolve));
  f.runtime.kill(f.runtime.game, 'SIGKILL');
  await new Promise(resolve => f.runtime.once('state', resolve));
  for (const resolve of releases) resolve({ version: 'stale', serverfps: 1000, players: [{ name: 'stale' }] });
  const snapshot = await pending;
  assert.equal(snapshot.running, false);
  assert.equal('metrics' in snapshot, false);
  assert.equal('players' in snapshot, false);
});
