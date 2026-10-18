import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, access, symlink, utimes } from 'node:fs/promises';
import path from 'node:path';
import { managementFixture } from '../helpers/management-fixture.js';
import { parse } from '../../shared/domain/config.js';
import { DERIVED_DEFAULT_ORIGIN, OFFICIAL_DEFAULT_ORIGIN } from '../../shared/domain/workspace.js';

const value = (source, key) => parse(source).entries.find(e => e.key === key)?.raw;

test('管理 API 登录、权限、并发保存与路径边界', { skip: process.platform !== 'linux' }, async t => {
  const f = await managementFixture(); t.after(() => f.close());
  assert.deepEqual(await (await f.request('/api/bootstrap', { authenticated: false })).json(), { mode: 'managed', authenticated: false });
  assert.equal((await f.request('/api/workspace', { authenticated: false })).status, 401);
  assert.equal((await f.request('/api/login', { method: 'POST', body: { username: f.username, password: 'wrong' }, authenticated: false })).status, 401);
  assert.equal((await f.request('/api/login', { method: 'POST', body: { username: 'wrong-user', password: f.password }, authenticated: false })).status, 401);
  assert.equal((await f.request('/api/login', { method: 'POST', body: { username: f.username, password: f.password }, authenticated: false, headers: { Origin: 'https://evil.invalid' } })).status, 403);
  const session = await f.login();
  assert.ok(session.cookie.includes('palbox_session='));
  const bootstrap = await (await f.request('/api/bootstrap')).json();
  assert.equal(bootstrap.authenticated, true);
  const defaults = await (await f.request('/api/default-configuration')).json();
  assert.equal(value(defaults.source, 'ServerName'), '"Default Palworld Server"');
  assert.equal(value(defaults.source, 'RESTAPIEnabled'), 'True');
  assert.equal((await f.request('/api/tasks', { method: 'POST', body: { action: 'install' }, headers: { 'X-Palbox-CSRF': 'bad' } })).status, 403);
  assert.equal((await f.request('/api/workspace', { method: 'PUT', body: null })).status, 400);
  const snapshot = await (await f.request('/api/workspace')).json();
  assert.equal(snapshot.workspace.profiles[0].origin, DERIVED_DEFAULT_ORIGIN);
  const locked = snapshot.workspace.profiles.find(profile => profile.locked);
  assert.ok(locked);
  assert.equal(locked.origin, OFFICIAL_DEFAULT_ORIGIN);
  assert.equal(locked.name, '游戏默认配置');
  assert.notEqual(snapshot.workspace.activeId, locked.id);
  const original = snapshot.workspace.profiles[0].initialSource;
  snapshot.workspace.profiles[0].source = snapshot.workspace.profiles[0].source.replace('ExpRate=1.000000', 'ExpRate=2');
  snapshot.workspace.profiles[0].initialSource = 'OptionSettings=(Wrong=1)';
  const results = await Promise.all([f.request('/api/workspace', { method: 'PUT', body: snapshot }), f.request('/api/workspace', { method: 'PUT', body: snapshot })]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const current = await (await f.request('/api/workspace')).json();
  assert.equal(value(current.workspace.profiles[0].source, 'ExpRate'), '2');
  assert.equal(current.workspace.profiles[0].initialSource, original);
  assert.equal(current.workspace.profiles[0].origin, DERIVED_DEFAULT_ORIGIN);
  assert.equal(current.workspace.profiles.find(profile => profile.locked).source, locked.source);
  const defaultFile = path.join(f.directory, 'server/DefaultPalWorldSettings.ini');
  const changedDefault = (await readFile(defaultFile, 'utf8')).replace('ExpRate=1.000000', 'ExpRate=6.000000');
  await writeFile(defaultFile, changedDefault);
  const refreshed = await (await f.request('/api/workspace')).json();
  assert.equal(refreshed.workspace.profiles.find(profile => profile.locked).source, changedDefault);
  const lockedProfile = refreshed.workspace.profiles.find(profile => profile.locked);
  const workingProfile = refreshed.workspace.profiles.find(profile => profile.id === refreshed.workspace.activeId);
  lockedProfile.source = workingProfile.source.replace('ExpRate=2,', 'ExpRate=5,');
  refreshed.workspace.activeId = lockedProfile.id;
  assert.equal((await f.request('/api/workspace', { method: 'PUT', body: refreshed })).status, 200);
  const edited = await (await f.request('/api/workspace')).json();
  const editedLocked = edited.workspace.profiles.find(profile => profile.locked);
  assert.equal(edited.workspace.activeId, lockedProfile.id);
  assert.equal(value(editedLocked.source, 'ExpRate'), '5');
  assert.equal(editedLocked.name, '游戏默认配置');
  assert.equal(editedLocked.origin, OFFICIAL_DEFAULT_ORIGIN);
  assert.equal((await f.request('/api/settings')).status, 200);
  assert.equal(JSON.stringify(await (await f.request('/api/settings')).json()).includes('hash'), false);
  for (const route of ['/api/backup?id=../../etc/passwd', '/api/logs?channel=../../etc/passwd']) assert.ok((await f.request(route)).status >= 400);
  for (const route of ['/data/palbox/settings.json', '/server/management/auth.js', '/.env']) assert.equal((await f.request(route)).status, 404);
  assert.equal((await f.request('/api/logout', { method: 'POST', body: {} })).status, 200);
  assert.equal((await f.request('/api/status')).status, 401);
});

test('启动参数通过设置接口保存，并在启动和重启时生效', { skip: process.platform !== 'linux' }, async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  const settings = () => f.request('/api/settings');
  const put = body => f.request('/api/settings', { method: 'PUT', body });
  const installArgs = ['+force_install_dir', f.runtime.server, '+login', 'anonymous', '+app_update', '2394010', 'validate', '+quit'];
  assert.deepEqual(await (await settings()).json(), { backupRetention: 10, autoStart: false, gameArgs: [], installArgs });
  assert.deepEqual(f.runtime.args, []);
  for (const body of [
    {}, { gameArgs: '-x' }, { gameArgs: [1] }, { gameArgs: [''] }, { gameArgs: ['   '] },
    { gameArgs: ['-port=8211'] }, { gameArgs: ['-Port 8211'] }, { gameArgs: ['foo -port=8211'] },
    { gameArgs: ['bad\narg'] }, { gameArgs: ['bad\rarg'] }, { gameArgs: ['bad\0arg'] },
    { gameArgs: Array.from({ length: 33 }, () => '-x') }, { gameArgs: ['x'.repeat(201)] },
    { gameArgs: Array.from({ length: 10 }, () => 'x'.repeat(200)) }
  ]) assert.equal((await put(body)).status, 400, JSON.stringify(body).slice(0, 80));
  assert.deepEqual(await (await settings()).json(), { backupRetention: 10, autoStart: false, gameArgs: [], installArgs });
  assert.deepEqual(f.runtime.args, []);
  assert.equal((await put({ autoStart: 'yes' })).status, 400);
  const auto = await put({ autoStart: true });
  assert.equal(auto.status, 200);
  assert.equal((await auto.json()).autoStart, true);
  assert.equal(JSON.parse(await readFile(path.join(f.directory, 'palbox/settings.json'), 'utf8')).autoStart, true);
  assert.equal((await put({ autoStart: false })).status, 200);
  const args = ['-useperfthreads', '-NoAsyncLoadingThread', '--name=two words'];
  const saved = await put({ gameArgs: args });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { backupRetention: 10, autoStart: false, gameArgs: args, installArgs });
  assert.deepEqual(f.runtime.args, args);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.directory, 'palbox/settings.json'), 'utf8')).gameArgs, args);
  assert.equal((await put({ gameArgs: ['-portrait'] })).status, 200);
  assert.deepEqual(f.runtime.args, ['-portrait']);
  assert.equal((await put({ gameArgs: args })).status, 200);
  for (const body of [
    { installArgs: 'x' }, { installArgs: [] }, { installArgs: ['+quit'] },
    { installArgs: ['+force_install_dir', '/tmp', '+app_update', '2394010', '+quit'] },
    { installArgs: ['+force_install_dir', f.runtime.server, '+app_update', '1', '+quit'] },
    { installArgs: ['+force_install_dir', f.runtime.server, '+app_update', '2394010'] },
    { installArgs: ['+force_install_dir', f.runtime.server, '+app_update', '2394010', 'bad\narg', '+quit'] },
    { installArgs: Array.from({ length: 65 }, () => 'x') }
  ]) assert.equal((await put(body)).status, 400, JSON.stringify(body).slice(0, 80));
  const customInstall = ['+force_install_dir', f.runtime.server, '+login', 'anonymous', '+app_update', '2394010', '-beta', 'public', 'validate', '+quit'];
  const installSaved = await put({ installArgs: customInstall });
  assert.equal(installSaved.status, 200);
  assert.deepEqual((await installSaved.json()).installArgs, customInstall);
  assert.deepEqual(f.runtime.installArgs, customInstall);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.directory, 'palbox/settings.json'), 'utf8')).installArgs,
    ['+force_install_dir', '{server}', '+login', 'anonymous', '+app_update', '2394010', '-beta', 'public', 'validate', '+quit']);
  assert.equal((await put({ installArgs })).status, 200);
  assert.deepEqual(f.runtime.installArgs, installArgs);
  assert.equal((await f.task('install')).state, 'succeeded');
  assert.equal((await f.task('start')).state, 'succeeded');
  assert.deepEqual(JSON.parse(await readFile(f.argvFile, 'utf8')), ['-port=8211', ...args]);
  const pid = f.runtime.game.pid;
  const nextArgs = ['-useperfthreads', '--name=after save'];
  assert.equal((await put({ gameArgs: nextArgs })).status, 200);
  assert.equal(f.runtime.game.pid, pid);
  assert.deepEqual(JSON.parse(await readFile(f.argvFile, 'utf8')), ['-port=8211', ...args]);
  const restarted = await f.task('restart');
  assert.equal(restarted.state, 'succeeded', restarted.message);
  assert.notEqual(f.runtime.game.pid, pid);
  assert.deepEqual(JSON.parse(await readFile(f.argvFile, 'utf8')), ['-port=8211', ...nextArgs]);
  const retention = await put({ backupRetention: 5 });
  assert.equal(retention.status, 200);
  assert.deepEqual(await retention.json(), { backupRetention: 5, autoStart: false, gameArgs: nextArgs, installArgs });
  assert.deepEqual(f.runtime.args, nextArgs);
  assert.equal((await f.task('stop')).state, 'succeeded');
});

