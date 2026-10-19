import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Authentication, passwordRecord } from '../../backend/management/auth.js';
import { newSecret, newRecoveryCodes, recoveryHash } from '../../backend/management/totp.js';

const request = (ip = '203.0.113.8', headers = {}) => ({ headers, socket: { remoteAddress: ip } });
const response = () => ({ headers: {}, setHeader(key, value) { this.headers[key] = value; } });
async function fixture(options = {}) {
  const codes = newRecoveryCodes();
  let admin = { username: 'admin', ...await passwordRecord('correct-password'), totp: { secret: newSecret(), lastCounter: -1, recoveryHashes: codes.map(recoveryHash) } };
  let updates = Promise.resolve();
  const auth = new Authentication(() => admin, { ...options, updateAdmin: change => {
    const operation = updates.then(() => { admin = change(structuredClone(admin)); });
    updates = operation.catch(() => {});
    return operation;
  } });
  const start = async ip => (await auth.login(request(ip), 'admin', 'correct-password', response())).challenge;
  return { auth, codes, start };
}

test('过期、变更来源及账号验证设置后的挑战不能建立会话', async () => {
  for (const scenario of ['expired', 'address', 'changed']) {
    const { auth, codes, start } = await fixture();
    const challenge = await start();
    const state = [...auth.challenges.values()][0];
    if (scenario === 'expired') state.expires = Date.now() - 1;
    if (scenario === 'changed') state.signature = 'old';
    const result = response();
    await assert.rejects(auth.completeLogin(request(scenario === 'address' ? '203.0.113.9' : '203.0.113.8'), { challenge, code: codes[0] }, result), { status: 401 });
    assert.equal(result.headers['Set-Cookie'], undefined);
    assert.equal(auth.sessions.size, 0);
  }
});

test('更换 IP 和重新验证密码不能绕开账号二次验证冷却，冷却后可恢复登录', async () => {
  const { auth, start, codes } = await fixture({ maxFailures: 3, cooldownMs: 10000 });
  for (let index = 1; index <= 3; index++) {
    const ip = `203.0.113.${index}`;
    const challenge = await start(ip);
    await assert.rejects(auth.completeLogin(request(ip), { challenge, code: 'bad' }, response()), { status: 401 });
  }
  const blocked = response();
  await assert.rejects(auth.login(request('198.51.100.1'), 'admin', 'correct-password', blocked), { status: 429 });
  assert.ok(Number(blocked.headers['Retry-After']) > 0);
  assert.equal(auth.sessions.size, 0);
  auth.factorFailures.blockedUntil = Date.now() - 1;
  const challenge = await start('198.51.100.1');
  assert.ok((await auth.completeLogin(request('198.51.100.1'), { challenge, code: codes[0] }, response())).csrf);
  assert.equal(auth.factorFailures, null);
});

test('无效挑战不能触发账号级冷却，并发有效挑战共用失败预算', async () => {
  const { auth, start } = await fixture({ maxFailures: 3, cooldownMs: 10000 });
  for (let index = 1; index <= 6; index++) {
    await assert.rejects(auth.completeLogin(request(`198.51.100.${index}`), { challenge: 'fake', code: 'bad' }, response()), { status: 401 });
  }
  assert.equal(auth.factorFailures, null);
  const challenges = await Promise.all(Array.from({ length: 6 }, async (_, index) => {
    const ip = `203.0.113.${index + 1}`;
    return { ip, challenge: await start(ip) };
  }));
  const results = await Promise.allSettled(challenges.map(({ ip, challenge }) => auth.completeLogin(request(ip), { challenge, code: 'bad' }, response())));
  assert.deepEqual(results.map(result => result.reason.status).sort(), [401, 401, 401, 429, 429, 429]);
  assert.equal(auth.factorFailures.count, 3);
});

