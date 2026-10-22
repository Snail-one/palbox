import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, readlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Runtime } from '../../backend/management/runtime.js';
import { installSteamcmd, defaultSteamcmd } from '../../backend/management/steamcmd.js';
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

test('安装子进程超时终止整个进程组，不遗留后台任务', linux, async t => {
  const { runtime } = await fixture(t);
  await assert.rejects(runtime.run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], 'steamcmd', { timeoutMs: 100 }), { status: 504 });
  assert.equal(runtime.command, null);
});
