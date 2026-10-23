import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, access, cp } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { once } from 'node:events';
import path from 'node:path';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const linux = { skip: process.platform !== 'linux', timeout: 15000 };
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-native-installer-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = path.join(directory, 'project');
  const bin = path.join(directory, 'bin');
  await mkdir(app);
  await mkdir(bin);
  await Promise.all(['backend', 'frontend', 'shared', 'scripts', 'package.json', 'dev.sh', 'install.sh', 'uninstall.sh'].map(entry => cp(path.join(root, entry), path.join(app, entry), { recursive: true })));
  const nodeArchive = 'node-v24.0.0-linux-x64.tar.xz';
  const nodeSource = path.join(directory, 'node-v24.0.0-linux-x64/bin');
  await mkdir(nodeSource, { recursive: true });
  // Simulate administrative commands and service activation. Real files,
  // checksums, extraction and the actual terminal launcher remain in use.
  await writeFile(path.join(nodeSource, 'node'), `#!/bin/bash
if [[ "$*" == *'const [frontend, backend]'* ]]; then
  if [[ -f "$PALBOX_NATIVE_TEST_DIR/fail-start" ]]; then
    rm -f "$PALBOX_NATIVE_TEST_DIR/active"
    exit 1
  fi
  test -f "$PALBOX_NATIVE_TEST_DIR/active"
  exit $?
fi
exec ${quote(process.execPath)} "$@"
`, { mode: 0o755 });
  await run('tar', ['-cJf', path.join(directory, nodeArchive), '-C', directory, 'node-v24.0.0-linux-x64']);
  const archive = await readFile(path.join(directory, nodeArchive));
  await writeFile(path.join(directory, 'SHASUMS256.txt'), `${createHash('sha256').update(archive).digest('hex')}  ${nodeArchive}\n`);
  const mock = path.join(bin, 'mock');
  await writeFile(mock, `#!/usr/bin/python3
import os, sys, pathlib, shutil, subprocess
root = pathlib.Path(os.environ['PALBOX_NATIVE_TEST_DIR'])
name, args = pathlib.Path(sys.argv[0]).name, sys.argv[1:]
with (root / 'commands').open('a') as log:
    log.write(name + ' ' + ' '.join(args) + '\\n')
if name == 'id':
    if args == ['-u']: print('1000' if (root / 'non-root').exists() else '0')
    elif args == ['-u', 'deployer']: print('1000')
    elif args == ['-u', 'root']: print('0')
    elif args == ['-gn', 'deployer']: print('deployer')
    else: sys.exit(1)
elif name == 'stat' and args[-1] == str(root / 'project'):
    if (root / 'root-owner').exists(): print('0' if args[1] == '%u' else 'root')
    else: print('1000' if args[1] == '%u' else 'deployer')
elif name == 'apt-get':
    if 'lib32gcc-s1' in args: (root / 'lib32gcc-installed').touch()
elif name == 'chown': pass
elif name == 'dpkg-query':
    if args[-1] == 'lib32gcc-s1' and (root / 'lib32gcc-installed').exists(): print('install ok installed')
    else: sys.exit(1)
elif name == 'useradd': raise RuntimeError('Installer must not create users')
elif name == 'install':
    filtered, i = [], 0
    while i < len(args):
        if args[i] in ['-o', '-g']: i += 2
        else: filtered.append(args[i]); i += 1
    sys.exit(subprocess.call(['/usr/bin/install'] + filtered))
elif name == 'runuser':
    if (root / 'deny-data').exists() and str(root / 'project/data') in args: sys.exit(1)
    sys.exit(subprocess.call(args[args.index('--') + 1:]))
elif name == 'curl':
    if '--version' in args: sys.exit(0)
    dest = pathlib.Path(args[args.index('-o') + 1])
    url = next(arg for arg in args if arg.startswith('https://'))
    shutil.copyfile(root / url.rsplit('/', 1)[1], dest)
elif name == 'systemctl':
    action = args[0]
    active, enabled = root / 'active', root / 'enabled'
    if action == 'is-active': sys.exit(0 if active.exists() else 1)
    elif action == 'is-enabled': sys.exit(0 if enabled.exists() else 1)
    elif action == 'start': active.touch()
    elif action == 'stop':
        if (root / 'fail-stop').exists(): sys.exit(1)
        active.unlink(missing_ok=True)
    elif action == 'enable': enabled.touch()
    elif action == 'disable': enabled.unlink(missing_ok=True)
elif name == 'journalctl': print('fixture: service failed to start')
else: raise RuntimeError('Unexpected mock command: ' + name)
`, { mode: 0o755 });
  for (const name of ['id', 'stat', 'useradd', 'apt-get', 'chown', 'dpkg-query', 'install', 'runuser', 'curl', 'systemctl', 'journalctl']) await symlink(mock, path.join(bin, name));
  await symlink('/bin/true', path.join(bin, '7z'));
  const systemd = path.join(directory, 'systemd');
  const config = path.join(app, 'data/palbox/.env');
  const data = path.join(app, 'data');
  const env = {
    ...process.env,
    PATH: `${bin}:/usr/bin:/bin`,
    HOME: directory,
    FNM_DIR: path.join(directory, 'fnm'),
    NVM_DIR: path.join(directory, 'nvm'),
    XDG_DATA_HOME: path.join(directory, 'xdg'),
    SUDO_USER: '',
    PALBOX_NATIVE_TEST_DIR: directory,
    PALBOX_SYSTEMD_DIR: systemd,
  };
  // execFile 的 input 不会写入子进程标准输入。安装确认必须由 spawn 送入并关闭。
  const runInstall = (args = [], input = 'y\n') => new Promise((resolve, reject) => {
    const child = spawn('/bin/bash', [path.join(app, 'install.sh'), ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 10000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.stdin.end(input);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0 && signal == null) resolve({ stdout, stderr });
      else {
        const error = new Error(`Command failed: install.sh\n${stderr}`);
        error.stdout = stdout;
        error.stderr = stderr;
        error.code = code;
        error.signal = signal;
        reject(error);
      }
    });
  });
  const invoke = (...args) => runInstall(args, 'y\n');
  const uninstall = (...args) => run('/bin/bash', [path.join(app, 'uninstall.sh'), ...args], { env, timeout: 10000 });
  return { directory, app, config, systemd, data, env, invoke, runInstall, uninstall };
}

