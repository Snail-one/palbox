import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTimeFormatter } from '../../frontend/src/ui/time.js';
import { Runtime } from '../../backend/management/runtime.js';

test('UTC 服务端时间按用户时区显示，正确处理跨日和毫秒', () => {
  const format = createTimeFormatter({ timeZone: 'Asia/Shanghai' });
  const at = '2026-10-18T23:01:02.003Z';
  assert.equal(format.date(at), '2026/10/19');
  assert.equal(format.time(at), '07:01:02');
  assert.equal(format.dateTime(at, { milliseconds: true, showZone: true }), '2026/10/19 07:01:02.003 UTC+08:00');
  for (const value of ['', undefined, null, 'invalid']) assert.equal(format.dateTime(value), '—');
});

test('同一个时区根据记录日期处理夏令时，支持非整小时偏移', () => {
  const format = createTimeFormatter({ timeZone: 'America/Los_Angeles' });
  assert.equal(format.dateTime('2026-01-18T06:00:00Z', { showZone: true }), '2026/01/17 22:00:00 UTC-08:00');
  assert.equal(format.dateTime('2026-07-18T06:00:00Z', { showZone: true }), '2026/07/17 23:00:00 UTC-07:00');
  assert.equal(createTimeFormatter({ timeZone: 'Asia/Kathmandu' }).dateTime('2026-07-18T00:00:00Z', { showZone: true }), '2026/07/18 05:45:00 UTC+05:45');
});

test('默认跟随系统时区，服务端子进程始终使用 UTC', t => {
  const previous = process.env.TZ;
  t.after(() => { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; });
  process.env.TZ = 'America/Los_Angeles';
  assert.equal(createTimeFormatter().dateTime('2026-07-18T06:00:00Z'), '2026/07/17 23:00:00');
  const runtime = new Runtime('/tmp/palbox-time-zone-test');
  assert.equal(runtime.childEnvironment().TZ, 'UTC');
  assert.equal(process.env.TZ, 'America/Los_Angeles');
  process.env.TZ = 'Asia/Shanghai';
  assert.equal(createTimeFormatter().dateTime('2026-07-18T06:00:00Z'), '2026/07/18 14:00:00');
});
