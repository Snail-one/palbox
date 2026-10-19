import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createManagementClient } from '../../frontend/src/services/management-api.js';

function eventSources(t) {
  const original = globalThis.EventSource;
  const sources = [];
  globalThis.EventSource = class {
    static CLOSED = 2;
    constructor() { this.listeners = {}; sources.push(this); }
    addEventListener(type, handler) { this.listeners[type] = handler; }
    close() { this.readyState = 2; }
    emit(type, data = {}) { return this.listeners[type]?.({ data: JSON.stringify(data) }); }
  };
  t.after(() => { globalThis.EventSource = original; });
  return sources;
}

test('安全设置轮换会话时日志自动重连，延迟到达的旧连接失效事件不会停止新连接', async t => {
  const sources = eventSources(t);
  const errors = [], logs = [];
  let resolveResponse;
  const api = createManagementClient({ csrf: 'old', fetch: () => new Promise(resolve => { resolveResponse = resolve; }) });
  const close = api.watchLogs('login', { onLog: text => logs.push(text), onError: error => errors.push(error) });
  const updating = api.request('security/totp/enable', { method: 'POST', body: { code: '123456' } });
  const expired = sources[0].emit('unauthorized');
  resolveResponse({ ok: true, json: async () => ({ csrf: 'new' }) });
  await updating;
  await expired;
  assert.equal(sources.length, 2);
  assert.equal(sources[0].readyState, 2);
  sources[0].emit('log', { text: 'stale' });
  sources[1].emit('log', { text: 'new log' });
  assert.deepEqual(logs, ['new log']);
  assert.deepEqual(errors, []);
  close();
  const next = api.request('security/totp/recovery-codes', { method: 'POST' });
  resolveResponse({ ok: true, json: async () => ({ csrf: 'newer' }) });
  await next;
  assert.equal(sources.length, 2, '关闭订阅后不会重新打开日志连接');
});

test('安全设置失败或真实会话过期时，日志仍报告未授权', async t => {
  const sources = eventSources(t);
  const errors = [];
  let resolveResponse;
  const api = createManagementClient({ fetch: () => new Promise(resolve => { resolveResponse = resolve; }) });
  api.watchLogs('login', { onError: error => errors.push(error) });
  const updating = api.request('security/totp/disable', { method: 'POST' });
  const rejected = assert.rejects(updating, { status: 401 });
  const expired = sources[0].emit('unauthorized');
  resolveResponse({ ok: false, status: 401, json: async () => ({ error: 'expired' }) });
  await rejected;
  await expired;
  assert.equal(sources.length, 1);
  assert.equal(sources[0].readyState, 2);
  assert.equal(errors[0].status, 401);
});