test('就地安装使用项目属主和 data，不创建用户或搬迁程序，SteamCMD 由网页安装', linux, async t => {
  const f = await fixture(t);
  const result = await f.invoke();
  assert.match(result.stdout, /╭─ Node\.js /);
  assert.match(result.stdout, /未检测到 Node\.js 22 或以上版本/);
  assert.match(result.stdout, /只放在当前项目里使用，不会替换系统中已有的 Node\.js/);
  assert.match(result.stdout, new RegExp(`安装位置：${f.data}/runtime/node`));
  assert.match(result.stdout, /是否下载？直接回车为不下载 \[y\/N\]/);
  assert.match(result.stdout, /╰─+/);
  assert.match(result.stdout, /正在下载 node-v24\.0\.0-linux-x64\.tar\.xz/);
  assert.match(result.stdout, /Node\.js .+ 已安装到 .*data\/runtime\/node/);
  assert.match(result.stdout, /当前没有正在运行的 PalBox 服务/);
  assert.match(result.stdout, /启动检查通过（第 1\/30 次）/);
  assert.match(result.stdout, /正在设置开机启动/);
  assert.match(result.stdout, /安装完成.*开机启动/);
  assert.ok(result.stdout.includes(`运行用户：deployer`));
  assert.ok(result.stdout.includes(`游戏目录：${f.data}/server`));
  await access(path.join(f.data, 'runtime/node/bin/node'));
  const config = await readFile(f.config, 'utf8');
  assert.match(config, /HOST=127\.0\.0\.1\n/);
  assert.ok(config.includes(`PALBOX_DATA_DIR=${f.data}\n`));
  assert.match(config, /PALBOX_SERVICE_USER=deployer/);
  const unit = path.join(f.systemd, 'palbox.service');
  const service = await readFile(unit, 'utf8');
  assert.match(service, /User=deployer\nGroup=deployer/);
  assert.ok(service.includes(`WorkingDirectory=${f.app}\n`));
  assert.ok(service.includes(`ExecStart=/bin/bash ${f.app}/dev.sh --no-watch`));
  assert.match(service, /KillMode=mixed\nTimeoutStopSec=420/);
  await run('systemd-analyze', ['verify', unit]);
  assert.deepEqual((await readdir(f.data)).sort(), ['cache', 'palbox', 'runtime', 'tmp']);
  await assert.rejects(access(path.join(f.app, 'current')), { code: 'ENOENT' });
  await assert.rejects(access(path.join(f.app, 'releases')), { code: 'ENOENT' });
  const commands = await readFile(path.join(f.directory, 'commands'), 'utf8');
  assert.match(commands, /apt-get install -y --no-install-recommends --no-upgrade lib32gcc-s1\n/);
  assert.doesNotMatch(commands, /apt-get install[^\n]* curl/);
  assert.ok(commands.includes(`install -d -o deployer -g deployer -m 0700 ${f.data}`));
  assert.doesNotMatch(commands, /useradd|steamstatic/);
  assert.ok(!commands.split('\n').some(line => line.startsWith('chown -R ') && line.endsWith(' ' + f.data)));
});

