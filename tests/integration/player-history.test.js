import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { managementFixture } from '../helpers/management-fixture.js';
import { Manager } from '../../backend/management/manager.js';

test('游戏日志直接记录无需网页，历史需要登录，离线玩家可封禁，重启后保留', { timeout: 20000 }, async t => {
  const f = await managementFixture(); t.after(() => f.close());
  assert.equal((await f.request('/api/player-history', { authenticated: false })).status, 401);
  await f.login(); await f.task('install'); await f.task('start');
  const get = async () => (await f.request('/api/player-history')).json();
  const original = await get();
  assert.equal(original.recorded, 1);
  assert.equal(original.players[0].userId, 'steam_test');
  assert.equal(original.players[0].banned, false);
  assert.equal(original.players[0].ip, '198.51.100.23');
  assert.equal(original.players[0].loginStatus, 'succeeded');
  assert.ok(original.players[0].firstSeenAt.endsWith('Z'));
  const rest = f.runtime.rest.bind(f.runtime);
  f.runtime.rest = (endpoint, body) => endpoint === 'players' ? Promise.resolve({ players: [] }) : rest(endpoint, body);
  assert.equal((await f.manager.status({ scope: 'players' })).players.length, 0);
  assert.equal((await get()).recorded, 1);
  assert.equal((await f.task('ban', { userid: 'steam_test', name: original.players[0].name, message: '历史玩家测试' })).state, 'succeeded');
  assert.equal((await get()).players[0].banned, true);
  assert.equal((await f.task('unban', { userid: 'steam_test' })).state, 'succeeded');
  assert.equal((await get()).players[0].banned, false);
  await f.task('stop');
  assert.equal((await get()).recorded, 1);
  await f.manager.close();
  const restarted = new Manager({ directory: f.directory });
  try {
    await restarted.initialize();
    const persisted = await restarted.historicalPlayers();
    assert.equal(persisted.recorded, 1);
    assert.equal(persisted.players[0].firstSeenAt, original.players[0].firstSeenAt);
    assert.equal(persisted.players[0].name, '<script>test</script>');
    assert.equal(JSON.parse(await readFile(restarted.playerHistory.file, 'utf8')).players.length, 1);
    await restarted.clearPlayerHistory();
  } finally { await restarted.close(); }
  const cleared = new Manager({ directory: f.directory });
  try {
    await cleared.initialize();
    assert.equal((await cleared.historicalPlayers()).recorded, 0, '重启回读旧日志时仍保持清空');
    assert.deepEqual(await cleared.restorePlayerHistory(), { restored: 1, recorded: 1 });
    const restored = await cleared.historicalPlayers();
    assert.equal(restored.players[0].ip, '198.51.100.23');
    assert.equal(restored.players[0].loginStatus, 'succeeded');
    assert.equal(JSON.parse(await readFile(cleared.playerHistory.file, 'utf8')).clearedAt, null);
  } finally { await cleared.close(); }
});

test('历史 API 支持搜索分页并验证输入，封禁仍校验会话和 CSRF', async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  await f.manager.playerHistory.record(Array.from({ length: 13 }, (_, index) => ({ userId: `steam_${index}`, name: `测试玩家 ${index}` })));
  const first = await (await f.request('/api/player-history')).json();
  assert.equal(first.recorded, 13); assert.equal(first.players.length, 10);
  const second = await (await f.request('/api/player-history?page=2')).json();
  assert.equal(second.players.length, 3); assert.equal(second.pageCount, 2);
  const filtered = await (await f.request('/api/player-history?query=' + encodeURIComponent('测试玩家 12'))).json();
  assert.equal(filtered.total, 1); assert.equal(filtered.players[0].userId, 'steam_12');
  assert.equal((await f.request('/api/player-history?page=-1')).status, 400);
  assert.equal((await f.request('/api/player-history?query=' + 'x'.repeat(201))).status, 400);
  assert.equal((await f.request('/api/tasks', { method: 'POST', body: { action: 'ban', userid: 'steam_12' }, headers: { 'X-Palbox-CSRF': 'invalid' } })).status, 403);
  assert.equal((await f.request('/api/player-history', { method: 'DELETE', headers: { 'X-Palbox-CSRF': 'invalid' } })).status, 403);
  assert.equal((await f.request('/api/player-history', { method: 'DELETE', authenticated: false })).status, 401);
  assert.equal((await f.request('/api/player-history', { method: 'DELETE' })).status, 200);
  assert.equal((await (await f.request('/api/player-history')).json()).recorded, 0);
  assert.equal((await f.request('/api/player-history/restore', { method: 'POST', headers: { 'X-Palbox-CSRF': 'invalid' } })).status, 403);
  assert.equal((await f.request('/api/player-history/restore', { method: 'POST', authenticated: false })).status, 401);
  await writeFile(path.join(f.directory, 'logs/game.log'), '[2026-10-19 12:37:55] [LOG] 日志恢复玩家 198.51.100.9 connected the server. (User id: steam_from_log)\n');
  const response = await f.request('/api/player-history/restore', { method: 'POST' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { restored: 1, recorded: 1 });
  assert.equal((await (await f.request('/api/player-history')).json()).players[0].ip, '198.51.100.9');
});
