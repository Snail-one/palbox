import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, readlink, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Runtime } from '../../backend/management/runtime.js';
import { installSteamcmd, defaultSteamcmd, formatLookup, connectionLog, networkFailureText } from '../../backend/management/steamcmd.js';
import { steamcmdArchive } from '../helpers/steamcmd-fixture.js';

const linux = { skip: process.platform !== 'linux' || process.arch !== 'x64' };
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-steamcmd-'));
  const runtime = new Runtime(directory);
  await runtime.initialize();
  t.after(async () => { await runtime.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, runtime };
}

test('SteamCMD 下载、解压和初始化后才标记就绪，使用独立 HOME 和 SDK 链接', linux, async t => {
  const { directory, runtime } = await fixture(t);
  const archive = await steamcmdArchive(directory);
  assert.equal(runtime.steamcmd, defaultSteamcmd(directory));
  assert.equal((await runtime.steamcmdStatus()).installed, false);
  const phases = [];
  await installSteamcmd(runtime, {
    async fetch(url, { signal }) {
      assert.equal(url, 'https://client-update.steamstatic.com/installer/steamcmd_linux.tar.gz');
      assert.ok(signal instanceof AbortSignal);
      return new Response(archive);
    },
    onProgress(phase) { phases.push(phase); }
  });
  assert.deepEqual(phases, ['steamcmd-downloading', 'steamcmd-installing', 'steamcmd-initializing', 'steamcmd-ready']);
  assert.equal((await runtime.steamcmdStatus()).installed, true);
  assert.equal(runtime.childEnvironment().HOME, path.join(directory, 'steam-home'));
  assert.equal(await readlink(path.join(directory, 'steam-home/.steam/sdk64/steamclient.so')), path.join(directory, 'steamcmd/linux64/steamclient.so'));
  assert.match(await runtime.logs('steamcmd'), /SteamCMD fixture initialization/);
  assert.equal((await readdir(directory)).some(name => name.startsWith('.steamcmd-')), false);
  await installSteamcmd(runtime, { fetch() { throw new Error('不得重复下载'); } });
});

test('初始化失败保留游戏数据、清理暂存且允许再次安装', linux, async t => {
  const { directory, runtime } = await fixture(t);
  await writeFile(path.join(directory, 'preserved-world'), 'world');
  const failed = await steamcmdArchive(directory, { failInitialization: true });
  await assert.rejects(installSteamcmd(runtime, { fetch: async () => new Response(failed) }), /sudo apt-get.*lib32gcc-s1/);
  assert.equal((await runtime.steamcmdStatus()).installed, false);
  assert.equal((await readdir(directory)).some(name => name.startsWith('.steamcmd-')), false);
  const valid = await steamcmdArchive(directory);
  await installSteamcmd(runtime, { fetch: async () => new Response(valid) });
  assert.equal((await runtime.steamcmdStatus()).installed, true);
  assert.equal(await readFile(path.join(directory, 'preserved-world'), 'utf8'), 'world');
});

test('HTTP 下载失败和无效压缩包不会留下就绪状态', linux, async t => {
  const { directory, runtime } = await fixture(t);
  await assert.rejects(installSteamcmd(runtime, { fetch: async () => new Response('', { status: 503 }) }), /HTTP 503/);
  await assert.rejects(installSteamcmd(runtime, { fetch: async () => { throw new Error('connection reset'); } }), /SteamCMD 下载失败.*connection reset/);
  await assert.rejects(installSteamcmd(runtime, { fetch: async () => new Response('invalid tar') }), /解压失败/);
  assert.equal((await runtime.steamcmdStatus()).installed, false);
  assert.equal((await readdir(directory)).some(name => name.startsWith('.steamcmd-')), false);
});

