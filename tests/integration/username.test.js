import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { managementFixture } from '../helpers/management-fixture.js';
import { Manager } from '../../backend/management/manager.js';
import { totpCode } from '../../backend/management/totp.js';

const rename = (f, body = {}, options = {}) => f.request('/api/security/username', {
  method: 'POST', body: { username: 'new-admin', currentPassword: f.password, ...body }, ...options
});
const login = (f, username) => f.request('/api/login', { method: 'POST', body: { username, password: f.password }, authenticated: false });
async function enableTotp(f) {
  const setup = await (await f.request('/api/security/totp/setup', { method: 'POST', body: { password: f.password } })).json();
  const response = await f.request('/api/security/totp/enable', { method: 'POST', body: { code: totpCode(setup.secret, Math.floor(Date.now() / 30000) - 1) } });
  assert.equal(response.status, 200);
  return { ...await response.json(), secret: setup.secret };
}

test('修改用户名要求登录、同源、CSRF 和当前密码，拒绝无效或相同名称', async t => {
  const f = await managementFixture(); t.after(() => f.close());
  assert.equal((await rename(f)).status, 401); await f.login();
  const before = await readFile(f.manager.settingsFile);
  assert.equal((await rename(f, {}, { headers: { Origin: 'https://evil.invalid' } })).status, 403);
  assert.equal((await rename(f, {}, { headers: { 'X-Palbox-CSRF': 'wrong' } })).status, 403);
  assert.equal((await rename(f, { currentPassword: 'wrong' })).status, 401);
  for (const username of [null, 12, '', ' ', 'a'.repeat(65), 'name\0', 'name\u200b', f.username, ` ${f.username} `]) {
    assert.equal((await rename(f, { username })).status, 400);
  }
  assert.deepEqual(await readFile(f.manager.settingsFile), before);
  assert.equal((await f.request('/api/security/totp')).status, 200);
});

test('修改用户名原子持久化、轮换当前会话并撤销旧会话，密码和其他设置保持原值', async t => {
  const f = await managementFixture(); t.after(() => f.close());
  const other = await f.login(), previous = await f.login();
  await f.request('/api/security/totp/setup', { method: 'POST', body: { password: f.password } });
  const before = structuredClone(f.manager.settings);
  const changed = await rename(f, { username: ' 新管理员 ' });
  assert.equal(changed.status, 200);
  const result = await changed.json();
  assert.equal(result.username, '新管理员'); assert.notEqual(result.csrf, previous.csrf);
  assert.notEqual(changed.headers.get('set-cookie').split(';')[0], previous.cookie);
  assert.deepEqual(f.manager.settings, { ...before, admin: { ...before.admin, username: '新管理员' } });
  for (const session of [previous, other]) assert.equal((await f.request('/api/settings', { headers: { Cookie: session.cookie } })).status, 401);
  assert.equal((await f.request('/api/settings')).status, 200);
  assert.equal((await f.request('/api/security/totp/enable', { method: 'POST', body: { code: '123456' } })).status, 409);
  assert.equal((await login(f, f.username)).status, 401);
  assert.equal((await login(f, '新管理员')).status, 200);
  const logs = await f.runtime.logs('login');
  assert.match(logs, /管理员用户名已修改/); assert.equal(logs.includes(f.password), false);
  assert.equal(JSON.stringify(result).includes(f.password), false);
  const restarted = new Manager({ directory: f.directory });
  await restarted.initialize(); t.after(() => restarted.close());
  assert.deepEqual(restarted.settings.admin, f.manager.settings.admin);
});

test('修改用户名验证二次因素并消费恢复码，保留绑定且撤销旧登录挑战', async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  const enabled = await enableTotp(f);
  const pending = await (await login(f, f.username)).json();
  const before = await readFile(f.manager.settingsFile);
  for (const code of [undefined, 'invalid', totpCode(enabled.secret, f.manager.settings.admin.totp.lastCounter)]) {
    assert.equal((await rename(f, { code })).status, 401);
    assert.deepEqual(await readFile(f.manager.settingsFile), before);
  }
  const changed = await rename(f, { code: enabled.recoveryCodes[0] });
  assert.equal(changed.status, 200); assert.equal((await changed.json()).recoveryCodesRemaining, 9);
  assert.equal(f.manager.settings.admin.totp.secret, enabled.secret);
  assert.equal((await f.request('/api/login/totp', { method: 'POST', authenticated: false, body: { challenge: pending.challenge, code: enabled.recoveryCodes[1] } })).status, 401);
  assert.equal((await login(f, f.username)).status, 401);
  const next = await (await login(f, 'new-admin')).json(); assert.equal(next.totpRequired, true);
  assert.equal((await f.request('/api/login/totp', { method: 'POST', authenticated: false, body: { challenge: next.challenge, code: enabled.recoveryCodes[0] } })).status, 401);
  assert.equal((await f.request('/api/login/totp', { method: 'POST', authenticated: false, body: { challenge: next.challenge, code: enabled.recoveryCodes[1] } })).status, 200);
});

test('修改用户名排队时退出会撤销写入，并发修改只有一个能成功', async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  const before = await readFile(f.manager.settingsFile);
  let release, arrived;
  f.manager.settingsUpdates = new Promise(resolve => { release = resolve; });
  const queued = new Promise(resolve => { arrived = resolve; });
  const update = f.manager.updateAdmin.bind(f.manager);
  f.manager.updateAdmin = (...args) => { const result = update(...args); arrived(); return result; };
  const changing = rename(f);
  try { await queued; await f.request('/api/logout', { method: 'POST' }); }
  finally { release(); }
  assert.equal((await changing).status, 401);
  assert.deepEqual(await readFile(f.manager.settingsFile), before);
  await f.login();
  const results = await Promise.all([rename(f), rename(f, { username: 'another-admin' })]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 401]);
  assert.equal((await login(f, results[0].ok ? 'new-admin' : 'another-admin')).status, 200);
});

test('修改用户名持久化失败时保留旧账号、会话与恢复码，可重试同一码', async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  const enabled = await enableTotp(f);
  const original = f.manager.settingsFile, before = await readFile(original);
  f.manager.settingsFile = path.join(original, 'invalid');
  try { assert.equal((await rename(f, { code: enabled.recoveryCodes[0] })).status, 500); }
  finally { f.manager.settingsFile = original; }
  assert.deepEqual(await readFile(original), before);
  assert.equal(f.manager.settings.admin.username, f.username);
  assert.equal((await f.request('/api/security/totp')).status, 200);
  assert.equal((await rename(f, { code: enabled.recoveryCodes[0] })).status, 200);
});
