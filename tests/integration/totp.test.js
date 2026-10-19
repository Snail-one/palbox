import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { managementFixture } from '../helpers/management-fixture.js';
import { Manager } from '../../backend/management/manager.js';
import { totpCode } from '../../backend/management/totp.js';

const at = offset => Math.floor(Date.now() / 30000) + offset;
async function post(f, route, body, options = {}) {
  const response = await f.request(route, { method: 'POST', body, ...options });
  return { status: response.status, headers: response.headers, body: await response.json() };
}
async function enroll(f) {
  await f.login();
  const setup = await post(f, '/api/security/totp/setup', { password: f.password });
  assert.equal(setup.status, 200);
  const enabled = await post(f, '/api/security/totp/enable', { code: totpCode(setup.body.secret, at(-1)) });
  assert.equal(enabled.status, 200);
  return { secret: setup.body.secret, codes: enabled.body.recoveryCodes, session: { cookie: enabled.headers.get('set-cookie').split(';')[0], csrf: enabled.body.csrf } };
}
async function challenge(f) {
  const first = await post(f, '/api/login', { username: f.username, password: f.password }, { authenticated: false });
  assert.equal(first.status, 200);
  assert.equal(first.body.totpRequired, true);
  assert.equal(first.headers.has('set-cookie'), false);
  assert.equal(first.body.csrf, undefined);
  return first.body.challenge;
}

test('TOTP 绑定要求登录、来源校验、密码重验和有效动态码，秘密不会被常规接口泄露', async t => {
  const f = await managementFixture(); t.after(() => f.close());
  assert.equal((await post(f, '/api/security/totp/setup', { password: f.password })).status, 401);
  const session = await f.login();
  assert.deepEqual(await (await f.request('/api/security/totp')).json(), { enabled: false, recoveryCodesRemaining: 0 });
  assert.equal((await post(f, '/api/security/totp/setup', { password: f.password }, { headers: { 'X-Palbox-CSRF': 'wrong' } })).status, 403);
  assert.equal((await post(f, '/api/security/totp/setup', { password: 'wrong' })).status, 401);
  const setup = await post(f, '/api/security/totp/setup', { password: f.password });
  assert.equal(setup.status, 200);
  assert.equal(f.manager.settings.admin.totp, undefined);
  assert.equal((await post(f, '/api/security/totp/enable', { code: 'invalid' })).status, 401);
  assert.equal(f.manager.settings.admin.totp, undefined);
  // A different fully authenticated session cannot confirm someone else's enrollment.
  const otherLogin = await post(f, '/api/login', { username: f.username, password: f.password }, { authenticated: false });
  const otherHeaders = { Cookie: otherLogin.headers.get('set-cookie').split(';')[0], 'X-Palbox-CSRF': otherLogin.body.csrf };
  assert.equal((await post(f, '/api/security/totp/enable', { code: totpCode(setup.body.secret, at(-1)) }, { headers: otherHeaders })).status, 409);
  const enabled = await post(f, '/api/security/totp/enable', { code: totpCode(setup.body.secret, at(-1)) });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.body.recoveryCodes.length, 10);
  assert.equal((await f.request('/api/settings', { headers: otherHeaders })).status, 401, '启用后使其他设备旧会话失效');
  assert.notEqual(enabled.headers.get('set-cookie').split(';')[0], session.cookie);
  assert.notEqual(enabled.body.csrf, session.csrf);
  assert.equal((await f.request('/api/settings', { headers: { Cookie: session.cookie } })).status, 401, '当前设备的旧 Cookie 也立即失效');
  assert.equal((await f.request('/api/settings')).status, 200, '新 Cookie 可继续访问');
  assert.equal((await post(f, '/api/security/totp/setup', { password: f.password }, { headers: { 'X-Palbox-CSRF': session.csrf } })).status, 403);
  const publicData = JSON.stringify(await (await f.request('/api/settings')).json()) + JSON.stringify(await (await f.request('/api/security/totp')).json()) + JSON.stringify(await (await f.request('/api/bootstrap')).json());
  assert.equal(publicData.includes(setup.body.secret), false);
  assert.equal(publicData.includes(enabled.body.recoveryCodes[0]), false);
  const stored = await readFile(f.manager.settingsFile, 'utf8');
  assert.equal(stored.includes(enabled.body.recoveryCodes[0]), false);
  assert.equal((await stat(f.manager.settingsFile)).mode & 0o777, 0o600);
  const logs = await f.runtime.logs('login');
  assert.equal(logs.includes(f.password), false);
  assert.equal(logs.includes(setup.body.secret), false);
  assert.equal(logs.includes(enabled.body.recoveryCodes[0]), false);
});

test('密码只创建短期挑战，二次验证成功才发会话，拒绝重放、跨来源及跳过密码', async t => {
  const f = await managementFixture(); t.after(() => f.close());
  const { secret } = await enroll(f);
  assert.equal((await f.request('/api/workspace', { authenticated: false })).status, 401);
  assert.equal((await post(f, '/api/login/totp', { code: totpCode(secret, at(0)) }, { authenticated: false })).status, 401);
  const token = await challenge(f);
  assert.equal((await post(f, '/api/login/totp', { challenge: token, code: 'bad' }, { authenticated: false })).status, 401);
  assert.equal((await post(f, '/api/login/totp', { challenge: token, code: totpCode(secret, at(0)) }, { authenticated: false, headers: { Origin: 'https://evil.invalid' } })).status, 403);
  const code = totpCode(secret, at(0));
  const loggedIn = await post(f, '/api/login/totp', { challenge: token, code }, { authenticated: false });
  assert.equal(loggedIn.status, 200);
  assert.ok(loggedIn.body.csrf);
  assert.ok(loggedIn.headers.get('set-cookie').includes('HttpOnly'));
  assert.equal((await post(f, '/api/login/totp', { challenge: token, code }, { authenticated: false })).status, 401);
  const next = await challenge(f);
  assert.equal((await post(f, '/api/login/totp', { challenge: next, code }, { authenticated: false })).status, 401);
  const cookie = loggedIn.headers.get('set-cookie').split(';')[0];
  assert.equal((await f.request('/api/workspace', { headers: { Cookie: cookie } })).status, 200);
});

