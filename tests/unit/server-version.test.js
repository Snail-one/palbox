import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Manager, steamCmdApiBuild } from '../../backend/management/manager.js';

test('状态显示游戏版本与本地 Build，停服保留版本，更新后清除旧版本', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-version-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let installed = true;
  let apiAvailable = true;
  const source = '[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ServerName="Test")\n';
  const runtime = {
    server: path.join(directory, 'server'), saved: path.join(directory, 'server/Pal/Saved'),
    config: path.join(directory, 'settings.ini'), game: {}, ready: true,
    installed: async () => installed,
    steamcmdStatus: async () => ({ installed: true, canInstall: false, reason: '' }),
    rest: async endpoint => {
      if (!apiAvailable) throw new Error('API unavailable');
      return endpoint === 'info' ? { version: 'v0.7.0' } : endpoint === 'players' ? { players: [] } : {};
    }
  };
  const manager = new Manager({ directory, runtime });
  manager.store = { syncDefaultProfile: async () => false, active: () => ({ source }), revision: 1 };
  const manifest = path.join(runtime.server, 'steamapps/appmanifest_2394010.acf');
  await mkdir(path.dirname(manifest), { recursive: true });
  await writeFile(manifest, '"buildid" "100"\n');
  let status = await manager.status();
  assert.equal(status.version, 'v0.7.0');
  assert.equal(status.installedBuild, '100');
  apiAvailable = false;
  status = await manager.status();
  assert.equal(status.ready, false);
  assert.equal(status.version, 'v0.7.0', '管理接口暂不可用时保留已知版本');
  runtime.game = null;
  status = await manager.status();
  assert.equal(status.info, null);
  assert.equal(status.version, 'v0.7.0');
  await writeFile(manifest, '"buildid" "200"\n');
  status = await manager.status();
  assert.equal(status.version, null, '不同 Build 不能沿用旧版本号');
  assert.equal(status.installedBuild, '200');
  installed = false;
  status = await manager.status();
  assert.equal(status.version, null);
  assert.equal(status.installedBuild, null);
});

test('SteamCMD.net API 优先提供最新构建号', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-version-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runtime = {
    server: path.join(directory, 'server'), saved: path.join(directory, 'server/Pal/Saved'),
    config: path.join(directory, 'settings.ini'), port: 8211,
    childEnvironment: () => ({})
  };
  const manager = new Manager({ directory, runtime });
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, timeout: options?.signal instanceof AbortSignal });
    return {
      ok: true,
      json: async () => ({ status: 'success', data: { '2394010': { depots: { branches: { public: { buildid: '25247047' } } } } } })
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  assert.equal(await manager.latestBuild(), '25247047');
  assert.deepEqual(requests.map(request => request.url), ['https://api.steamcmd.net/v1/info/2394010']);
  assert.equal(requests[0].timeout, true);

  assert.equal(steamCmdApiBuild({ data: { '2394010': { depots: { branches: { public: { buildid: 25247047 } } } } } }), '25247047');
  assert.equal(steamCmdApiBuild({ data: { '2394010': { depots: { branches: {} } } } }), null);
  assert.equal(steamCmdApiBuild({ data: { '2394010': { depots: { branches: { public: { buildid: 'beta' } } } } } }), null);
});

test('缺少 Steam 清单时仍能读取运行中的游戏版本', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-version-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runtime = {
    server: path.join(directory, 'server'), saved: path.join(directory, 'server/Pal/Saved'),
    config: path.join(directory, 'settings.ini'), game: {},
    installed: async () => true,
    steamcmdStatus: async () => ({ installed: true, canInstall: false, reason: '' }),
    rest: async endpoint => endpoint === 'info' ? { version: 'v0.7.1' } : {}
  };
  const manager = new Manager({ directory, runtime });
  manager.store = { syncDefaultProfile: async () => false, active: () => ({ source: 'OptionSettings=(ServerName="Test")' }), revision: 1 };
  const status = await manager.status();
  assert.equal(status.version, 'v0.7.1');
  assert.equal(status.installedBuild, null);
});