test('自动启动设置会在面板启动后拉起游戏服务', { skip: process.platform !== 'linux' }, async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  assert.equal((await f.task('install')).state, 'succeeded');
  await f.manager.updateSettings({ autoStart: true });
  assert.equal(f.manager.autoStart, true);
  await f.manager.autoStartServer();
  await f.manager.operation;
  assert.ok(f.runtime.game);
  assert.equal(f.manager.tasks[0].action, 'start');
  assert.equal(f.manager.tasks[0].state, 'succeeded');
  assert.equal((await f.manager.status()).ready, true);
});

test('玩家封禁、踢人理由、强制停止与更新检查', { skip: process.platform !== 'linux' }, async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  assert.equal((await f.request('/api/banned-players', { authenticated: false })).status, 401);
  assert.deepEqual(await (await f.request('/api/banned-players')).json(), { players: [], skipped: 0 });
  assert.equal((await f.task('install')).state, 'succeeded');
  assert.equal((await f.task('start')).state, 'succeeded');
  const calls = [];
  const rest = f.runtime.rest.bind(f.runtime);
  f.runtime.rest = async (endpoint, body) => { calls.push({ endpoint, body }); return rest(endpoint, body); };
  assert.equal((await f.task('kick', { userid: 'steam_test', message: '刷屏' })).state, 'succeeded');
  assert.deepEqual(calls.at(-1), { endpoint: 'kick', body: { userid: 'steam_test', message: '刷屏' } });
  assert.equal((await f.task('ban', { userid: 'steam_test,4F9368D8000000000000000000000000', name: '测试玩家', message: '作弊' })).state, 'succeeded');
  assert.deepEqual(calls.at(-1), { endpoint: 'ban', body: { userid: 'steam_test', message: '作弊' } });
  let banned = await (await f.request('/api/banned-players')).json();
  assert.equal(banned.players[0].userId, 'steam_test');
  assert.equal(banned.players[0].name, '测试玩家');
  assert.equal(banned.players[0].reason, '作弊');
  assert.ok(banned.players[0].bannedAt);
  assert.equal(JSON.parse(await readFile(f.manager.tasksFile, 'utf8'))[0].player.name, '测试玩家');
  // 新版游戏在停服时才写入名单；运行中刚封禁的玩家也必须立即显示并可解封。
  const legacyBanFile = path.join(f.runtime.saved, 'SaveGames/banlist.txt');
  await writeFile(legacyBanFile, '');
  await utimes(legacyBanFile, new Date(0), new Date(0));
  banned = await (await f.request('/api/banned-players')).json();
  assert.equal(banned.players[0].userId, 'steam_test');
  assert.equal(banned.players[0].name, '测试玩家');
  assert.equal((await f.task('ban', { userid: 'steam_rejected' })).state, 'failed');
  assert.equal((await (await f.request('/api/banned-players')).json()).players.length, 1);
  assert.equal((await f.task('unban', { userid: 'steam_test,4F9368D8000000000000000000000000' })).state, 'succeeded');
  assert.deepEqual(calls.at(-1), { endpoint: 'unban', body: { userid: 'steam_test' } });
  assert.equal(f.manager.tasks.find(task => task.action === 'unban' && task.state === 'succeeded').player.userId, 'steam_test');
  assert.equal((await (await f.request('/api/banned-players')).json()).players.length, 0);
  await writeFile(path.join(f.runtime.saved, 'SaveGames/banlist.txt'), 'ps5_external\n');
  assert.equal((await f.task('kick', { userid: 'steam_test' })).state, 'succeeded');
  assert.deepEqual(calls.at(-1).body, { userid: 'steam_test', message: '管理员已将你移出服务器' });
  assert.equal((await f.task('ban', { userid: '', message: 'x' })).state, 'failed');
  assert.equal((await f.task('kick', { userid: 'steam_test', message: 'x'.repeat(501) })).state, 'failed');
  assert.equal((await f.task('force-stop')).state, 'succeeded');
  assert.equal(f.runtime.game, null);
  banned = await (await f.request('/api/banned-players')).json();
  assert.deepEqual(banned.players, [{ userId: 'ps5_external' }], '停服仍可查看游戏外已有的封禁');
  await mkdir(path.join(f.runtime.server, 'steamapps'), { recursive: true });
  await writeFile(path.join(f.runtime.server, 'steamapps/appmanifest_2394010.acf'), '"buildid" "100"\n');
  assert.equal(await f.manager.installedBuild(), '100');
  f.manager.latestBuild = async () => '200';
  f.manager.updateCache = null;
  const update = await (await f.request('/api/update-check')).json();
  assert.equal(update.installed, true);
  assert.equal(update.installedBuild, '100');
  assert.equal(update.latestBuild, '200');
  assert.equal(update.updateAvailable, true);
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
  assert.equal(status.ready, true); assert.equal(status.info.version, 'test-1.0'); assert.equal(status.version, 'test-1.0'); assert.equal(status.players[0].userId, 'steam_test');
  assert.equal((await f.task('restart')).state, 'succeeded');
  assert.ok(f.runtime.game); assert.equal(f.runtime.ready, true);
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
  const notRunning = await f.task('restart');
  assert.equal(notRunning.state, 'failed');
  assert.match(notRunning.message, /尚未运行/);
  assert.equal((await f.manager.status()).running, false);
});

