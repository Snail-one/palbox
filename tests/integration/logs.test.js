import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { managementFixture } from '../helpers/management-fixture.js';
import { formatLogBlocks } from '../../shared/domain/logs.js';

const withoutTimestamps = text => text.replace(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} UTC\] /gm, '');

test('历史接口要求登录，分页有界，增量 SSE 用事件位置恢复且退出后失效', { timeout: 10000 }, async t => {
  const f = await managementFixture(); t.after(() => f.close());
  assert.equal((await f.request('/api/logs/history?channel=game')).status, 401);
  const { cookie } = await f.login();
  f.runtime.log('game', Array.from({ length: 5000 }, (_, index) => `历史 ${index} 中文🙂\n`).join(''));
  const page = await (await f.request('/api/logs/history?channel=game')).json();
  assert.ok(page.hasMore);
  assert.equal(page.blocks.length, 4);
  assert.match(formatLogBlocks(page.blocks, 'game'), /历史 4999/);
  const older = await (await f.request('/api/logs/history?channel=game&before=' + encodeURIComponent(page.before))).json();
  assert.ok(older.blocks.length <= 4);
  assert.notEqual(older.before, page.before);
  assert.equal((await f.request('/api/logs/history?channel=login&before=' + encodeURIComponent(page.before))).status, 400);
  assert.equal((await f.request('/api/logs/history?channel=game&before=invalid')).status, 400);
  f.runtime.log('game', '重连期间新增记录🙂\n');
  const controller = new AbortController(); t.after(() => controller.abort());
  const response = await fetch(f.base + '/api/logs/stream?channel=game&format=pages', {
    headers: { Cookie: cookie, 'Last-Event-ID': page.after }, signal: controller.signal
  });
  assert.equal(response.status, 200);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  async function nextEvent(name) {
    for (;;) {
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (!frame.split('\n').includes('event: ' + name)) continue;
        return JSON.parse(frame.split('\n').find(line => line.startsWith('data: ')).slice(6));
      }
      const part = await reader.read(); assert.equal(part.done, false);
      buffer += decoder.decode(part.value, { stream: true });
    }
  }
  const incremental = await nextEvent('log');
  assert.ok(incremental.blocks.length <= 2);
  assert.match(formatLogBlocks(incremental.blocks, 'game'), /重连期间新增记录🙂/);
  assert.notEqual(incremental.after, page.after);
  assert.equal((await f.request('/api/logout', { method: 'POST' })).status, 200);
  await nextEvent('unauthorized');
  assert.equal((await reader.read()).done, true);
});

test('登录日志独立提供认证后的快照与实时推送，不混入运行日志或泄露密码', { timeout: 10000 }, async t => {
  const f = await managementFixture();
  t.after(() => f.close());
  for (const endpoint of ['logs', 'logs/stream']) {
    assert.equal((await f.request(`/api/${endpoint}?channel=login`, { authenticated: false })).status, 401);
  }
  const { cookie } = await f.login();
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(f.base + '/api/logs/stream?channel=login', { headers: { Cookie: cookie }, signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  async function snapshotIncluding(text) {
    for (;;) {
      let index;
      while ((index = buffered.indexOf('\n\n')) !== -1) {
        const frame = buffered.slice(0, index); buffered = buffered.slice(index + 2);
        if (!frame.startsWith('event: log\n')) continue;
        const snapshot = JSON.parse(frame.split('\ndata: ')[1]).text;
        if (snapshot.includes(text)) return snapshot;
      }
      const { value, done } = await reader.read();
      assert.equal(done, false);
      buffered += decoder.decode(value, { stream: true });
    }
  }
  assert.match(await snapshotIncluding('登录成功'), /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} UTC\] 登录成功/);
  f.manager.status = () => { throw new Error('登录日志不应依赖游戏状态'); };
  const wrongPassword = 'do-not-log-this-password';
  assert.equal((await f.request('/api/login', {
    method: 'POST', authenticated: false,
    body: { username: 'another-admin', password: wrongPassword }
  })).status, 401);
  const snapshot = await snapshotIncluding('登录失败');
  assert.match(snapshot, /another-admin/);
  assert.match(snapshot, /127\.0\.0\.1/);
  assert.doesNotMatch(snapshot, new RegExp(`${wrongPassword}|${f.password}`));
  assert.equal((await (await f.request('/api/logs?channel=login')).json()).text, snapshot);
  f.runtime.log('palbox', '普通面板任务\n');
  for (const channel of ['palbox', 'all']) {
    const { text } = await (await f.request(`/api/logs?channel=${channel}`)).json();
    assert.match(text, /普通面板任务/);
    assert.doesNotMatch(text, /登录成功|登录失败|another-admin/);
  }
  assert.doesNotMatch(await f.runtime.logs('login'), /普通面板任务/);
});