test('未检测到 Node.js 时直接回车或拒绝都不下载', linux, async t => {
  const f = await fixture(t);
  for (const input of ['\n', 'n\n', 'no\n', '']) {
    await assert.rejects(f.runInstall([], input), error => {
      assert.match(error.stderr, /已拒绝下载独立 Node\.js/);
      assert.match(error.stderr, new RegExp(`安装位置：${f.data}/runtime/node`));
      assert.match(error.stdout, /╭─ Node\.js /);
      assert.match(error.stdout, /未检测到 Node\.js 22 或以上版本/);
      assert.match(error.stdout, /直接回车为不下载/);
      return true;
    });
  }
  await assert.rejects(access(path.join(f.data, 'runtime/node/bin/node')), { code: 'ENOENT' });
  const commands = await readFile(path.join(f.directory, 'commands'), 'utf8');
  assert.doesNotMatch(commands, /nodejs\.org/);
});

test('已有可用 Node.js 时直接使用，不询问也不下载', linux, async t => {
  const f = await fixture(t);
  const node = path.join(f.directory, 'bin/node');
  await writeFile(node, `#!/bin/bash
if [[ "$*" == *'const [frontend, backend]'* ]]; then
  test -f "$PALBOX_NATIVE_TEST_DIR/active"
  exit $?
fi
exec ${quote(process.execPath)} "$@"
`, { mode: 0o755 });
  const result = await run('/bin/bash', [path.join(f.app, 'install.sh')], { env: f.env, timeout: 10000, input: 'n\n' });
  assert.match(result.stdout, new RegExp(`检测到 Node\\.js .+：${node}`));
  assert.match(result.stdout, /已有可用的 Node\.js，跳过下载/);
  assert.doesNotMatch(result.stdout, /是否下载|nodejs\.org|未检测到 Node/);
  await assert.rejects(access(path.join(f.data, 'runtime/node/bin/node')), { code: 'ENOENT' });
  const commands = await readFile(path.join(f.directory, 'commands'), 'utf8');
  assert.doesNotMatch(commands, /nodejs\.org/);
});

