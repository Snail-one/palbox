import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { streamLogs } from '../../backend/management/logs.js';

const flush = () => new Promise(resolve => setImmediate(resolve));

async function fixture(t, { watchFails = false } = {}) {
  let notify, text = 'initial\n', reads = 0, authenticated = true;
  const watcher = new EventEmitter();
  watcher.close = () => {};
  t.mock.method(fs, 'watch', (_directory, listener) => {
    if (watchFails) throw new Error('watch unavailable');
    notify = listener;
    return watcher;
  });
  syncBuiltinESMExports();
  t.mock.timers.enable({ apis: ['setInterval'] });
  const chunks = [];
  const response = Object.assign(new EventEmitter(), {
    writableNeedDrain: false, destroyed: false,
    writeHead() {}, flushHeaders() {}, setTimeout() {},
    write(value) { chunks.push(value); return true; },
    end(value = '') { chunks.push(value); this.destroyed = true; this.emit('close'); }
  });
  t.after(() => { response.emit('close'); t.mock.restoreAll(); syncBuiltinESMExports(); });
  await streamLogs({
    request: { setTimeout() {} }, response, channel: 'game',
    runtime: { directory: '/unused', async logs() { reads++; return text; } },
    auth: { session: () => authenticated }
  });
  await flush();
  return {
    response, chunks, notify: () => notify('change', 'game.log'),
    update: value => { text = value; }, reads: () => reads,
    logout: () => { authenticated = false; }
  };
}

test('日志监听立即推送，兜底检查前不再每秒重复读取', async t => {
  const f = await fixture(t);
  const initialReads = f.reads();
  f.update('new log\n');
  f.notify();
  await flush();
  assert.ok(f.chunks.some(value => value.includes('new log')));
  assert.equal(f.reads(), initialReads + 1);
  t.mock.timers.tick(4999);
  await flush();
  assert.equal(f.reads(), initialReads + 1);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(f.reads(), initialReads + 2);
});

test('文件监听不可用时五秒兜底仍补发日志，并在退出后关闭连接', async t => {
  const f = await fixture(t, { watchFails: true });
  f.update('external log\n');
  t.mock.timers.tick(4999);
  await flush();
  assert.ok(!f.chunks.some(value => value.includes('external log')));
  t.mock.timers.tick(1);
  await flush();
  assert.ok(f.chunks.some(value => value.includes('external log')));
  f.logout();
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(f.response.destroyed, true);
  assert.ok(f.chunks.some(value => value.includes('event: unauthorized')));
});