test('data 没有写权限时在下载前明确说明运行用户权限问题', { ...linux, skip: linux.skip || process.getuid?.() === 0 }, async t => {
  const { directory, runtime } = await fixture(t);
  await chmod(directory, 0o500);
  try {
    await assert.rejects(installSteamcmd(runtime, { fetch() { throw new Error('不得开始下载'); } }), error => {
      assert.equal(error.status, 403);
      assert.match(error.message, /系统用户.*data 目录.*读写权限/);
      return true;
    });
    assert.equal((await readdir(directory)).some(name => name.startsWith('.steamcmd-')), false);
  } finally { await chmod(directory, 0o700); }
});

test('SteamCMD 下载流超出容量限制时中止并清理，不执行下载内容', linux, async t => {
  const { directory, runtime } = await fixture(t);
  let remaining = 65;
  const chunk = new Uint8Array(1024 * 1024);
  const body = new ReadableStream({ pull(controller) {
    if (remaining-- > 0) controller.enqueue(chunk);
    else controller.close();
  } });
  runtime.run = async () => { throw new Error('不得解压或运行超限下载'); };
  await assert.rejects(installSteamcmd(runtime, { fetch: async () => new Response(body) }), /下载文件过大/);
  assert.equal((await runtime.steamcmdStatus()).installed, false);
  assert.equal((await readdir(directory)).some(name => name.startsWith('.steamcmd-')), false);
});

test('面板关闭中止正在下载的安装任务并清理暂存', linux, async t => {
  const { directory, runtime } = await fixture(t);
  let started;
  const downloading = new Promise(resolve => { started = resolve; });
  const installing = installSteamcmd(runtime, { fetch: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    started();
  }) });
  const rejected = assert.rejects(installing, /面板正在关闭/);
  await downloading;
  await runtime.close();
  await rejected;
  assert.equal((await runtime.steamcmdStatus()).installed, false);
  assert.equal((await readdir(directory)).some(name => name.startsWith('.steamcmd-')), false);
});

test('自定义路径只检测和使用，不自动覆盖；缺失时给出修复提示', linux, async t => {
  const { directory, runtime } = await fixture(t);
  runtime.steamcmd = path.join(directory, 'custom.sh');
  assert.equal((await runtime.steamcmdStatus()).canInstall, false);
  await assert.rejects(installSteamcmd(runtime), /PALBOX_STEAMCMD/);
  await writeFile(runtime.steamcmd, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  assert.equal((await runtime.steamcmdStatus()).installed, true);
  assert.equal(runtime.childEnvironment().HOME, process.env.HOME);
  await installSteamcmd(runtime, { fetch() { throw new Error('不得下载或覆盖'); } });
});

test('下载日志会写明解析结果、实际连接的地址族和底层错误', () => {
  assert.equal(formatLookup('client-update.steamstatic.com', [
    { family: 6, address: '2606:4700::1' },
    { family: 4, address: '203.0.113.10' }
  ]), 'DNS client-update.steamstatic.com：IPv6 2606:4700::1，IPv4 203.0.113.10');
  assert.equal(connectionLog({
    connectParams: { hostname: 'client-update.steamstatic.com' },
    socket: { localFamily: 'IPv4', localAddress: '192.0.2.8', localPort: 54000, remoteFamily: 'IPv6', remoteAddress: '2606:4700::1', remotePort: 443 }
  }), '已连接 client-update.steamstatic.com：本机 IPv4 192.0.2.8:54000 -> 远端 IPv6 2606:4700::1:443');
  const cause = new AggregateError([
    Object.assign(new Error('connect ENETUNREACH'), { syscall: 'connect', code: 'ENETUNREACH', address: '2606:4700::1', port: 443 })
  ]);
  assert.equal(networkFailureText(Object.assign(new Error('fetch failed'), { cause })), 'fetch failed（connect ENETUNREACH IPv6 2606:4700::1:443）');
  assert.equal(networkFailureText(new Error('connection reset')), 'connection reset');
});

test('安装子进程超时终止整个进程组，不遗留后台任务', linux, async t => {
  const { runtime } = await fixture(t);
  await assert.rejects(runtime.run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], 'steamcmd', { timeoutMs: 100 }), { status: 504 });
  assert.equal(runtime.command, null);
});