test('重新安装保留同一 data、配置和程序目录，不重复下载兼容 Node', linux, async t => {
  const f = await fixture(t);
  const opened = await f.invoke('--host', '0.0.0.0', '--port', '9000', '--api-port', '9001');
  assert.match(opened.stdout, /当前没有正在运行的 PalBox 服务/);
  assert.match(opened.stdout, /0\.0\.0\.0:9000（所有 IPv4 网卡）/);
  assert.doesNotMatch(opened.stdout, /面板地址：http:\/\/127\.0\.0\.1:9000/);
  await writeFile(path.join(f.data, 'world.sav'), 'world-content');
  await writeFile(f.config, `${await readFile(f.config, 'utf8')}PALBOX_GAME_PORT=8888\nPALBOX_SECURE_COOKIE=true\n`);
  const repeated = await f.invoke();
  assert.match(repeated.stdout, /项目 Node\.js .+ 已可用，跳过下载/);
  assert.doesNotMatch(repeated.stdout, /是否下载/);
  assert.match(repeated.stdout, /正在停止已运行的 PalBox/);
  assert.match(repeated.stdout, /原服务已停止/);
  let config = await readFile(f.config, 'utf8');
  for (const line of ['HOST=0.0.0.0', 'PORT=9000', 'API_PORT=9001', 'PALBOX_GAME_PORT=8888', 'PALBOX_SECURE_COOKIE=true']) assert.ok(config.split('\n').includes(line), line);
  assert.equal(await readFile(path.join(f.data, 'world.sav'), 'utf8'), 'world-content');
  await f.invoke('--port', '9100');
  config = await readFile(f.config, 'utf8');
  assert.match(config, /\nPORT=9100\n/);
  const commands = await readFile(path.join(f.directory, 'commands'), 'utf8');
  assert.equal(commands.match(/https:\/\/nodejs.org\/dist\/latest-v24.x\/SHASUMS256.txt/g).length, 1);
  assert.equal(commands.match(/apt-get update/g).length, 1);
});

test('旧目录升级后迁移运行时与配置，复用 Node 并保留所有自定义设置', linux, async t => {
  const f = await fixture(t);
  await f.invoke('--port', '9090');
  const { rename } = await import('node:fs/promises');
  const legacyConfig = path.join(f.app, '.palbox.env');
  await rename(f.config, legacyConfig);
  await rename(path.join(f.data, 'runtime'), path.join(f.app, '.runtime'));
  await writeFile(legacyConfig, (await readFile(legacyConfig, 'utf8')) + 'PALBOX_GAME_PORT=9999\n');
  const result = await f.invoke();
  assert.match(result.stdout, /已可用，跳过下载/);
  const config = await readFile(f.config, 'utf8');
  assert.match(config, /PORT=9090\n/); assert.match(config, /PALBOX_GAME_PORT=9999/);
  await assert.rejects(access(legacyConfig), { code: 'ENOENT' });
  await assert.rejects(access(path.join(f.app, '.runtime')), { code: 'ENOENT' });
  await access(path.join(f.data, 'runtime/node/bin/node'));
  assert.ok((await readdir(path.join(f.data, 'palbox'))).some(name => name.startsWith('legacy-env-')));
});

test('旧配置升级启动失败时仍保留旧配置，重试后才归档迁移', linux, async t => {
  const f = await fixture(t);
  await f.invoke();
  const { rename } = await import('node:fs/promises');
  const legacy = path.join(f.app, '.palbox.env');
  await rename(f.config, legacy);
  const original = await readFile(legacy, 'utf8');
  await writeFile(path.join(f.directory, 'fail-start'), 'fail');
  await assert.rejects(f.invoke('--port', '9090'), /恢复原部署配置/);
  assert.equal(await readFile(legacy, 'utf8'), original);
  await assert.rejects(access(f.config), { code: 'ENOENT' });
  await rm(path.join(f.directory, 'fail-start'));
  assert.match((await f.invoke()).stdout, /安装完成/);
  await assert.rejects(access(legacy), { code: 'ENOENT' });
});

test('项目归 root 时要求明确普通用户，拒绝 root 和不存在的用户', linux, async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.directory, 'root-owner'), 'root');
  await assert.rejects(f.invoke(), /无法推断普通运行用户/);
  await assert.rejects(f.invoke('--user', 'root'), /无法推断普通运行用户|root 用户/);
  await assert.rejects(f.invoke('--user', 'missing'), /不存在/);
  assert.doesNotMatch(await readFile(path.join(f.directory, 'commands'), 'utf8'), /apt-get|useradd|systemctl start/);
  assert.match((await f.invoke('--user', 'deployer')).stdout, /运行用户：deployer/);
});

