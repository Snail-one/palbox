import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactLogDisplay } from '../../frontend/src/ui/log-display.js';

test('日志显示去除空行及仅含时间来源的空行，保留所有接口访问记录', () => {
  const at = '[2026-10-19 09:12:16.038 UTC]';
  const content = ['players', 'info', 'metrics', 'settings'].map(endpoint => `${at} [game] [2026-10-19 09:12:16] [LOG] REST accessed endpoint /v1/api/${endpoint} OK`);
  const text = '\n' + content.map(line => line + `\n${at} [game] \n\n \t\n`).join('') + `${at}\n`;
  assert.equal(compactLogDisplay(text), content.join('\n') + '\n');
});

test('保留非空日志的换行、缩进和有意义的括号标签，不改原始内容', () => {
  const text = '[LOG]\n[Warning]\n[游戏] 玩家加入\n  原始缩进与末尾空格  \nREST accessed endpoint /v1/api/settings FAILED\n';
  assert.equal(compactLogDisplay(text), text);
  assert.equal(compactLogDisplay('未完成的一行'), '未完成的一行');
  assert.equal(compactLogDisplay('\n \n[2026-10-19 09:12:16 UTC] [游戏] \n'), '');
});
