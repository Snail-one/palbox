import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { Authentication, passwordRecord } from '../../backend/management/auth.js';
import { body } from '../../backend/management/api.js';
import { saveName, worldName } from '../../backend/management/native-backups.js';
import { clientAddress as frontendClientAddress } from '../../frontend/http-server.js';
import { isLoopbackOrPrivate } from '../../shared/domain/network.js';

const record = async password => ({ username: 'admin', ...await passwordRecord(password) });
const request = (address, headers = {}) => ({ socket: { remoteAddress: address }, headers });
const response = () => ({ headers: {}, setHeader(name, value) { this.headers[name] = value; } });

test('网络地址分类只信任回环、内网和链路本地地址', () => {
  for (const address of ['127.0.0.1', '127.8.9.10', '::1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.5', '169.254.1.1', '::ffff:192.168.1.5', '::ffff:7f00:1', 'fd00::1', 'fe80::1']) {
    assert.equal(isLoopbackOrPrivate(address), true, address);
  }
  for (const address of ['8.8.8.8', '172.32.0.1', '100.64.0.1', '2001:db8::1', 'not-an-ip', '', undefined]) {
    assert.equal(isLoopbackOrPrivate(address), false, String(address));
  }
});

test('备份与世界中继 ID 拒绝末尾换行', () => {
  assert.equal(worldName.test('world'), true);
  assert.equal(worldName.test('world\n'), false);
  assert.equal(saveName.test('Level.sav'), true);
  assert.equal(saveName.test('Level.sav\n'), false);
});

test('客户端地址仅在可信代理来源时使用转发头', () => {
  const auth = new Authentication(null);
  assert.equal(auth.clientAddress(request('127.0.0.1', { 'x-palbox-client-ip': '203.0.113.9' })), '203.0.113.9');
  assert.equal(auth.clientAddress(request('172.18.0.2', { 'x-palbox-client-ip': '198.51.100.7' })), '198.51.100.7');
  assert.equal(auth.clientAddress(request('203.0.113.1', { 'x-palbox-client-ip': '10.0.0.1' })), '203.0.113.1');
  assert.equal(auth.clientAddress(request('203.0.113.1', { 'x-palbox-client-ip': 'not-an-ip' })), '203.0.113.1');
  assert.equal(auth.clientAddress(request('127.0.0.1', { 'x-palbox-client-ip': 'not-an-ip' })), '');
  assert.equal(auth.clientAddress(request('127.0.0.1', { 'x-palbox-client-ip': 'unknown' })), '');
  assert.equal(auth.clientAddress(request('127.0.0.1')), '127.0.0.1');
  assert.equal(auth.clientAddress(request('127.0.0.1', { 'x-palbox-client-ip': '10.0.0.1\n' })), '');
});

test('代理转发链从右向左跳过内网代理，拒绝伪造前缀', () => {
  const input = (peer, headers = {}) => ({ socket: { remoteAddress: peer }, headers });
  assert.equal(frontendClientAddress(input('127.0.0.1', { 'x-forwarded-for': '203.0.113.9' })), '203.0.113.9');
  assert.equal(frontendClientAddress(input('127.0.0.1', { 'x-forwarded-for': '10.0.0.1, 203.0.113.9' })), '203.0.113.9');
  assert.equal(frontendClientAddress(input('127.0.0.1', { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' })), '203.0.113.9');
  assert.equal(frontendClientAddress(input('127.0.0.1', { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' })), '10.0.0.1');
  assert.equal(frontendClientAddress(input('127.0.0.1', { 'x-forwarded-for': 'garbage' })), '');
  assert.equal(frontendClientAddress(input('127.0.0.1', { 'x-forwarded-for': 'garbage', 'x-real-ip': '198.51.100.7' })), '198.51.100.7');
  assert.equal(frontendClientAddress(input('127.0.0.1')), '127.0.0.1');
  assert.equal(frontendClientAddress(input('203.0.113.1', { 'x-forwarded-for': '10.0.0.1' })), '203.0.113.1');
});

test('登录限流只短暂冷却，不会永久锁死管理员', async () => {
  const auth = new Authentication(await record('correct-password-123'), { maxFailures: 3, cooldownMs: 25, windowMs: 1000 });
  const attacker = request('203.0.113.9');
  for (let index = 0; index < 3; index++) {
    await assert.rejects(auth.login(attacker, 'admin', 'wrong-password', response()), error => error.status === 401);
  }
  const blocked = response();
  await assert.rejects(auth.login(attacker, 'admin', 'correct-password-123', blocked), error => error.status === 429);
  assert.equal(blocked.headers['Retry-After'], '1');
  await new Promise(resolve => setTimeout(resolve, 35));
  const login = await auth.login(attacker, 'admin', 'correct-password-123', response());
  assert.match(login.csrf, /^[a-f0-9]{48}$/);
});

test('大量来源只淘汰旧记录，不会全局拒绝登录', async () => {
  const auth = new Authentication(await record('correct-password-123'), { maxFailures: 1, cooldownMs: 1000, maxEntries: 2, windowMs: 60000 });
  await assert.rejects(auth.login(request('198.51.100.1'), 'admin', 'wrong', response()), error => error.status === 401);
  await assert.rejects(auth.login(request('198.51.100.2'), 'admin', 'wrong', response()), error => error.status === 401);
  const login = await auth.login(request('198.51.100.3'), 'admin', 'correct-password-123', response());
  assert.ok(login.csrf);
});

test('登录失败写入审计日志且不包含密码', async () => {
  const lines = [];
  const auth = new Authentication(await record('correct-password-123'), { log: text => lines.push(text) });
  await assert.rejects(auth.login(request('203.0.113.9'), 'admin', 'do-not-log-this', response()), error => error.status === 401);
  assert.ok(lines.some(line => line.includes('登录失败')));
  assert.equal(lines.join('').includes('do-not-log-this'), false);
});

test('JSON 请求体有绝对读取超时、大小限制和类型校验', async () => {
  const slow = new PassThrough();
  slow.headers = { 'content-type': 'application/json' };
  await assert.rejects(body(slow, 1024, 20), error => error.status === 408 && /超时/.test(error.message));

  const oversized = new PassThrough();
  oversized.headers = { 'content-type': 'application/json' };
  const rejected = body(oversized, 4, 1000);
  oversized.end('{"a":1}');
  await assert.rejects(rejected, error => error.status === 413);

  const valid = new PassThrough();
  valid.headers = { 'content-type': 'application/json' };
  const parsed = body(valid, 1024, 1000);
  valid.end('{"ok":true}');
  assert.deepEqual(await parsed, { ok: true });

  const plain = new PassThrough();
  plain.headers = { 'content-type': 'text/plain' };
  await assert.rejects(body(plain, 1024, 1000), error => error.status === 415);
});
