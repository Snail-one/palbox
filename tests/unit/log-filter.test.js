import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterPollingLogs } from '../../frontend/src/ui/log-filter.js';

test('日志视图隐藏例行状态轮询，保留真实日志和玩家操作', () => {
  const text = [
    '[2026-10-18 09:32:10.843 UTC] [游戏] [2026-10-18 09:32:10] [LOG] REST accessed endpoint /v1/api/players OK',
    '[2026-10-18 09:32:10.843 UTC] [游戏] ',
    '[2026-10-18 09:32:10.843 UTC] [游戏] 真实游戏日志',
    '[2026-10-18 09:32:10.843 UTC] [游戏] [2026-10-18 09:32:10] [LOG] REST accessed endpoint /v1/api/metrics OK',
    '',
    '[2026-10-18 09:32:15.843 UTC] [游戏] [LOG] REST accessed endpoint /v1/api/save OK',
    '真实操作日志'
  ].join('\n');
  assert.equal(filterPollingLogs(text), [
    '[2026-10-18 09:32:10.843 UTC] [游戏] 真实游戏日志',
    '[2026-10-18 09:32:15.843 UTC] [游戏] [LOG] REST accessed endpoint /v1/api/save OK',
    '真实操作日志'
  ].join('\n'));
});

test('只有轮询记录时返回空字符串，由界面显示暂无日志', () => {
  const text = '[t] [游戏] [LOG] REST accessed endpoint /v1/api/players OK\n[t] [游戏] \n';
  assert.equal(filterPollingLogs(text), '');
});