test('首次访问通过网页初始化管理员，重启沿用账号，密码不以明文输出或存盘', { skip: process.platform !== 'linux', timeout: 20000 }, async t => {
  const { spawn } = await import('node:child_process');
  const { mkdtemp, rm, stat } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { once } = await import('node:events');
  const { createServer } = await import('node:net');
  const { fileURLToPath } = await import('node:url');
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-index-'));
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const apiProbe = createServer(); apiProbe.listen(0, '127.0.0.1'); await once(apiProbe, 'listening');
  const apiPort = apiProbe.address().port; await new Promise(resolve => apiProbe.close(resolve));
  const username = 'index-admin';
  const password = 'index-test-password-123';
  const env = { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH, HOST: '127.0.0.1', PORT: String(port), API_HOST: '127.0.0.1', API_PORT: String(apiPort), PALBOX_DATA_DIR: directory, PALBOX_GAME_ARGS: 'not-json' };
  delete env.PALBOX_API_URL;
  delete env.PALBOX_ADMIN_PASSWORD;
  delete env.PALBOX_ADMIN_PASSWORD_FILE;
  const children = [];
  t.after(async () => {
    for (const { child } of children) {
      if (child.exitCode === null && child.signalCode === null) { const done = once(child, 'exit'); child.kill('SIGTERM'); await done; }
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
    while (!(run.output.includes('前端已启动') && run.output.includes('游戏管理已启动')) && Date.now() < deadline && run.child.exitCode === null) await new Promise(resolve => setTimeout(resolve, 30));
    assert.match(run.output, /前端已启动/);
    assert.match(run.output, /游戏管理已启动/);
    assert.equal(run.output.includes(password), false);
  }
  const post = (route, value, headers = {}) => fetch(`http://127.0.0.1:${port}${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value)
  });
  const settingsFile = path.join(directory, 'palbox/settings.json');
  // 旧的环境变量即使存在也必须被忽略，服务照常启动并等待网页初始化。
  const initialized = launch({ PALBOX_ADMIN_PASSWORD: password, PALBOX_ADMIN_PASSWORD_FILE: '/nonexistent/palbox-password' });
  await ready(initialized);
  assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${apiPort}/`)).status, 404);
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/api/bootstrap`)).json(), { mode: 'managed', authenticated: false, setupRequired: true });
  await assert.rejects(access(settingsFile), { code: 'ENOENT' });
  assert.equal((await post('/api/setup', { username, password: 'short' })).status, 400);
  assert.equal((await post('/api/setup', { username: '   ', password })).status, 400);
  assert.equal((await post('/api/setup', { username, password }, { Origin: 'https://evil.invalid' })).status, 403);
  // 公网客户端（反向代理通过 X-Forwarded-For 转发）不能抢先初始化；
  // 伪造内网前缀也不能让追加真实地址的代理链被误判。
  assert.equal((await post('/api/setup', { username, password }, { 'X-Forwarded-For': '203.0.113.9' })).status, 403);
  assert.equal((await post('/api/setup', { username, password }, { 'X-Forwarded-For': '10.0.0.1, 203.0.113.9' })).status, 403);
  const created = await post('/api/setup', { username, password });
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), { ok: true });
  assert.equal((await post('/api/setup', { username, password })).status, 409);
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/api/bootstrap`)).json(), { mode: 'managed', authenticated: false });
  const settings = await readFile(settingsFile, 'utf8');
  assert.equal(settings.includes(username), true);
  assert.equal(settings.includes(password), false);
  assert.equal((await stat(settingsFile)).mode & 0o777, 0o600);
  assert.equal((await post('/api/login', { username: 'wrong-user', password })).status, 401);
  const authLog = await readFile(path.join(directory, 'logs', 'palbox.log'), 'utf8');
  assert.match(authLog, /登录失败/);
  assert.equal(authLog.includes(password), false);
  assert.equal((await post('/api/login', { username, password })).status, 200);
  initialized.child.kill('SIGTERM');
  assert.equal((await initialized.closed)[0], 0);
  const restarted = launch();
  await ready(restarted);
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/api/bootstrap`)).json(), { mode: 'managed', authenticated: false });
  assert.equal((await post('/api/login', { username, password })).status, 200);
  assert.equal(await readFile(settingsFile, 'utf8'), settings);
  restarted.child.kill('SIGTERM');
  assert.equal((await restarted.closed)[0], 0);
  await assert.rejects(fetch(`http://127.0.0.1:${apiPort}/healthz`));
  await assert.rejects(fetch(`http://127.0.0.1:${port}/healthz`));
});