test('恢复码并发只能成功一次，消费记录与 TOTP 设置跨重启保留', async t => {
  const f = await managementFixture(); t.after(() => f.close());
  const { codes, secret } = await enroll(f);
  const tokens = await Promise.all([challenge(f), challenge(f)]);
  const results = await Promise.all(tokens.map(token => post(f, '/api/login/totp', { challenge: token, code: codes[0] }, { authenticated: false })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 401]);
  assert.equal(f.manager.settings.admin.totp.recoveryHashes.length, 9);
  const restarted = new Manager({ directory: f.directory });
  await restarted.initialize(); t.after(() => restarted.close());
  assert.equal(restarted.settings.admin.totp.secret, secret);
  assert.equal(restarted.settings.admin.totp.recoveryHashes.length, 9);
  assert.equal(restarted.settings.admin.totp.lastCounter, f.manager.settings.admin.totp.lastCounter);
});

test('恢复码更新与关闭需要密码加第二因素，并且不能通过普通设置绕过', async t => {
  const f = await managementFixture(); t.after(() => f.close());
  const { codes, session } = await enroll(f);
  const pending = await challenge(f);
  const other = await post(f, '/api/login/totp', { challenge: await challenge(f), code: codes[9] }, { authenticated: false });
  const otherCookie = other.headers.get('set-cookie').split(';')[0];
  const before = f.manager.settings.admin.totp;
  assert.equal((await f.request('/api/settings', { method: 'PUT', body: { totp: null, admin: {} } })).status, 400);
  assert.deepEqual(f.manager.settings.admin.totp, before);
  assert.equal((await post(f, '/api/security/totp/disable', { password: 'wrong', code: codes[0] })).status, 401);
  assert.equal((await post(f, '/api/security/totp/disable', { password: f.password, code: 'bad' })).status, 401);
  const reset = await post(f, '/api/security/totp/recovery-codes', { password: f.password, code: codes[0] });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.recoveryCodes.length, 10);
  assert.notEqual(reset.body.csrf, session.csrf);
  const resetCookie = reset.headers.get('set-cookie').split(';')[0];
  assert.notEqual(resetCookie, session.cookie);
  for (const cookie of [session.cookie, otherCookie]) assert.equal((await f.request('/api/settings', { headers: { Cookie: cookie } })).status, 401);
  assert.equal((await post(f, '/api/login/totp', { challenge: pending, code: reset.body.recoveryCodes[1] }, { authenticated: false })).status, 401);
  const token = await challenge(f);
  assert.equal((await post(f, '/api/login/totp', { challenge: token, code: codes[1] }, { authenticated: false })).status, 401);
  const disabled = await post(f, '/api/security/totp/disable', { password: f.password, code: reset.body.recoveryCodes[0] });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.body.enabled, false);
  assert.notEqual(disabled.body.csrf, reset.body.csrf);
  assert.notEqual(disabled.headers.get('set-cookie').split(';')[0], resetCookie);
  assert.equal((await f.request('/api/settings', { headers: { Cookie: resetCookie } })).status, 401);
  assert.equal((await f.request('/api/settings')).status, 200);
  assert.equal(f.manager.settings.admin.totp, undefined);
  assert.equal((await post(f, '/api/login', { username: f.username, password: f.password }, { authenticated: false })).headers.has('set-cookie'), true);
});

test('直连客户端伪造转发头不能更改登录来源或重置限流', async t => {
  const f = await managementFixture(); t.after(() => f.close());
  for (let index = 1; index <= 10; index++) {
    assert.equal((await post(f, '/api/login', { username: f.username, password: 'wrong' }, { authenticated: false, headers: { 'X-Forwarded-For': `198.51.100.${index}`, 'X-Palbox-Client-IP': `192.0.2.${index}`, 'X-Real-IP': `203.0.113.${index}` } })).status, 401);
  }
  const blocked = await post(f, '/api/login', { username: f.username, password: f.password }, { authenticated: false, headers: { 'X-Forwarded-For': '198.51.100.99' } });
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get('retry-after'));
  const logs = await f.runtime.logs('login');
  assert.match(logs, /127\.0\.0\.1/);
  assert.equal(/198\.51\.100|192\.0\.2|203\.0\.113/.test(logs), false);
});

test('验证码错误会累积限流，重新提交正确密码不能重置二次验证失败次数', async t => {
  const f = await managementFixture(); t.after(() => f.close());
  await enroll(f);
  for (let i = 0; i < 10; i++) {
    const token = await challenge(f);
    assert.equal((await post(f, '/api/login/totp', { challenge: token, code: 'bad' }, { authenticated: false })).status, 401);
  }
  const blocked = await post(f, '/api/login', { username: f.username, password: f.password }, { authenticated: false });
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get('retry-after'));
});
