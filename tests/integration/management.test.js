import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, access, symlink } from 'node:fs/promises';
import path from 'node:path';
import { managementFixture } from '../helpers/management-fixture.js';
import { parse } from '../../src/domain/config.js';

const value = (source, key) => parse(source).entries.find(e => e.key === key)?.raw;

test('管理 API 登录、权限、并发保存与路径边界', { skip: process.platform !== 'linux' }, async t => {
  const f = await managementFixture(); t.after(() => f.close());
  assert.deepEqual(await (await f.request('/api/bootstrap', { authenticated: false })).json(), { mode: 'managed', authenticated: false });
  assert.equal((await f.request('/api/workspace', { authenticated: false })).status, 401);
  assert.equal((await f.request('/api/login', { method: 'POST', body: { password: 'wrong' }, authenticated: false })).status, 401);
  assert.equal((await f.request('/api/login', { method: 'POST', body: { password: f.password }, authenticated: false, headers: { Origin: 'https://evil.invalid' } })).status, 403);
  const session = await f.login();
  assert.ok(session.cookie.includes('palbox_session='));
  const bootstrap = await (await f.request('/api/bootstrap')).json();
  assert.equal(bootstrap.authenticated, true);
  assert.equal((await f.request('/api/tasks', { method: 'POST', body: { action: 'install' }, headers: { 'X-Palbox-CSRF': 'bad' } })).status, 403);
  assert.equal((await f.request('/api/workspace', { method: 'PUT', body: null })).status, 400);
  const snapshot = await (await f.request('/api/workspace')).json();
  const original = snapshot.workspace.profiles[0].initialSource;
  snapshot.workspace.profiles[0].source = snapshot.workspace.profiles[0].source.replace('ExpRate=1.000000', 'ExpRate=2');
  snapshot.workspace.profiles[0].initialSource = 'OptionSettings=(Wrong=1)';
  const results = await Promise.all([f.request('/api/workspace', { method: 'PUT', body: snapshot }), f.request('/api/workspace', { method: 'PUT', body: snapshot })]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const current = await (await f.request('/api/workspace')).json();
  assert.equal(value(current.workspace.profiles[0].source, 'ExpRate'), '2');
  assert.equal(current.workspace.profiles[0].initialSource, original);
  assert.equal((await f.request('/api/settings')).status, 200);
  assert.equal(JSON.stringify(await (await f.request('/api/settings')).json()).includes('hash'), false);
  for (const route of ['/api/backup?id=../../etc/passwd', '/api/logs?channel=../../etc/passwd']) assert.ok((await f.request(route)).status >= 400);
  for (const route of ['/data/palbox/settings.json', '/server/management/auth.js', '/.env']) assert.equal((await f.request(route)).status, 404);
  assert.equal((await f.request('/api/logout', { method: 'POST', body: {} })).status, 200);
  assert.equal((await f.request('/api/status')).status, 401);
});

test('SteamCMD、进程、配置应用、备份恢复与故障状态真实联动', { skip: process.platform !== 'linux' }, async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  assert.equal((await f.manager.status()).installed, false);
  assert.equal((await f.task('install')).state, 'succeeded');
  assert.equal((await f.manager.status()).installed, true);
  assert.match(await f.runtime.logs('steamcmd'), /simulated installation complete/);
  await mkdir(path.join(f.runtime.saved, 'SaveGames/0/test-world'), { recursive: true });
  const world = path.join(f.runtime.saved, 'SaveGames/0/test-world/Level.sav');
  await writeFile(world, 'world-v1');
  const starting = await f.request('/api/tasks', { method: 'POST', body: { action: 'start' } });
  assert.equal(starting.status, 202);
  assert.equal((await f.request('/api/tasks', { method: 'POST', body: { action: 'update' } })).status, 409);
  await f.manager.operation;
  assert.equal(f.manager.tasks[0].state, 'succeeded', f.manager.tasks[0].message);
  let status = await f.manager.status();
  assert.equal(status.ready, true); assert.equal(status.info.version, 'test-1.0'); assert.equal(status.players[0].userId, 'steam_test');
  const snapshot = f.manager.store.snapshot();
  snapshot.workspace.profiles[0].source = snapshot.workspace.profiles[0].source.replace('ExpRate=1.000000', 'ExpRate=2');
  await f.manager.store.update(snapshot.workspace, snapshot.revision);
  assert.equal(value(await readFile(f.runtime.config, 'utf8'), 'ExpRate'), '1.000000');
  assert.equal((await f.manager.status()).configuration, 'pending');
  const applied = await f.task('apply', { revision: f.manager.store.revision, profileId: f.manager.store.active().id });
  assert.equal(applied.state, 'succeeded', applied.message);
  assert.equal(value(await readFile(f.runtime.config, 'utf8'), 'ExpRate'), '2.000000');
  await access(path.join(f.runtime.saved, 'saved-by-api'));
  assert.equal((await f.manager.status()).configuration, 'applied');
  assert.equal(f.runtime.ready, true);
  assert.equal((await f.task('announce', { message: 'test broadcast' })).state, 'succeeded');
  assert.equal((await f.task('kick', { userid: 'steam_test' })).state, 'succeeded');
  assert.equal((await f.task('save-world')).state, 'succeeded');
  const unsafeDirectory = path.join(f.directory, 'unsafe/Pal/Saved');
  await mkdir(unsafeDirectory, { recursive: true });
  await writeFile(path.join(f.directory, 'unsafe/outside'), 'must not extract');
  const unsafePath = path.join(f.directory, 'backups/manual/unsafe-path.tar.gz');
  await f.runtime.run('tar', ['-czf', unsafePath, '-C', path.join(f.directory, 'unsafe'), '--', 'outside']);
  assert.equal((await f.task('restore', { id: 'manual/unsafe-path.tar.gz' })).state, 'failed');
  await symlink('/etc/passwd', path.join(unsafeDirectory, 'outside-link'));
  await f.runtime.run('tar', ['-czf', path.join(f.directory, 'backups/manual/unsafe-link.tar.gz'), '-C', path.join(f.directory, 'unsafe'), '--', 'Pal/Saved']);
  assert.equal((await f.task('restore', { id: 'manual/unsafe-link.tar.gz' })).state, 'failed');
  assert.equal(await readFile(world, 'utf8'), 'world-v1');
  assert.ok(f.runtime.game);
  const backup = await f.task('backup');
  assert.equal(backup.state, 'succeeded', backup.message);
  const download = await f.request('/api/backup?id=' + encodeURIComponent(backup.backup));
  assert.equal(download.status, 200); assert.equal(download.headers.get('content-type'), 'application/gzip');
  assert.ok((await download.arrayBuffer()).byteLength > 0);
  await writeFile(world, 'world-v2');
  await f.manager.updateSettings({ backupRetention: 1 });
  const restored = await f.task('restore', { id: backup.backup });
  assert.equal(restored.state, 'succeeded', restored.message);
  assert.equal(await readFile(world, 'utf8'), 'world-v1');
  assert.equal(f.runtime.ready, true);
  assert.equal((await f.task('update')).state, 'succeeded');
  assert.ok((await f.manager.backups()).some(b => b.category === 'before-update'));
  await writeFile(path.join(f.runtime.saved, 'fail-save'), 'fail');
  const diskBefore = await readFile(f.runtime.config, 'utf8');
  const failed = await f.task('apply', { revision: f.manager.store.revision, profileId: f.manager.store.active().id });
  assert.equal(failed.state, 'failed');
  assert.equal(await readFile(f.runtime.config, 'utf8'), diskBefore);
  assert.ok(f.runtime.game);
  assert.equal((await f.task('stop')).state, 'succeeded');
  assert.equal((await f.manager.status()).running, false);
  assert.equal((await f.request('/api/status')).status, 200);
});

