import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../../backend/management/runtime.js';
import { Manager } from '../../backend/management/manager.js';

test('SteamCMD 分块输出驱动真实下载、校验、安装阶段', async () => {
  const runtime = new Runtime('/tmp/palbox-progress-test');
  runtime.installed = async () => true;
  runtime.run = async (_command, _args, channel, options) => {
    assert.equal(channel, 'steamcmd');
    for (const chunk of [
      'Update state (0x61) down', 'loading, progress: 20.50\r',
      'Update state (0x5) verifying install, progress: 50.00\r',
      'Update state (0x81) committing, progress: 100.00\n'
    ]) options.onOutput(chunk);
    return "Success! App '2394010' fully installed.\n";
  };
  const phases = [];
  await runtime.install({ onProgress: phase => phases.push(phase) });
  assert.deepEqual(phases, ['downloading', 'verifying', 'installing', 'installing']);
});

test('管理任务在停止、下载更新与重新启动时报告当前阶段', async () => {
  const observed = [];
  const runtime = {
    async stop() { observed.push(manager.busy.phase); },
    async start() { observed.push(manager.busy.phase); },
    async install({ onProgress }) {
      observed.push(manager.busy.phase);
      onProgress('downloading', '正在下载'); observed.push(manager.busy.phase);
      onProgress('verifying', '正在校验'); observed.push(manager.busy.phase);
      onProgress('installing', '正在安装'); observed.push(manager.busy.phase);
    }
  };
  const manager = new Manager({ directory: '/tmp/palbox-progress-test', runtime });
  manager.busy = { action: 'update', state: 'running' };
  await manager.stopGame({ requireSave: true });
  await manager.installGame();
  await manager.startGame();
  assert.deepEqual(observed, ['stopping', 'updating', 'downloading', 'verifying', 'updating', 'starting']);
});
