import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PlayerHistory, PlayerHistoryRecorder, parsePlayerConnection } from '../../backend/management/player-history.js';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-player-history-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const history = new PlayerHistory(directory); await history.initialize();
  return { directory, history };
}
const first = '2026-10-17T23:00:00.000Z';
const latest = '2026-10-18T01:00:00.000Z';

test('玩家按 UserID 合并并保留首次记录，更新昵称与 IP，缺少 ID 的玩家不入库', async t => {
  const { directory, history } = await fixture(t);
  await history.record([{ userId: 'steam_1', name: '原昵称', ip: '198.51.100.1' }, { name: '缺少 ID' }, { userId: '' }], first);
  await history.record([{ userId: 'steam_1', name: '新昵称', ip: '198.51.100.2' }, { userId: 'steam_2', name: '新昵称' }], latest);
  await history.record([{ userId: 'steam_1' }], latest);
  const values = history.list();
  assert.equal(values.recorded, 2);
  const player = values.players.find(player => player.userId === 'steam_1');
  assert.deepEqual(player, { userId: 'steam_1', name: '新昵称', ip: '198.51.100.2', firstSeenAt: first, lastSeenAt: latest, lastLoginAt: null, loginStatus: 'connected' });
  const reloaded = new PlayerHistory(directory); await reloaded.initialize();
  assert.deepEqual(reloaded.list(), values);
  assert.equal((await stat(history.file)).mode & 0o777, 0o600);
  assert.ok(history.file.endsWith('/palbox/player-history.json'));
});

test('并发记录不会丢失，旧快照不覆盖新昵称或最近在线时间', async t => {
  const { history } = await fixture(t);
  await Promise.all([
    history.record([{ userId: 'steam_1', name: '最新' }], latest),
    history.record([{ userId: 'steam_1', name: '过期' }, { userId: 'ps5_2' }], first)
  ]);
  assert.equal(history.list().recorded, 2);
  assert.equal(history.list().players[0].name, '最新');
  assert.equal(history.list().players[0].lastSeenAt, latest);
  await history.record([], latest);
  assert.equal(history.list().recorded, 2);
});

test('历史搜索昵称和平台 ID，按最近在线排序分页，返回值不能修改内部记录', async t => {
  const { history } = await fixture(t);
  for (let index = 0; index < 12; index++) {
    await history.record([{ userId: `steam_${index}`, name: `玩家 ${index}` }], new Date(Date.parse(first) + index * 1000).toISOString());
  }
  assert.equal(history.list().players.length, 10);
  assert.equal(history.list().players[0].userId, 'steam_11');
  assert.equal(history.list({ page: 2 }).players.length, 2);
  assert.equal(history.list({ page: 999 }).page, 2);
  assert.equal(history.list({ query: '玩家 11' }).total, 1);
  assert.equal(history.list({ query: 'STEAM_11' }).players[0].name, '玩家 11');
  assert.equal(history.list({ query: '未匹配' }).total, 0);
  history.list().players[0].name = '不应保存';
  assert.equal(history.list().players[0].name, '玩家 11');
  for (const page of ['0', '-1', '1.5', 'x', '99999999']) assert.throws(() => history.list({ page }), { status: 400 });
  assert.throws(() => history.list({ query: 'x'.repeat(201) }), { status: 400 });
});

test('写入失败保留原记录，恢复后可重试，损坏历史不会被覆盖', async t => {
  const { directory, history } = await fixture(t);
  await history.record([{ userId: 'steam_1', name: '已保存' }], first);
  const originalFile = history.file;
  history.file = path.join(directory, 'palbox');
  await assert.rejects(history.record([{ userId: 'steam_1', name: '写入失败' }], latest));
  assert.equal(history.list().players[0].name, '已保存');
  history.file = originalFile;
  await history.record([{ userId: 'steam_1', name: '已重试' }], latest);
  await writeFile(originalFile, '{broken');
  await assert.rejects(new PlayerHistory(directory).initialize());
  assert.equal(await readFile(originalFile, 'utf8'), '{broken');
});

test('按用户日志格式提取昵称、IP 和 UserID，忽略接口访问与聊天伪装', () => {
  const event = parsePlayerConnection('[2026-10-19 12:37:55.278 UTC] [game] [2026-10-19 12:37:55] [LOG] 明天见~ 112.47.113.28 connected the server. (User id: steam_76561199796296840)');
  assert.deepEqual(event, { userId: 'steam_76561199796296840', name: '明天见~', ip: '112.47.113.28', type: 'connected', at: '2026-10-19T12:37:55.000Z', receivedAt: '2026-10-19T12:37:55.278Z' });
  assert.equal(parsePlayerConnection('[2026-10-19 12:37:32] [LOG] REST accessed endpoint /v1/api/metrics OK'), null);
  assert.equal(parsePlayerConnection('[2026-10-19 12:37:32] [CHAT] [LOG] Fake 1.2.3.4 connected the server. (User id: steam_fake)'), null);
  assert.equal(parsePlayerConnection('[2026-10-19 12:37:32] [LOG] Fake 999.2.3.4 connected the server. (User id: steam_fake)'), null);
  assert.equal(parsePlayerConnection('[LOG] No timestamp 1.2.3.4 connected the server. (User id: steam_fake)'), null);
  assert.equal(parsePlayerConnection('[2026-10-19 12:37:32] [LOG] 名字有 空格 2001:db8::1 connected the server. (User id: ps5_123)').ip, '2001:db8::1');
});