test('启动脚本要求自设首次密码、重启沿用原密码，密码不以明文输出或存盘', { skip: process.platform !== 'linux', timeout: 15000 }, async t => {
  const { spawn } = await import('node:child_process');
  const { mkdtemp, rm, stat } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { once } = await import('node:events');
  const { createServer } = await import('node:net');
  const { fileURLToPath } = await import('node:url');
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-index-'));
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const password = 'index-test-password-123';
  const env = { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH, HOST: '127.0.0.1', PORT: String(port), PALBOX_DATA_DIR: directory, PALBOX_AUTO_INSTALL: 'false', PALBOX_AUTO_START: 'false' };
  delete env.PALBOX_ADMIN_PASSWORD;
  delete env.PALBOX_ADMIN_PASSWORD_FILE;
  const children = [];
  t.after(async () => {
    for (const { child } of children) {
      if (child.exitCode === null && child.signalCode === null) { const done = once(child, 'exit'); child.kill('SIGKILL'); await done; }
    }
    await rm(directory, { recursive: true, force: true });
  });
  function launch(overrides = {}) {
    const child = spawn('bash', [fileURLToPath(new URL('../../dev.sh', import.meta.url)), '--no-watch'], {
      env: { ...env, ...overrides }, stdio: ['ignore', 'pipe', 'pipe']
    });
    const run = { child, output: '', closed: once(child, 'close') };
    child.stdout.on('data', data => { run.output += data; }); child.stderr.on('data', data => { run.output += data; });
    children.push(run);
    return run;
  }
  async function ready(run) {
    const deadline = Date.now() + 5000;
    while (!run.output.includes('已启动') && Date.now() < deadline && run.child.exitCode === null) await new Promise(resolve => setTimeout(resolve, 30));
    assert.match(run.output, /已启动/);
    assert.equal(run.output.includes(password), false);
  }
  const missing = launch();
  assert.equal((await missing.closed)[0], 1);
  assert.match(missing.output, /首次启动请设置至少 12 位的 PALBOX_ADMIN_PASSWORD/);
  await assert.rejects(access(path.join(directory, 'palbox/settings.json')), { code: 'ENOENT' });
  const initialized = launch({ PALBOX_ADMIN_PASSWORD: password });
  await ready(initialized);
  assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 200);
  assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/bootstrap`)).json()).mode, 'managed');
  const settings = await readFile(path.join(directory, 'palbox/settings.json'), 'utf8');
  assert.equal(settings.includes(password), false);
  assert.equal((await stat(path.join(directory, 'palbox/settings.json'))).mode & 0o777, 0o600);
  initialized.child.kill('SIGTERM');
  assert.equal((await initialized.closed)[0], 0);
  const restarted = launch();
  await ready(restarted);
  const login = await fetch(`http://127.0.0.1:${port}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  assert.equal(login.status, 200);
  assert.equal(await readFile(path.join(directory, 'palbox/settings.json'), 'utf8'), settings);
  restarted.child.kill('SIGTERM');
  assert.equal((await restarted.closed)[0], 0);
});
