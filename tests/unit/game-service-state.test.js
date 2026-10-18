import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameServiceState } from '../../frontend/src/ui/game-service-state.js';

const idle = { installed: true, running: false, ready: false, tasks: [] };
const taskState = (action, phase, extra = {}) => gameServiceState({ ...idle, ...extra, task: { action, phase, state: 'running', message: '任务已开始' } });

test('区分未安装、已安装未启动、已停止、运行中和接口异常', () => {
  assert.equal(gameServiceState({ ...idle, installed: false }).label, '未安装');
  assert.equal(gameServiceState(idle).label, '已安装');
  assert.equal(gameServiceState({ ...idle, lastExit: { code: 0 } }).label, '已停止');
  assert.equal(gameServiceState({ ...idle, running: true, ready: true }).label, '运行中');
  assert.equal(gameServiceState({ ...idle, running: true }).state, 'error');
});

test('安装、下载、校验和更新任务优先于静态安装状态', () => {
  for (const [action, phase, expected] of [
    ['install', undefined, '安装中'], ['install', 'downloading', '下载中'],
    ['install', 'verifying', '校验中'], ['install', 'installing', '安装中'],
    ['update', undefined, '更新中'], ['update', 'downloading', '下载中'],
    ['update', 'verifying', '校验中'], ['update', 'updating', '更新中']
  ]) assert.equal(taskState(action, phase, { installed: false }).label, expected);
});

test('重启和更新准确区分停服、启动、等待接口就绪与运行完成', () => {
  assert.equal(taskState('restart', 'stopping', { running: true }).label, '停止中');
  for (const action of ['start', 'restart', 'update', 'install', 'backup', 'restore', 'apply']) {
    assert.equal(taskState(action, 'starting').label, '启动中');
    assert.equal(taskState(action, 'starting', { running: true }).label, '等待就绪');
    assert.equal(taskState(action, 'starting', { running: true, ready: true }).label, '运行中');
  }
  assert.equal(taskState('force-stop').label, '强制停止中');
  assert.equal(taskState('backup', 'backing').label, '备份中');
  assert.equal(taskState('restore', 'restoring').label, '恢复中');
  assert.equal(taskState('apply', 'applying').label, '应用配置中');
});

test('任务说明、失败原因与异常退出可查询，普通玩家操作不改变运行状态', () => {
  const downloading = gameServiceState({ ...idle, task: { action: 'install', state: 'running', phase: 'downloading', message: '正在下载服务端文件' } });
  assert.equal(downloading.description, '正在下载服务端文件');
  for (const [action, expected] of [['install', '安装失败'], ['update', '更新失败'], ['start', '启动失败'], ['restart', '重启失败']]) {
    const state = gameServiceState({ ...idle, tasks: [{ action, state: 'failed', message: '具体错误原因' }] });
    assert.equal(state.label, expected);
    assert.equal(state.description, '具体错误原因');
    assert.equal(state.state, 'error');
  }
  assert.equal(gameServiceState({ ...idle, lastExit: { code: 1 } }).label, '异常退出');
  assert.equal(gameServiceState({ ...idle, lastExit: { signal: 'SIGKILL' }, tasks: [{ action: 'force-stop', state: 'succeeded' }] }).label, '已停止');
  assert.equal(taskState('announce', undefined, { running: true, ready: true }).label, '运行中');
});