test('实时日志通过前端代理推送，兼容外部写入、轮换并在退出登录后终止', { timeout: 10000 }, async t => {
  const f = await managementFixture();
  t.after(() => f.close());
  assert.equal((await f.request('/api/logs/stream', { authenticated: false })).status, 401);
  const { cookie } = await f.login();
  assert.equal((await f.request('/api/logs/stream?channel=../../etc/passwd')).status, 404);
  const controller = new AbortController();
  t.after(() => controller.abort());
  f.runtime.log('game', '\x1b[32m初始中文🙂\x1b[0m\n');
  const response = await fetch(f.base + '/api/logs/stream?channel=game', { headers: { Cookie: cookie }, signal: controller.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  async function event(name, predicate = () => true) {
    for (;;) {
      let index;
      while ((index = buffered.indexOf('\n\n')) !== -1) {
        const frame = buffered.slice(0, index); buffered = buffered.slice(index + 2);
        if (!frame.startsWith(`event: ${name}\n`)) continue;
        const value = JSON.parse(frame.split('\ndata: ')[1]);
        if (predicate(value)) return value;
      }
      const { value, done } = await reader.read();
      assert.equal(done, false, '日志流不应提前关闭');
      buffered += decoder.decode(value, { stream: true });
    }
  }
  const initial = (await event('log')).text;
  assert.match(initial, /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} UTC\] 初始中文🙂\n$/);
  assert.equal(withoutTimestamps(initial), '初始中文🙂\n');
  // Log streaming must not call or wait for the slow game status endpoint.
  f.manager.status = () => { throw new Error('日志不应依赖状态查询'); };
  const start = Date.now();
  f.runtime.log('game', '实时追加\n');
  const updated = (await event('log', value => value.text.includes('实时追加'))).text;
  assert.equal(withoutTimestamps(updated), '初始中文🙂\n实时追加\n');
  assert.equal(updated.split('\n')[0], initial.trimEnd(), '刷新不改变已有记录的时间戳');
  assert.ok(Date.now() - start < 2000, '新日志应在两秒内送达');
  const file = path.join(f.directory, 'logs/game.log');
  await appendFile(file, '\x1b[33m外部写入\x1b[0m\n');
  assert.match((await event('log', value => value.text.includes('外部写入'))).text, /外部写入\n$/);
  await rename(file, file + '.1');
  await writeFile(file, '轮换后的中文\n');
  const rotated = (await event('log', value => value.text.includes('轮换后'))).text;
  assert.match(rotated, /外部写入\n轮换后的中文\n$/);
  assert.match(rotated, /初始中文🙂/);
  assert.equal((await f.request('/api/logout', { method: 'POST', body: {} })).status, 200);
  await event('unauthorized');
  assert.equal((await reader.read()).done, true);
});

test('统一日志 API 和实时连接合并三个来源，并支持合并记录轮换', { timeout: 10000 }, async t => {
  const f = await managementFixture({ logs: { maxBytes: 512, maxArchives: 2 } });
  t.after(() => f.close());
  const { cookie } = await f.login();
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(f.base + '/api/logs/stream?channel=all', { headers: { Cookie: cookie }, signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  async function snapshotIncluding(text) {
    for (;;) {
      let index;
      while ((index = buffered.indexOf('\n\n')) !== -1) {
        const frame = buffered.slice(0, index); buffered = buffered.slice(index + 2);
        if (!frame.startsWith('event: log\n')) continue;
        const snapshot = JSON.parse(frame.split('\ndata: ')[1]).text;
        if (snapshot.includes(text)) return snapshot;
      }
      const { value, done } = await reader.read();
      assert.equal(done, false);
      buffered += decoder.decode(value, { stream: true });
    }
  }
  f.runtime.log('game', '统一游戏消息\n');
  f.runtime.log('steamcmd', '统一安装消息\n');
  f.runtime.log('palbox', '统一面板消息\n');
  const snapshot = await snapshotIncluding('统一面板消息');
  assert.match(snapshot, /\[游戏\] 统一游戏消息/);
  assert.match(snapshot, /\[安装更新\] 统一安装消息/);
  assert.match(snapshot, /\[面板\] 统一面板消息/);
  assert.ok(snapshot.indexOf('统一游戏消息') < snapshot.indexOf('统一安装消息'));
  assert.ok(snapshot.indexOf('统一安装消息') < snapshot.indexOf('统一面板消息'));
  assert.equal((await (await f.request('/api/logs?channel=all')).json()).text, snapshot);
  const journal = path.join(f.directory, 'logs/combined.jsonl');
  await rename(journal, journal + '.1');
  await writeFile(journal, '');
  f.runtime.log('palbox', '轮换后的合并日志\n');
  const rotated = await snapshotIncluding('轮换后的合并日志');
  assert.match(rotated, /统一游戏消息/);
  assert.match(rotated, /\[面板\] 轮换后的合并日志/);
  f.runtime.log('game', '自动轮换中文🙂\n'.repeat(200) + '自动轮换后的最新日志\n');
  const automatic = await snapshotIncluding('自动轮换后的最新日志');
  assert.doesNotMatch(automatic, /\ufffd/);
  assert.equal((await (await f.request('/api/logs?channel=all')).json()).text, automatic);
  assert.match((await (await f.request('/api/logs?channel=game')).json()).text, /自动轮换后的最新日志/);
  const files = await readdir(path.join(f.directory, 'logs'));
  assert.ok(files.includes('combined.jsonl.2'));
  for (const name of files) {
    const file = path.join(f.directory, 'logs', name);
    assert.ok((await stat(file)).size <= 512, name);
    if (name.startsWith('combined.jsonl')) {
      const content = await readFile(file, 'utf8');
      for (const line of content.trimEnd().split('\n')) assert.doesNotThrow(() => JSON.parse(line));
    }
  }
});