test('不支持旧版 settings.json 与损坏的管理员记录', { skip: process.platform !== 'linux' }, async t => {
  const { mkdtemp, mkdir, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { Manager } = await import('../../backend/management/manager.js');
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-legacy-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'palbox/settings.json');
  await mkdir(path.dirname(file), { recursive: true });
  const legacy = JSON.stringify({ admin: { salt: 'ab'.repeat(16), hash: 'a'.repeat(128) }, backupRetention: 10 });
  await writeFile(file, legacy);
  await assert.rejects(new Manager({ directory }).initialize(), /旧版 settings\.json 缺少管理员用户名/);
  assert.equal(await readFile(file, 'utf8'), legacy);
  await writeFile(file, 'null');
  await assert.rejects(new Manager({ directory }).initialize(), /损坏/);
  await writeFile(file, '{');
  await assert.rejects(new Manager({ directory }).initialize(), /无法读取或解析/);
  await writeFile(file, JSON.stringify({ admin: { username: 'admin', salt: 'ab'.repeat(16), hash: 'a'.repeat(128) }, backupRetention: 10, gameArgs: ['-port=1'] }));
  await assert.rejects(new Manager({ directory }).initialize(), /启动参数无效/);
});

test('首次初始化并发提交只创建一次管理员', { skip: process.platform !== 'linux' }, async t => {
  const f = await managementFixture({ setup: false }); t.after(() => f.close());
  const payload = { username: 'admin', password: 'test-management-password-123' };
  assert.equal((await f.request('/api/login', { method: 'POST', body: payload, authenticated: false })).status, 409);
  const results = await Promise.all([
    f.request('/api/setup', { method: 'POST', body: payload, authenticated: false }),
    f.request('/api/setup', { method: 'POST', body: payload, authenticated: false })
  ]);
  assert.deepEqual(results.map(response => response.status).sort(), [201, 409]);
  const settings = JSON.parse(await readFile(path.join(f.directory, 'palbox/settings.json'), 'utf8'));
  assert.equal(settings.admin.username, 'admin');
  assert.equal((await f.request('/api/login', { method: 'POST', body: payload, authenticated: false })).status, 200);
});
