import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLoginLogsPanel } from '../../frontend/src/ui/login-logs-panel.js';
import { createDom } from '../../frontend/src/ui/dom.js';

function node() {
  return {
    children: [], text: '',
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); },
    set textContent(value) { this.text = value; this.children = []; },
    append(...children) { this.children.push(...children); },
    addEventListener() {},
    replaceChildren(...children) { this.text = ''; this.children = children; }
  };
}

function setup({ active = true } = {}) {
  const elements = new Map([
    ['login-logs-page', { hidden: !active }],
    ['login-log-status', { textContent: '' }],
    ['login-log-older', node()], ['login-log-latest', node()], ['login-log-history-note', node()],
    ['login-log-content', Object.assign(node(), { scrollTop: 0, scrollHeight: 100, clientHeight: 100 })]
  ]);
  const listeners = new Map();
  const target = prefix => ({
    addEventListener(name, callback) { listeners.set(`${prefix}:${name}`, callback); }
  });
  const document = { ...target('document'), hidden: false, createElement: node, getElementById: id => elements.get(id) };
  const streams = [];
  const api = {
    watchLogHistory(channel, callbacks) {
      const stream = { channel, ...callbacks, closed: false };
      streams.push(stream);
      return { close() { stream.closed = true; } };
    }
  };
  const $ = id => elements.get(id);
  createLoginLogsPanel({ dom: createDom(document), api, window: target('window') });
  return { $, document, streams, event(name, value = {}) { listeners.get(name)(value); } };
}

test('登录日志仅在页面可见时连接，切换页面关闭旧流并忽略迟到的消息', () => {
  const app = setup({ active: false });
  assert.equal(app.streams.length, 0);
  app.$('login-logs-page').hidden = false;
  app.event('window:hashchange');
  const stream = app.streams[0];
  assert.equal(stream.channel, 'login');
  stream.onOpen();
  stream.onLog('登录成功\n');
  assert.ok(app.$('login-log-content').textContent.includes('登录成功'));
  const rendered = app.$('login-log-content').textContent;
  app.event('window:hashchange');
  assert.equal(app.streams.length, 1);
  app.$('login-logs-page').hidden = true;
  app.event('window:hashchange');
  assert.equal(stream.closed, true);
  stream.onLog('迟到消息');
  assert.equal(app.$('login-log-content').textContent, rendered);
  app.$('login-logs-page').hidden = false;
  app.event('window:hashchange');
  app.document.hidden = true;
  app.event('document:visibilitychange');
  assert.equal(app.streams[1].closed, true);
  app.document.hidden = false;
  app.event('document:visibilitychange');
  app.event('window:pagehide');
  assert.equal(app.streams[2].closed, true);
  app.event('window:pageshow', { persisted: true });
  assert.equal(app.streams.length, 4);
  app.streams[3].onError(Object.assign(new Error('登录已失效'), { status: 401 }));
  assert.equal(app.streams[3].closed, true);
  assert.equal(app.$('login-log-status').textContent, '登录已失效');
  app.event('window:hashchange');
  assert.equal(app.streams.length, 4);
});

test('登录日志跟随顶部，阅读历史时保留滚动位置', () => {
  const app = setup();
  const content = app.$('login-log-content');
  app.streams[0].onLog('第一条');
  assert.equal(content.scrollTop, 0);
  content.scrollHeight = 1000;
  content.scrollTop = 80;
  app.streams[0].onLog('第二条');
  assert.equal(content.scrollTop, 80);
  content.scrollTop = 20;
  app.streams[0].onLog('第三条');
  assert.equal(content.scrollTop, 0);
});

test('登录记录分列显示结果、本地时间、IPv6 和用户名，保留未知记录与空状态', t => {
  const previousZone = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  t.after(() => { if (previousZone === undefined) delete process.env.TZ; else process.env.TZ = previousZone; });
  const app = setup();
  const content = app.$('login-log-content');
  const username = '用户名 "<img src=x onerror=alert(1)>，）"';
  const text = [
    '[2026-10-18 06:00:00.123 UTC] 登录成功（127.0.0.1）',
    `[2026-10-18 06:01:00.000 UTC] 登录失败（::1，${username}）`,
    '登录尝试过于频繁（192.0.2.1）',
    '[2026-10-18 06:02:00.000 UTC] 旧版记录内容',
    ''
  ].join('\n');
  app.streams[0].onLog(text);
  const table = content.children[0];
  const newestRows = table.children[1].children;
  assert.equal(newestRows[0].children[3].textContent, '旧版记录内容');
  const rows = [...newestRows].reverse();
  assert.equal(rows.length, 4);
  assert.equal(rows[0].children[0].textContent, '2026/10/17 23:00:00');
  assert.equal(rows[0].children[0].title, '2026-10-18 06:00:00.123 UTC');
  assert.equal(rows[0].children[1].children[0].className, 'login-log-badge success');
  assert.equal(rows[1].children[1].children[0].className, 'login-log-badge failure');
  assert.equal(rows[1].children[2].textContent, '::1');
  assert.equal(rows[1].children[3].textContent, username);
  assert.equal(rows[1].children[3].children.length, 0);
  assert.equal(rows[2].children[0].textContent, '—');
  assert.equal(rows[2].children[1].children[0].className, 'login-log-badge limited');
  assert.equal(rows[3].children[3].textContent, '旧版记录内容');
  app.streams[0].onLog(text);
  assert.equal(content.children[0], table);
  app.streams[0].onLog(' \n');
  assert.equal(content.textContent, '暂无登录记录');
});

test('登录时间按浏览器时区处理夏令时，兼容历史时间格式', t => {
  const previousZone = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  t.after(() => { if (previousZone === undefined) delete process.env.TZ; else process.env.TZ = previousZone; });
  const app = setup();
  app.streams[0].onOpen();
  assert.match(app.$('login-log-status').textContent, /本地时间（America\/Los_Angeles）/);
  app.streams[0].onLog('[2026-01-18 06:00:00.000 UTC] 登录成功（127.0.0.1）\n[2026-07-18 06:00:00.000 UTC] 登录成功（127.0.0.1）\n[旧时间格式] 登录成功（127.0.0.1）');
  const rows = [...app.$('login-log-content').children[0].children[1].children].reverse();
  assert.equal(rows[0].children[0].textContent, '2026/01/17 22:00:00');
  assert.equal(rows[1].children[0].textContent, '2026/07/17 23:00:00');
  assert.equal(rows[2].children[0].textContent, '旧时间格式');
});