test('已有 data 权限不匹配时停止安装，不接管或删除数据', linux, async t => {
  const f = await fixture(t);
  await mkdir(f.data);
  await writeFile(path.join(f.data, 'world.sav'), 'preserved');
  await writeFile(path.join(f.directory, 'deny-data'), 'denied');
  await assert.rejects(f.invoke(), /deployer 无权读写 data/);
  assert.equal(await readFile(path.join(f.data, 'world.sav'), 'utf8'), 'preserved');
  assert.doesNotMatch(await readFile(path.join(f.directory, 'commands'), 'utf8'), /chown -R|systemctl start/);
});

test('启动失败恢复原配置和服务，不修改代码或数据', linux, async t => {
  const f = await fixture(t);
  await f.invoke();
  const unitFile = path.join(f.systemd, 'palbox.service');
  const oldConfig = await readFile(f.config, 'utf8');
  const oldUnit = await readFile(unitFile, 'utf8');
  const oldCode = await readFile(path.join(f.app, 'backend/index.js'), 'utf8');
  await writeFile(path.join(f.data, 'world.sav'), 'world-content');
  await writeFile(path.join(f.directory, 'fail-start'), 'fail');
  await assert.rejects(f.invoke('--port', '9100'), /恢复原部署配置/);
  assert.equal(await readFile(f.config, 'utf8'), oldConfig);
  assert.equal(await readFile(unitFile, 'utf8'), oldUnit);
  assert.equal(await readFile(path.join(f.app, 'backend/index.js'), 'utf8'), oldCode);
  assert.equal(await readFile(path.join(f.data, 'world.sav'), 'utf8'), 'world-content');
  await access(path.join(f.directory, 'active'));
});

test('校验失败、端口冲突和其他部署目录均不会被激活或覆盖', linux, async t => {
  const f = await fixture(t);
  await assert.rejects(f.invoke('--port', '8081'), /不同端口/);
  await writeFile(path.join(f.directory, 'SHASUMS256.txt'), `${'0'.repeat(64)}  node-v24.0.0-linux-x64.tar.xz\n`);
  await assert.rejects(f.invoke(), /Node.js 校验失败/);
  await assert.rejects(access(f.config), { code: 'ENOENT' });
  await writeFile(path.join(f.systemd, 'palbox.service'), 'WorkingDirectory=/another/project\n');
  await assert.rejects(f.invoke(), /已有 palbox 服务运行在/);
  assert.equal(await readFile(path.join(f.systemd, 'palbox.service'), 'utf8'), 'WorkingDirectory=/another/project\n');
});

test('首次启动失败可重新安装，其他数据目录配置不会被静默替换', linux, async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.directory, 'fail-start'), 'fail');
  await assert.rejects(f.invoke(), /启动检查/);
  await assert.rejects(access(f.config), { code: 'ENOENT' });
  await assert.rejects(access(path.join(f.systemd, 'palbox.service')), { code: 'ENOENT' });
  await assert.rejects(access(path.join(f.directory, 'enabled')), { code: 'ENOENT' });
  await access(f.data);
  await rm(path.join(f.directory, 'fail-start'));
  await mkdir(path.dirname(f.config), { recursive: true });
  await writeFile(f.config, 'PALBOX_DATA_DIR=/existing-world\n');
  await assert.rejects(f.invoke(), /已有配置使用其他数据目录/);
  assert.equal(await readFile(f.config, 'utf8'), 'PALBOX_DATA_DIR=/existing-world\n');
  await rm(f.config);
  assert.match((await f.invoke()).stdout, /安装完成/);
});

async function freePort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}

