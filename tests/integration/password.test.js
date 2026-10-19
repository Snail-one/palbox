import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { managementFixture } from '../helpers/management-fixture.js';
import { Manager } from '../../backend/management/manager.js';
import { totpCode } from '../../backend/management/totp.js';

const newPassword = 'new-management-password-456';
const change = (f, body = {}, options = {}) => f.request('/api/security/password', {
  method: 'POST', body: { currentPassword: f.password, newPassword, ...body }, ...options
});
const login = (f, password) => f.request('/api/login', { method: 'POST', body: { username: f.username, password }, authenticated: false });

test('修改密码要求登录、同源、CSRF 和当前密码，拒绝无效新密码且不改变账号', async t => {
  const f = await managementFixture(); t.after(() => f.close());
  assert.equal((await change(f)).status, 401);
  await f.login();
  const before = await readFile(f.manager.settingsFile);
  assert.equal((await change(f, {}, { headers: { Origin: 'https://evil.invalid' } })).status, 403);
  assert.equal((await change(f, {}, { headers: { 'X-Palbox-CSRF': 'wrong' } })).status, 403);
  assert.equal((await change(f, { currentPassword: 'wrong' })).status, 401);
  for (const password of [null, 123456789012, '', 'a'.repeat(11), 'a'.repeat(1025), f.password]) {
    assert.equal((await change(f, { newPassword: password })).status, 400);
  }
  assert.deepEqual(await readFile(f.manager.settingsFile), before);
  assert.equal((await f.request('/api/settings')).status, 200);
});

test('修改密码轮换当前会话、撤销其他会话与绑定，持久化后仅新密码可登录', async t => {
  const f = await managementFixture(); t.after(() => f.close());
  const other = await f.login();
  const original = await f.login();
  assert.equal((await f.request('/api/security/totp/setup', { method: 'POST', body: { password: f.password } })).status, 200);
  const changed = await change(f);
  assert.equal(changed.status, 200);
  const result = await changed.json();
  assert.notEqual(result.csrf, original.csrf);
  assert.notEqual(changed.headers.get('set-cookie').split(';')[0], original.cookie);
  for (const session of [original, other]) {
    assert.equal((await f.request('/api/settings', { headers: { Cookie: session.cookie } })).status, 401);
  }
  assert.equal((await f.request('/api/settings')).status, 200);
  assert.equal((await f.request('/api/security/totp/enable', { method: 'POST', body: { code: '123456' } })).status, 409);
  assert.equal((await login(f, f.password)).status, 401);
  assert.equal((await login(f, newPassword)).status, 200);
  assert.equal(f.manager.settings.admin.username, f.username);
  const stored = await readFile(f.manager.settingsFile, 'utf8');
  const logs = await f.runtime.logs('login');
  assert.match(logs, /管理员密码已修改/);
  for (const secret of [f.password, newPassword]) {
    assert.equal(stored.includes(secret), false);
    assert.equal(logs.includes(secret), false);
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
  const restarted = new Manager({ directory: f.directory });
  await restarted.initialize(); t.after(() => restarted.close());
  assert.deepEqual(restarted.settings.admin, f.manager.settings.admin);
});

test('启用二次验证后修改密码需要有效第二因素，消费恢复码并撤销旧挑战', async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  const setup = await (await f.request('/api/security/totp/setup', { method: 'POST', body: { password: f.password } })).json();
  const enabled = await (await f.request('/api/security/totp/enable', {
    method: 'POST', body: { code: totpCode(setup.secret, Math.floor(Date.now() / 30000) - 1) }
  })).json();
  const pending = await (await login(f, f.password)).json();
  const before = await readFile(f.manager.settingsFile);
  for (const code of [undefined, 'bad', totpCode(setup.secret, f.manager.settings.admin.totp.lastCounter)]) {
    assert.equal((await change(f, { code })).status, 401);
    assert.deepEqual(await readFile(f.manager.settingsFile), before);
  }
  const changed = await change(f, { code: enabled.recoveryCodes[0] });
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).recoveryCodesRemaining, 9);
  assert.equal(f.manager.settings.admin.totp.secret, setup.secret);
  assert.equal((await f.request('/api/login/totp', {
    method: 'POST', authenticated: false, body: { challenge: pending.challenge, code: enabled.recoveryCodes[1] }
  })).status, 401);
  assert.equal((await login(f, f.password)).status, 401);
  const next = await (await login(f, newPassword)).json();
  assert.equal(next.totpRequired, true);
  assert.equal((await f.request('/api/login/totp', {
    method: 'POST', authenticated: false, body: { challenge: next.challenge, code: enabled.recoveryCodes[0] }
  })).status, 401);
  assert.equal((await f.request('/api/login/totp', {
    method: 'POST', authenticated: false, body: { challenge: next.challenge, code: enabled.recoveryCodes[1] }
  })).status, 200);
});

test('修改密码排队期间退出后，拒绝写入且保持原密码', async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  const before = await readFile(f.manager.settingsFile);
  let release, arrived;
  f.manager.settingsUpdates = new Promise(resolve => { release = resolve; });
  const queued = new Promise(resolve => { arrived = resolve; });
  const original = f.manager.updateAdmin.bind(f.manager);
  f.manager.updateAdmin = (...args) => { const pending = original(...args); arrived(); return pending; };
  const changing = change(f);
  try {
    await queued;
    assert.equal((await f.request('/api/logout', { method: 'POST' })).status, 200);
  } finally { release(); }
  assert.equal((await changing).status, 401);
  assert.deepEqual(await readFile(f.manager.settingsFile), before);
  assert.equal((await login(f, f.password)).status, 200);
});

test('并发修改密码只能有一次成功，另一请求不能覆盖新密码', async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  const results = await Promise.all([change(f), change(f, { newPassword: 'another-new-password-789' })]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 401]);
  const winner = results[0].ok ? newPassword : 'another-new-password-789';
  assert.equal((await login(f, winner)).status, 200);
  assert.equal((await login(f, f.password)).status, 401);
});
