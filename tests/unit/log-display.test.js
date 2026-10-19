import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactLogDisplay } from '../../frontend/src/ui/log-display.js';

test('日志显示去除空行及仅含时间来源的空行，保留所有接口访问记录', () => {
  const at = '[2026-10-19 09:12:16.038 UTC]';
  const content = ['players', 'info', 'metrics', 'settings'].map(endpoint => `${at} [game] [2026-10-19 09:12:16] [LOG] REST accessed endpoint /v1/api/${endpoint} OK`);
  const text = '\n' + content.map(line => line + `\n${at} [game] \n\n \t\n`).join('') + `${at}\n`;
  assert.equal(compactLogDisplay(text, { timeZone: 'UTC' }), content.join('\n') + '\n');
});

test('网页日志按用户时区转换 UTC 前缀，保留毫秒和原始正文', () => {
  const text = '[2026-07-18 06:00:00.123 UTC] [game] [2026-07-18 06:00:00] 游戏原始消息\n[2026-01-18 06:00:00 UTC] [PalBox] 下一条\n旧日志没有时间\n';
  assert.equal(compactLogDisplay(text, { timeZone: 'America/Los_Angeles' }), '[2026-07-17 23:00:00.123 UTC-07:00] [game] [2026-07-18 06:00:00] 游戏原始消息\n[2026-01-17 22:00:00 UTC-08:00] [PalBox] 下一条\n旧日志没有时间\n');
  assert.equal(compactLogDisplay('[2026-10-18 23:00:00.001 UTC] [update] 完成', { timeZone: 'Asia/Shanghai' }), '[2026-10-19 07:00:00.001 UTC+08:00] [update] 完成');
});

test('保留非空日志的换行、缩进和有意义的括号标签，不改原始内容', () => {
  const text = '[LOG]\n[Warning]\n[游戏] 玩家加入\n  原始缩进与末尾空格  \nREST accessed endpoint /v1/api/settings FAILED\n';
  assert.equal(compactLogDisplay(text), text);
  assert.equal(compactLogDisplay('未完成的一行'), '未完成的一行');
  assert.equal(compactLogDisplay('\n \n[2026-10-19 09:12:16 UTC] [游戏] \n'), '');
});