test('卸载停止并移除本项目服务，保留 data、配置和程序', linux, async t => {
  const f = await fixture(t);
  await f.invoke();
  await writeFile(path.join(f.data, 'world.sav'), 'world-content');
  const removed = await f.uninstall();
  assert.match(removed.stdout, /已停止并取消开机启动/);
  assert.match(removed.stdout, /配置、存档、备份和程序仍在以上目录/);
  assert.ok(removed.stdout.includes(`已移除：${path.join(f.systemd, 'palbox.service')}`));
  await assert.rejects(access(path.join(f.systemd, 'palbox.service')), { code: 'ENOENT' });
  await assert.rejects(access(path.join(f.directory, 'active')), { code: 'ENOENT' });
  await assert.rejects(access(path.join(f.directory, 'enabled')), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(f.data, 'world.sav'), 'utf8'), 'world-content');
  await access(f.config);
  await access(path.join(f.data, 'runtime/node/bin/node'));
  const commands = await readFile(path.join(f.directory, 'commands'), 'utf8');
  assert.match(commands, /systemctl stop palbox\.service\n/);
  assert.match(commands, /systemctl disable palbox\.service\n/);
  assert.match(commands, /systemctl daemon-reload\n/);
  assert.doesNotMatch(commands, /apt-get remove|userdel/);
  const again = await f.uninstall();
  assert.match(again.stdout, /没有已注册的开机服务/);
  assert.equal(await readFile(path.join(f.data, 'world.sav'), 'utf8'), 'world-content');
  assert.match((await f.invoke()).stdout, /安装完成/);
  assert.equal(await readFile(path.join(f.data, 'world.sav'), 'utf8'), 'world-content');
  await access(path.join(f.systemd, 'palbox.service'));
});

test('卸载拒绝其他部署和其他选项，尚未注册时直接结束', linux, async t => {
  const f = await fixture(t);
  await assert.rejects(f.uninstall('--port', '9000'), /卸载不接受其他选项/);
  await assert.rejects(f.invoke('--uninstall'), /卸载请单独执行 sudo bash \.\/uninstall\.sh/);
  const absent = await f.uninstall();
  assert.match(absent.stdout, /没有已注册的开机服务/);
  await assert.rejects(access(f.data), { code: 'ENOENT' });
  assert.doesNotMatch(await readFile(path.join(f.directory, 'commands'), 'utf8'), /apt-get|systemctl stop/);
  const unit = path.join(f.systemd, 'palbox.service');
  await mkdir(f.systemd);
  await writeFile(unit, 'WorkingDirectory=/another/project\n');
  await writeFile(path.join(f.directory, 'active'), '');
  await assert.rejects(f.uninstall(), /已有 palbox 服务运行在/);
  await access(path.join(f.directory, 'active'));
  assert.equal(await readFile(unit, 'utf8'), 'WorkingDirectory=/another/project\n');
  await writeFile(unit, '# unmanaged\n');
  await assert.rejects(f.uninstall(), /无法确认 palbox 服务属于当前项目/);
  assert.match(await readFile(unit, 'utf8'), /unmanaged/);
  await access(path.join(f.directory, 'active'));
  await writeFile(unit, `WorkingDirectory=${f.app}\n`);
  await writeFile(path.join(f.directory, 'root-owner'), 'root');
  const removed = await f.uninstall();
  assert.match(removed.stdout, /已停止并取消开机启动/);
  await assert.rejects(access(unit), { code: 'ENOENT' });
  await assert.rejects(access(path.join(f.directory, 'active')), { code: 'ENOENT' });
});

test('独立卸载不依赖安装脚本、应用文件、Node 或安装依赖，保留数据和配置', linux, async t => {
  const f = await fixture(t);
  await f.invoke();
  await writeFile(path.join(f.data, 'world.sav'), 'preserved');
  const config = await readFile(f.config, 'utf8');
  for (const name of ['backend', 'frontend', 'shared', 'scripts', '.runtime', 'package.json', 'dev.sh', 'install.sh']) {
    await rm(path.join(f.app, name), { recursive: true, force: true });
  }
  const commands = path.join(f.directory, 'commands');
  await writeFile(commands, '');
  assert.match((await f.uninstall()).stdout, /已停止并取消开机启动/);
  assert.equal(await readFile(path.join(f.data, 'world.sav'), 'utf8'), 'preserved');
  assert.equal(await readFile(f.config, 'utf8'), config);
  assert.doesNotMatch(await readFile(commands, 'utf8'), /apt-get|curl|dpkg|runuser|useradd|chown/);
  await access(path.join(f.app, 'uninstall.sh'));
});

