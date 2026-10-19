import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, appendFile, rename, unlink, symlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { readLogPage } from '../../backend/management/log-pages.js';
import { formatLogBlocks, readableLog } from '../../shared/domain/logs.js';
import { createLogHistory } from '../../frontend/src/services/log-history.js';
import { Runtime } from '../../backend/management/runtime.js';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-log-history-'));
  await mkdir(path.join(directory, 'logs'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, file: path.join(directory, 'logs/game.log'), page: (options, channel = 'game') => readLogPage(directory, channel, 1, options) };
}

function client(page, channel = 'game') {
  const streams = [], texts = [], states = [];
  const history = createLogHistory({
    channel, onLog: text => texts.push(text), onState: state => states.push(state),
    watch(callbacks) { const stream = { ...callbacks, closed: false }; streams.push(stream); return () => { stream.closed = true; }; },
    request: route => page({ before: new URL(route, 'http://localhost').searchParams.get('before') }, channel)
  });
  return { history, streams, texts, states };
}

test('分页加载完整历史，实时追加超过 64 KiB 后仍保留已显示的内容且不重复', async t => {
  const f = await fixture(t);
  const original = Array.from({ length: 5000 }, (_, index) => `原有 ${index} 中文🙂\n`).join('');
  await writeFile(f.file, original);
  const app = client(f.page);
  let page = await f.page();
  app.streams[0].onPage(page);
  assert.ok(page.hasMore);
  assert.equal(page.blocks.length, 4);
  assert.doesNotMatch(app.texts.at(-1), /原有 0 中文/);
  while (app.states.at(-1).hasMore) await app.history.loadOlder();
  assert.equal(app.texts.at(-1), original);
  const added = Array.from({ length: 8000 }, (_, index) => `后续 ${index} 中文🙂\n`).join('');
  await appendFile(f.file, added);
  do {
    page = await f.page({ after: app.streams[0].getCursor() });
    assert.ok(page.blocks.length <= 4);
    app.streams[0].onPage(page);
  } while (page.hasNewer);
  assert.equal(app.texts.at(-1), original + added);
  const unchanged = await f.page({ after: app.streams[0].getCursor() });
  assert.equal(unchanged.blocks.length, 0);
  app.streams[0].onPage(unchanged);
  assert.equal(app.texts.at(-1), original + added);
  app.history.close();
});

test('字节块和增量更新跨 UTF-8 字符边界、进度覆盖时不会乱码或重复', async t => {
  const f = await fixture(t);
  const initial = 'a'.repeat(16383) + '中文🙂\n进度 10%\r';
  const bytes = Buffer.from('完成🙂');
  await writeFile(f.file, Buffer.concat([Buffer.from(initial), bytes.subarray(0, 2)]));
  const app = client(f.page);
  app.streams[0].onPage(await f.page());
  assert.doesNotMatch(app.texts.at(-1), /\ufffd/);
  await appendFile(f.file, bytes.subarray(2));
  app.streams[0].onPage(await f.page({ after: app.streams[0].getCursor() }));
  assert.equal(app.texts.at(-1), readableLog(initial + '完成🙂'));
  app.history.close();
});

test('文件轮换后游标仍能接续读取，清理或截断则明确报告历史缺口', async t => {
  const f = await fixture(t);
  await writeFile(f.file, '旧文件记录\n');
  const first = await f.page();
  await rename(f.file, f.file + '.1');
  await writeFile(f.file, '新文件记录\n');
  const next = await f.page({ after: first.after });
  assert.equal(next.gap, false);
  assert.equal(formatLogBlocks(next.blocks, 'game'), '新文件记录\n');
  await unlink(f.file + '.1');
  assert.equal((await f.page({ before: first.before })).gap, true);
  assert.equal((await f.page({ after: first.after })).gap, true);
  await writeFile(f.file, '覆写的新记录\n');
  assert.equal((await f.page({ after: next.after })).gap, true);
});

test('全部日志分页重建跨块消息，保留时间、终端处理和来源顺序', async t => {
  const f = await fixture(t);
  const runtime = new Runtime(f.directory);
  t.after(() => runtime.close());
  await runtime.initialize();
  runtime.log('game', '\x1b[32m跨块');
  runtime.log('palbox', '另一来源\n');
  runtime.log('game', '消息🙂\x1b[0m\n');
  runtime.log('steamcmd', '进度 10%\r进度 20%\n');
  const page = await runtime.logPage('all');
  assert.equal(formatLogBlocks(page.blocks, 'all'), await runtime.logs('all'));
});

test('首屏落在大型 JSON 记录中间时自动补齐前页，日志不会显示为空', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.directory, 'logs/combined.jsonl'), JSON.stringify({ channel: 'game', text: '中文🙂'.repeat(16000) + '最后内容\n' }) + '\n');
  const app = client(f.page, 'all');
  app.streams[0].onPage(await f.page({}, 'all'));
  for (let attempt = 0; attempt < 100 && !app.texts.at(-1).includes('最后内容'); attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.match(app.texts.at(-1), /最后内容/);
  assert.doesNotMatch(app.texts.at(-1), /\ufffd/);
  app.history.close();
});

test('游标不能跨频道或指定文件路径，符号链接不会被读取', async t => {
  const f = await fixture(t);
  await writeFile(f.file, '内容');
  const page = await f.page();
  await assert.rejects(f.page({ before: 'wrong' }), { status: 400 });
  await assert.rejects(f.page({ before: page.before }, 'login'), { status: 400 });
  await assert.rejects(f.page({ before: page.before, after: page.after }), { status: 400 });
  await assert.rejects(f.page({}, '../../etc/passwd'), { status: 404 });
  await symlink(f.file, path.join(f.directory, 'logs/login.log'));
  assert.deepEqual((await f.page({}, 'login')).blocks, []);
});

test('加载历史期间到达新消息不会被旧请求覆盖，关闭后忽略迟到的消息', async t => {
  const f = await fixture(t);
  await writeFile(f.file, '旧记录\n'.repeat(20000));
  let resolve;
  const app = client(() => new Promise(done => { resolve = done; }));
  const initial = await f.page();
  app.streams[0].onPage(initial);
  const loading = app.history.loadOlder();
  await appendFile(f.file, '历史加载期间新记录\n');
  app.streams[0].onPage(await f.page({ after: initial.after }));
  resolve(await f.page({ before: initial.before }));
  await loading;
  assert.match(app.texts.at(-1), /历史加载期间新记录/);
  app.history.close();
  const count = app.texts.length;
  app.streams[0].onPage(initial);
  assert.equal(app.texts.length, count);
});

test('浏览器窗口达到上限时明确暂停，返回最新能恢复且旧流不能覆盖新视图', () => {
  const app = client(() => {});
  const data = Buffer.from('记录\n').toString('base64');
  app.streams[0].onPage({ blocks: Array.from({ length: 128 }, (_, index) => ({ file: 'one', start: index * 16384, data })), after: 'cursor', before: 'start', hasMore: true });
  const previous = app.texts.at(-1);
  app.streams[0].onPage({ blocks: [{ file: 'two', start: 0, data }], after: 'next', hasMore: false });
  assert.equal(app.states.at(-1).paused, true);
  assert.equal(app.texts.at(-1), previous);
  assert.equal(app.streams[0].closed, true);
  app.history.latest();
  assert.equal(app.states.at(-1).paused, false);
  app.streams[0].onPage({ blocks: [], after: 'stale' });
  assert.equal(app.streams[1].getCursor(), null);
  app.history.close();
});
