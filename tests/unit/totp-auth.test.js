import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Authentication, passwordRecord } from '../../backend/management/auth.js';
import { newSecret, newRecoveryCodes, recoveryHash } from '../../backend/management/totp.js';

const request = (ip = '203.0.113.8', headers = {}) => ({ headers, socket: { remoteAddress: ip } });
const response = () => ({ headers: {}, setHeader(key, value) { this.headers[key] = value; } });
async function fixture() {
  const codes = newRecoveryCodes();
  let admin = { username: 'admin', ...await passwordRecord('correct-password'), totp: { secret: newSecret(), lastCounter: -1, recoveryHashes: codes.map(recoveryHash) } };
  const auth = new Authentication(() => admin, { updateAdmin: async change => { admin = change(structuredClone(admin)); } });
  const start = async () => (await auth.login(request(), 'admin', 'correct-password', response())).challenge;
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