test('挑战失败五次后销毁，仍持有正确恢复码也需重新通过密码验证', async () => {
  const { auth, codes, start } = await fixture();
  const challenge = await start();
  for (let index = 0; index < 5; index++) await assert.rejects(auth.completeLogin(request(), { challenge, code: 'bad' }, response()), { status: 401 });
  assert.equal(auth.challenges.size, 0);
  await assert.rejects(auth.completeLogin(request(), { challenge, code: codes[0] }, response()), { status: 401 });
  const next = await start();
  assert.ok((await auth.completeLogin(request(), { challenge: next, code: codes[0] }, response())).csrf);
});

test('账号写入失败不会发放会话或永久消费恢复码，可重试同一挑战', async () => {
  const { auth, codes, start } = await fixture();
  const challenge = await start();
  const write = auth.updateAdmin;
  auth.updateAdmin = async change => { change(structuredClone(auth.adminRecord)); throw new Error('disk unavailable'); };
  const result = response();
  await assert.rejects(auth.completeLogin(request(), { challenge, code: codes[0] }, result), /disk unavailable/);
  assert.equal(result.headers['Set-Cookie'], undefined);
  assert.equal(auth.adminRecord.totp.recoveryHashes.length, 10);
  auth.updateAdmin = write;
  assert.ok((await auth.completeLogin(request(), { challenge, code: codes[0] }, response())).csrf);
});

test('绑定过期后不启用，旧密码会话不能跨二次验证设置变化复用', async () => {
  const admin = { username: 'admin', ...await passwordRecord('correct-password') };
  const auth = new Authentication(admin);
  const login = response();
  const { csrf } = await auth.login(request(), 'admin', 'correct-password', login);
  const sessionRequest = request('203.0.113.8', { cookie: login.headers['Set-Cookie'].split(';')[0], 'x-palbox-csrf': csrf });
  const setup = await auth.beginEnrollment(sessionRequest, 'correct-password', response());
  assert.match(setup.secret, /^[A-Z2-7]{32}$/);
  [...auth.enrollments.values()][0].expires = Date.now() - 1;
  await assert.rejects(auth.confirmEnrollment(sessionRequest, '123456', response()), { status: 409 });
  assert.equal(admin.totp, undefined);
  admin.totp = { secret: newSecret(), lastCounter: -1, recoveryHashes: [] };
  assert.equal(auth.session(sessionRequest), null);
});

test('修改密码写入失败不改变密码、不消费恢复码且不撤销现有会话', async () => {
  const { auth, codes } = await fixture();
  const sessionResponse = response();
  const { csrf } = auth.issueSession(request(), sessionResponse);
  const current = request('203.0.113.8', { cookie: sessionResponse.headers['Set-Cookie'].split(';')[0], 'x-palbox-csrf': csrf });
  const before = structuredClone(auth.adminRecord);
  const write = auth.updateAdmin;
  auth.updateAdmin = async change => { change(structuredClone(auth.adminRecord)); throw new Error('disk unavailable'); };
  const result = response();
  const input = { currentPassword: 'correct-password', newPassword: 'new-correct-password', code: codes[0] };
  await assert.rejects(auth.changePassword(current, input, result), /disk unavailable/);
  assert.deepEqual(auth.adminRecord, before);
  assert.ok(auth.session(current));
  assert.equal(result.headers['Set-Cookie'], undefined);
  auth.updateAdmin = write;
  assert.ok((await auth.changePassword(current, input, response())).csrf);
  assert.equal(auth.adminRecord.totp.recoveryHashes.length, 9);
  assert.equal(auth.session(current), null);
});

test('挑战在等待账号写入时过期或被撤销，也不能建立会话', async () => {
  for (const expired of [true, false]) {
    const { auth, codes, start } = await fixture();
    const challenge = await start();
    const write = auth.updateAdmin;
    auth.updateAdmin = async change => {
      if (expired) [...auth.challenges.values()][0].expires = Date.now() - 1;
      else auth.challenges.clear();
      return write(change);
    };
    await assert.rejects(auth.completeLogin(request(), { challenge, code: codes[0] }, response()), { status: 401 });
    assert.equal(auth.adminRecord.totp.recoveryHashes.length, 10);
    assert.equal(auth.sessions.size, 0);
  }
});
