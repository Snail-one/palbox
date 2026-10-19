import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { readFile, readdir, mkdir, rename, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { managementFixture } from '../helpers/management-fixture.js';
import { totpCode } from '../../backend/management/totp.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function pendingBody(f, route, session, { method = 'PUT', type = 'application/json' } = {}) {
  const arrived = once(f.backend, 'request');
  const request = httpRequest(f.apiBase + route, { method, headers: {
    Cookie: session.cookie, 'X-Palbox-CSRF': session.csrf, 'Content-Type': type
  } });
  const response = new Promise((resolve, reject) => {
    request.on('error', reject);
    request.on('response', incoming => { incoming.resume(); resolve(incoming); });
  });
  request.flushHeaders();
  await arrived;
  return { request, response };
}

for (const revoke of ['logout', 'rotation', 'password', 'username']) {
  test(`${revoke} 后，已通过入口认证但尚未读完请求体的写入全部拒绝`, async t => {
    const f = await managementFixture(); t.after(() => f.close());
    const session = await f.login();
    let secret;
    if (revoke === 'rotation') secret = (await (await f.request('/api/security/totp/setup', { method: 'POST', body: { password: f.password } })).json()).secret;
    const snapshot = f.manager.store.snapshot();
    const settings = await readFile(f.manager.settingsFile);
    const jobs = [
      ['/api/settings', { backupRetention: 7 }],
      ['/api/workspace', snapshot],
      ['/api/tasks', { action: 'save-world' }, { method: 'POST' }],
      ['/api/security/password', { currentPassword: f.password, newPassword: 'new-management-password-456' }, { method: 'POST' }],
      ['/api/security/username', { currentPassword: f.password, username: 'another-admin' }, { method: 'POST' }],
      ['/api/save-import', Buffer.from([0x1f, 0x8b]), { method: 'POST', type: 'application/gzip' }]
    ];
    const pending = [];
    for (const [route, body, options] of jobs) pending.push({ ...await pendingBody(f, route, session, options), body });
    t.after(() => pending.forEach(job => job.request.destroy()));
    const revocation = revoke === 'logout'
      ? await f.request('/api/logout', { method: 'POST' })
      : revoke === 'password' ? await f.request('/api/security/password', { method: 'POST', body: { currentPassword: f.password, newPassword: 'new-management-password-456' } })
      : revoke === 'username' ? await f.request('/api/security/username', { method: 'POST', body: { currentPassword: f.password, username: 'new-admin' } })
      : await f.request('/api/security/totp/enable', { method: 'POST', body: { code: totpCode(secret, Math.floor(Date.now() / 30000) - 1) } });
    assert.equal(revocation.status, 200);
    for (const job of pending) job.request.end(Buffer.isBuffer(job.body) ? job.body : JSON.stringify(job.body));
    assert.deepEqual((await Promise.all(pending.map(job => job.response))).map(response => response.statusCode), pending.map(() => 401));
    assert.deepEqual(f.manager.store.snapshot(), snapshot);
    assert.equal(f.manager.settings.backupRetention, 5);
    if (revoke === 'logout') assert.deepEqual(await readFile(f.manager.settingsFile), settings);
    assert.deepEqual(f.manager.tasks, []);
    assert.deepEqual(await readdir(f.manager.imports.root), []);
  });
}

for (const target of ['settings', 'workspace']) {
  test(`退出后拒绝已进入 ${target} 写入队列的请求`, async t => {
    const f = await managementFixture(); t.after(() => f.close()); await f.login();
    const gate = deferred(), queued = deferred();
    const object = target === 'settings' ? f.manager : f.manager.store;
    const queue = target === 'settings' ? 'settingsUpdates' : 'writes';
    const method = target === 'settings' ? 'updateSettings' : 'update';
    const original = object[method].bind(object);
    object[queue] = gate.promise;
    object[method] = (...args) => { const result = original(...args); queued.resolve(); return result; };
    const snapshot = f.manager.store.snapshot();
    const before = await readFile(target === 'settings' ? f.manager.settingsFile : f.manager.store.file);
    const writing = f.request(`/api/${target}`, { method: 'PUT', body: target === 'settings' ? { backupRetention: 8 } : snapshot });
    try {
      await queued.promise;
      assert.equal((await f.request('/api/logout', { method: 'POST' })).status, 200);
    } finally { gate.resolve(); }
    assert.equal((await writing).status, 401);
    assert.deepEqual(await readFile(target === 'settings' ? f.manager.settingsFile : f.manager.store.file), before);
    assert.deepEqual(f.manager.store.snapshot(), snapshot);
  });
}

test('备份任务在存档预检查后重新验证会话', async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  const gate = deferred(), checking = deferred();
  f.manager.requireWorldSave = () => { checking.resolve(); return gate.promise; };
  const submitting = f.request('/api/tasks', { method: 'POST', body: { action: 'backup' } });
  try {
    await checking.promise;
    assert.equal((await f.request('/api/logout', { method: 'POST' })).status, 200);
  } finally { gate.resolve(); }
  assert.equal((await submitting).status, 401);
  assert.deepEqual(f.manager.tasks, []);
  assert.equal(f.manager.busy, null);
});

for (const parent of ['backups', 'backups/manual']) {
  test(`备份下载、列举、恢复和创建均拒绝符号链接父目录 ${parent}`, async t => {
    const f = await managementFixture(); t.after(() => f.close()); await f.login();
    const outside = path.join(f.directory, 'outside');
    await mkdir(path.join(outside, 'manual'), { recursive: true });
    await writeFile(path.join(outside, 'secret.tar.gz'), 'private');
    await writeFile(path.join(outside, 'manual/secret.tar.gz'), 'private');
    await rename(path.join(f.directory, parent), path.join(f.directory, 'original'));
    await symlink(outside, path.join(f.directory, parent));
    assert.equal((await f.request('/api/backup?id=manual/secret.tar.gz')).status, 400);
    assert.equal((await f.request('/api/backups')).status, 400);
    await assert.rejects(f.manager.restore('manual/secret.tar.gz'), { status: 400 });
    await assert.rejects(f.manager.backup('manual'), { status: 400 });
    if (parent === 'backups') await assert.rejects(f.manager.native.export('WORLD/2026.01.01-00.00.00'), { status: 400 });
    assert.equal(await readFile(path.join(outside, 'secret.tar.gz'), 'utf8'), 'private');
  });
}