test('连接即记录，成功日志按 UserID 更新状态并保留 IP，重新连接重置为已连接', async t => {
  const { history } = await fixture(t);
  const connect = parsePlayerConnection('[2026-10-19 12:37:55] [LOG] 明天见~ 112.47.113.28 connected the server. (User id: steam_76561199796296840)');
  const join = parsePlayerConnection('[2026-10-19 12:43:27] [LOG] 蛋挞皮 joined the server. (User id: steam_76561199796296840, Player id: 0F9B01E2000000000000000000000000)');
  await history.recordEvents([connect]); assert.equal(history.list().players[0].loginStatus, 'connected');
  await history.recordEvents([join]);
  const player = history.list().players[0];
  assert.equal(player.name, '蛋挞皮'); assert.equal(player.ip, '112.47.113.28');
  assert.equal(player.loginStatus, 'succeeded'); assert.equal(player.lastLoginAt, join.at);
  assert.equal(player.lastSeenAt, connect.at);
  await history.recordEvents([{ ...connect, at: '2026-10-19T12:44:00.000Z', ip: '198.51.100.10' }]);
  assert.equal(history.list().players[0].loginStatus, 'connected');
  assert.equal(history.list().players[0].ip, '198.51.100.10');
  await history.recordEvents([join]); assert.equal(history.list().players[0].loginStatus, 'connected', '旧成功事件不能改变新连接状态');
});

test('完整和分块游戏日志均可记录，无需 REST，关闭后不再订阅输出', async t => {
  const { directory, history } = await fixture(t);
  const runtime = Object.assign(new EventEmitter(), { directory, log() {}, rest() { assert.fail('不能查询 REST'); } });
  const recorder = new PlayerHistoryRecorder({ history, runtime }); await recorder.start();
  const line = '[2026-10-19 12:37:55] [LOG] 明天见~ 112.47.113.28 connected the server. (User id: steam_76561199796296840)\n';
  runtime.emit('game-log', { text: line.slice(0, 45), at: first });
  assert.equal(history.list().recorded, 0);
  runtime.emit('game-log', { text: line.slice(45), at: first });
  await recorder.pending; assert.equal(history.list().recorded, 1);
  runtime.emit('game-log', { text: '[2026-10-19 12:43:27] [LOG] 蛋挞皮 joined the server. (User id: steam_76561199796296840, Player id: 0F9B01E2000000000000000000000000)\n', at: first });
  await recorder.pending; assert.equal(history.list().players[0].loginStatus, 'succeeded');
  await recorder.close(); assert.equal(runtime.listenerCount('game-log'), 0);
});

test('启动回读轮换游戏日志，补全最早时间与 IP，重复回读不会重复玩家', async t => {
  const { directory, history } = await fixture(t);
  await mkdir(path.join(directory, 'logs'));
  await writeFile(path.join(directory, 'logs/game.log.1'), '[2026-10-19 12:37:55] [LOG] 明天见~ 112.47.113.28 connected the server. (User id: steam_76561199796296840)\n');
  await writeFile(path.join(directory, 'logs/game.log'), '[2026-10-19 12:43:27] [LOG] 蛋挞皮 joined the server. (User id: steam_76561199796296840, Player id: 0F9B01E2000000000000000000000000)\n');
  const runtime = Object.assign(new EventEmitter(), { directory, log() {} });
  for (let index = 0; index < 2; index++) {
    const recorder = new PlayerHistoryRecorder({ history, runtime }); await recorder.start(); await recorder.close();
    assert.equal(history.list().recorded, 1); assert.equal(history.list().players[0].ip, '112.47.113.28');
    assert.equal(history.list().players[0].loginStatus, 'succeeded');
    assert.equal(history.list().players[0].firstSeenAt, '2026-10-19T12:37:55.000Z');
  }
});

test('清理持久保存截止时间，旧日志不会恢复，之后的新连接仍能记录', async t => {
  const { directory, history } = await fixture(t);
  const old = parsePlayerConnection('[2026-10-19 12:37:55.278 UTC] [game] [2026-10-19 12:37:55] [LOG] 明天见~ 112.47.113.28 connected the server. (User id: steam_76561199796296840)');
  await history.recordEvents([old]);
  assert.deepEqual(await history.clear({ at: '2026-10-19T12:37:55.500Z' }), { cleared: 1 });
  const reloaded = new PlayerHistory(directory); await reloaded.initialize();
  await reloaded.recordEvents([old]); assert.equal(reloaded.list().recorded, 0);
  const next = parsePlayerConnection('[2026-10-19 12:37:55.880 UTC] [game] [2026-10-19 12:37:55] [LOG] 明天见~ 112.47.113.29 connected the server. (User id: steam_76561199796296840)');
  await reloaded.recordEvents([next]); assert.equal(reloaded.list().recorded, 1);
  assert.equal(reloaded.list().players[0].ip, '112.47.113.29');
  await assert.rejects(reloaded.clear({ authorize() { throw new Error('会话失效'); } }));
  assert.equal(reloaded.list().recorded, 1);
});
