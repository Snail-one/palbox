import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLoginLogsPanel } from '../../frontend/src/ui/login-logs-panel.js';

function setup({ active = true } = {}) {
  const elements = new Map([
    ['login-logs-page', { hidden: !active }],
    ['login-log-status', { textContent: '' }],
    ['login-log-content', { textContent: '', scrollTop: 0, scrollHeight: 100, clientHeight: 100 }]
  ]);
  const listeners = new Map();
  const target = prefix => ({
    addEventListener(name, callback) { listeners.set(`${prefix}:${name}`, callback); }
  });
  const document = { ...target('document'), hidden: false };
  const streams = [];
  const api = {
    watchLogs(channel, callbacks) {
      const stream = { channel, ...callbacks, closed: false };
      streams.push(stream);
      return () => { stream.closed = true; };
    }
  };
  const $ = id => elements.get(id);
  createLoginLogsPanel({ dom: { $, document }, api, window: target('window') });
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
  assert.equal(app.$('login-log-content').textContent, '登录成功\n');
  app.event('window:hashchange');
  assert.equal(app.streams.length, 1);
  app.$('login-logs-page').hidden = true;
  app.event('window:hashchange');
  assert.equal(stream.closed, true);
  stream.onLog('迟到消息');
  assert.equal(app.$('login-log-content').textContent, '登录成功\n');
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

test('登录日志跟随底部，阅读历史时保留滚动位置', () => {
  const app = setup();
  const content = app.$('login-log-content');
  app.streams[0].onLog('第一条');
  assert.equal(content.scrollTop, content.scrollHeight);
  content.scrollHeight = 1000;
  content.scrollTop = 80;
  app.streams[0].onLog('第二条');
  assert.equal(content.scrollTop, 80);
  content.scrollTop = 900;
  app.streams[0].onLog('第三条');
  assert.equal(content.scrollTop, content.scrollHeight);
});
