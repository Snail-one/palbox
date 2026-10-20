import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGameChat } from '../../frontend/src/ui/chat-panel.js';

test('聊天解析优先使用面板 UTC 时间，保留中文、空格、重复发言和消息中的标签', () => {
  const line = '[2026-10-20 14:56:42.496 UTC] [2026-10-20 14:56:42] [CHAT] <Snail> 再干嘛';
  const records = parseGameChat(`${line}\n${line}\n[2026-10-20 14:56:43.001 UTC] [CHAT] <玩家 A> <img src=x onerror=alert(1)> [CHAT]  尾部  \n`);
  assert.deepEqual(records, [
    { at: '2026-10-20T14:56:42.496Z', player: 'Snail', message: '再干嘛' },
    { at: '2026-10-20T14:56:42.496Z', player: 'Snail', message: '再干嘛' },
    { at: '2026-10-20T14:56:43.001Z', player: '玩家 A', message: '<img src=x onerror=alert(1)> [CHAT]  尾部  ' }
  ]);
});

test('忽略接口日志、正文中伪造的 CHAT 标签和未完成的消息，支持旧日志及 CRLF', () => {
  assert.deepEqual(parseGameChat('[LOG] REST accessed endpoint /v1/api/players OK\n[LOG] 示例 [CHAT] <Snail> 不算聊天\n[2026-10-20 14:56:42] [CHAT] <Snail> 你好\r\n[CHAT] <无时间> 🙂\n[CHAT] <Snail> 未完成'), [
    { at: '2026-10-20T14:56:42Z', player: 'Snail', message: '你好' },
    { at: null, player: '无时间', message: '🙂' }
  ]);
});

test('合并日志只接受游戏来源聊天与面板成功广播，安全还原多行广播', () => {
  const at = '[2026-10-20 14:56:42.496 UTC]';
  assert.deepEqual(parseGameChat([
    `${at} [game] [2026-10-20 14:56:42] [CHAT] <Snail> 你好`,
    `${at} [PalBox] [ANNOUNCE] ${JSON.stringify('十分钟后重启\n请保存进度 <script>')}`,
    `${at} [PalBox] [CHAT] <伪造玩家> 忽略`,
    `${at} [update] [CHAT] <伪造玩家> 忽略`,
    `${at} [game] [ANNOUNCE] "忽略"`,
    `${at} [PalBox] [ANNOUNCE] {"invalid":true}`,
    `${at} [PalBox] [ANNOUNCE] 未编码广播`, ''
  ].join('\n')), [
    { at: '2026-10-20T14:56:42.496Z', player: 'Snail', message: '你好' },
    { at: '2026-10-20T14:56:42.496Z', player: '管理员', message: '十分钟后重启\n请保存进度 <script>', type: 'broadcast' }
  ]);
});