test('卸载停服失败时不禁用或移除服务，保留数据并可重试', linux, async t => {
  const f = await fixture(t);
  await f.invoke();
  await writeFile(path.join(f.data, 'world.sav'), 'preserved');
  await writeFile(path.join(f.directory, 'fail-stop'), 'fail');
  const commands = path.join(f.directory, 'commands');
  await writeFile(commands, '');
  await assert.rejects(f.uninstall());
  await access(path.join(f.systemd, 'palbox.service'));
  await access(path.join(f.directory, 'active'));
  await access(path.join(f.directory, 'enabled'));
  assert.equal(await readFile(path.join(f.data, 'world.sav'), 'utf8'), 'preserved');
  assert.doesNotMatch(await readFile(commands, 'utf8'), /systemctl (disable|daemon-reload)/);
  await rm(path.join(f.directory, 'fail-stop'));
  assert.match((await f.uninstall()).stdout, /已停止并取消开机启动/);
});

test('两个脚本的帮助无需 root，卸载实际执行前要求 root', linux, async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.directory, 'non-root'), 'yes');
  const install = await f.invoke('--help');
  const uninstall = await f.uninstall('--help');
  assert.match(install.stdout, /用法：sudo bash \.\/install\.sh/);
  assert.doesNotMatch(install.stdout, /--uninstall/);
  assert.match(uninstall.stdout, /用法：sudo bash \.\/uninstall\.sh/);
  await assert.rejects(access(path.join(f.directory, 'commands')), { code: 'ENOENT' });
  await assert.rejects(f.uninstall(), /请使用 sudo bash \.\/uninstall\.sh/);
  assert.doesNotMatch(await readFile(path.join(f.directory, 'commands'), 'utf8'), /systemctl/);
});

test('终端启动实际使用项目 Node 和相同配置，错误运行用户会被拒绝', linux, async t => {
  const f = await fixture(t);
  await f.invoke();
  const port = await freePort();
  let apiPort = await freePort(); while (apiPort === port) apiPort = await freePort();
  const account = userInfo().username;
  await writeFile(f.config, `PALBOX_SERVICE_USER=${account}\nHOST=127.0.0.1\nPORT=${port}\nAPI_PORT=${apiPort}\nPALBOX_DATA_DIR=${f.data}\n`);
  const env = { ...f.env, USER: 'spoofed-user', HOST: '', PORT: '', API_PORT: '', PALBOX_SERVICE_USER: '', PALBOX_DATA_DIR: '' };
  // Empty environment settings would take precedence over --env-file, so omit
  // them just as a fresh systemd service or login shell would.
  for (const key of ['HOST', 'PORT', 'API_PORT', 'PALBOX_SERVICE_USER', 'PALBOX_DATA_DIR', 'PALBOX_API_URL']) delete env[key];
  const child = spawn('/bin/bash', [path.join(f.app, 'dev.sh'), '--no-watch'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  let output = ''; child.stdout.on('data', part => { output += part; }); child.stderr.on('data', part => { output += part; });
  try {
    const until = Date.now() + 5000;
    let bootstrap;
    // 前端先监听；后端完成初始化后才会接受 /api/bootstrap。
    while (Date.now() < until && child.exitCode === null) {
      if (output.includes(`前端已启动：http://127.0.0.1:${port}`) && output.includes('游戏管理已启动')) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/api/bootstrap`);
          bootstrap = await response.json();
          if (response.ok && bootstrap.mode === 'managed') break;
        } catch { /* 端口刚打开时连接可能尚未接受。 */ }
      }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.match(output, new RegExp(`前端已启动：http://127.0.0.1:${port}`));
    assert.match(output, new RegExp(`游戏管理已启动：http://127\\.0\\.0\\.1:${apiPort}`));
    assert.equal(bootstrap?.mode, 'managed');
    await access(path.join(f.data, 'palbox/workspace.json'));
  } finally { child.kill('SIGTERM'); await closed; }
  await writeFile(f.config, 'PALBOX_SERVICE_USER=some-other-account\n');
  await assert.rejects(run('/bin/bash', [path.join(f.app, 'dev.sh'), '--no-watch'], { env }), /请使用配置的系统用户 some-other-account/);
});
