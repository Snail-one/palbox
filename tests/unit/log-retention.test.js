import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appendLog, cleanupLogs, DEFAULT_LOG_POLICY, LOG_FILES, logPolicy, logPolicyFromEnv } from '../../backend/management/log-retention.js';
import { appendCombinedLog, readCombinedLog, readLogTail } from '../../backend/management/logs.js';
import { Runtime } from '../../backend/management/runtime.js';

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-log-retention-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const logs = path.join(directory, 'logs');
  await mkdir(logs);
  return { directory, logs, file: path.join(logs, 'game.log'), policy: logPolicy({ maxBytes: 256, ...options }) };
}

test('日志在写入前轮换，恰好达到上限也不会在下一次写入时超限', async t => {
  const { file, policy } = await fixture(t);
  appendLog(file, 'a'.repeat(256), policy);
  assert.equal((await stat(file)).size, 256);
  appendLog(file, 'b\n', policy);
  assert.equal(await readFile(file + '.1', 'utf8'), 'a'.repeat(256));
  assert.equal(await readFile(file, 'utf8'), 'b\n');
  assert.equal(await readLogTail(file, 5), 'aaab\n');
  appendLog(file, 'c'.repeat(254), policy);
  appendLog(file, 'd\n', policy);
  assert.equal(await readFile(file + '.1', 'utf8'), 'b\n' + 'c'.repeat(254));
  assert.equal(await readFile(file, 'utf8'), 'd\n');
});

test('大批中文输出严格限制每个文件的字节数，循环保留最新内容且不切断 UTF-8', async t => {
  const { file, logs, policy } = await fixture(t, { maxArchives: 2 });
  appendLog(file, '旧日志\n', policy);
  appendLog(file, '中文🙂'.repeat(10000) + '最新结束\n', policy);
  const files = await readdir(logs);
  assert.deepEqual(files.sort(), ['game.log', 'game.log.1', 'game.log.2']);
  for (const name of files) {
    const content = await readFile(path.join(logs, name));
    assert.ok(content.length <= 256);
    assert.doesNotMatch(content.toString('utf8'), /\ufffd/);
  }
  const text = await readLogTail(file, 768, 2);
  assert.match(text, /最新结束\n$/);
  assert.doesNotMatch(text, /旧日志|\ufffd/);
});

test('不保留历史时只循环使用当前文件，JSON 轮换不留下半条记录', async t => {
  const { directory, file, logs, policy } = await fixture(t, { maxArchives: 0 });
  appendLog(file, 'a'.repeat(256), policy);
  appendLog(file, '新的\n', policy);
  assert.deepEqual(await readdir(logs), ['game.log']);
  assert.equal(await readLogTail(file, 256, 0), '新的\n');
  appendCombinedLog(directory, 'game', '中文🙂\u0000'.repeat(1000) + '最新记录\n', '2026-10-19T08:00:00.000Z', policy);
  const journal = await readFile(path.join(logs, 'combined.jsonl'), 'utf8');
  assert.ok(Buffer.byteLength(journal) <= 256);
  for (const line of journal.trimEnd().split('\n')) assert.equal(JSON.parse(line).channel, 'game');
  assert.match(await readCombinedLog(directory, 65536, 0), /最新记录/);
});

test('统一日志跨多个轮换文件保持记录完整与时间顺序', async t => {
  const { directory, logs, policy } = await fixture(t, { maxBytes: 512, maxArchives: 2 });
  for (let index = 0; index < 14; index++) appendCombinedLog(directory, 'game', `第 ${index} 条 中文🙂\n`, '2026-10-19T08:00:00.000Z', policy);
  const files = (await readdir(logs)).filter(name => name.startsWith('combined.jsonl'));
  assert.equal(files.length, 3);
  for (const name of files) {
    const content = await readFile(path.join(logs, name), 'utf8');
    assert.ok(Buffer.byteLength(content) <= 512);
    for (const line of content.trimEnd().split('\n')) assert.doesNotThrow(() => JSON.parse(line));
  }
  const text = await readCombinedLog(directory, 65536, 2);
  assert.match(text, /第 0 条/);
  assert.ok(text.indexOf('第 0 条') < text.indexOf('第 13 条'));
  assert.match(text, /第 13 条 中文🙂/);
  assert.doesNotMatch(text, /\ufffd/);
});

test('启动清理过期日志、超额历史与遗留临时文件，空文件不会重复导入旧登录记录', async t => {
  const { directory, logs, policy } = await fixture(t);
  const old = new Date(Date.now() - policy.retentionMs - 10000);
  for (const name of ['login.log', 'combined.jsonl', 'game.log', 'game.log.1']) {
    const file = path.join(logs, name);
    await writeFile(file, name === 'game.log' ? '过期游戏日志\n' : '过期记录\n');
    await utimes(file, old, old);
  }
  await writeFile(path.join(logs, 'game.log.2'), '超额历史');
  await writeFile(path.join(logs, 'game.log.111'), '旧配置多余历史');
  await writeFile(path.join(logs, 'palbox.log'), '登录成功（127.0.0.1）\n');
  const temporary = 'game.log.12345678-1234-1234-1234-123456789abc.tmp';
  await writeFile(path.join(logs, temporary), '中断的写入');
  const runtime = new Runtime(directory, { logs: policy });
  t.after(() => runtime.close());
  await runtime.initialize();
  assert.equal(await runtime.logs('login'), '');
  assert.equal(await runtime.logs('all'), '');
  for (const name of ['game.log.1', 'game.log.2', 'game.log.111', temporary]) await assert.rejects(stat(path.join(logs, name)), { code: 'ENOENT' });
  for (const name of ['login.log', 'combined.jsonl', 'game.log']) assert.equal((await stat(path.join(logs, name))).size, 0);
  await runtime.initialize();
  assert.equal(await runtime.logs('login'), '', '保留迁移标记，不重新导入旧登录事件');
  runtime.log('game', '新的日志\n');
  assert.match(await runtime.logs('game'), /新的日志/);
});

test('启动修复旧版超大文件并保留最新内容及归档原来的时间', async t => {
  const { logs, policy } = await fixture(t);
  const previous = new Date(Date.now() - 10000);
  for (const name of ['game.log', 'game.log.1', 'combined.jsonl', 'combined.jsonl.1']) {
    const file = path.join(logs, name);
    const text = name.includes('jsonl')
      ? Array.from({ length: 30 }, (_, index) => JSON.stringify({ channel: 'game', text: `记录 ${index}\n` }) + '\n').join('')
      : '中文🙂'.repeat(100) + '最新尾部\n';
    await writeFile(file, text);
    await utimes(file, previous, previous);
  }
  cleanupLogs(logs, policy);
  for (const name of await readdir(logs)) {
    const info = await stat(path.join(logs, name));
    assert.ok(info.size <= policy.maxBytes);
    assert.ok(Math.abs(info.mtimeMs - previous.getTime()) < 1);
    const content = await readFile(path.join(logs, name), 'utf8');
    if (name.includes('jsonl')) for (const line of content.trimEnd().split('\n')) assert.doesNotThrow(() => JSON.parse(line));
    else assert.match(content, /最新尾部/);
    assert.doesNotMatch(content, /\ufffd/);
  }
});

test('清理只处理规定的普通日志文件，忽略其他文件、目录和符号链接', async t => {
  const { directory, file, logs, policy } = await fixture(t);
  const outside = path.join(directory, 'outside.log');
  await writeFile(outside, '必须保留');
  await symlink(outside, file + '.1');
  await mkdir(path.join(logs, 'palbox.log.2'));
  await writeFile(path.join(logs, 'other.log.99'), '其他日志');
  cleanupLogs(logs, policy, Date.now() + policy.retentionMs * 2);
  assert.equal(await readFile(outside, 'utf8'), '必须保留');
  assert.equal(await readFile(path.join(logs, 'other.log.99'), 'utf8'), '其他日志');
  appendLog(file, 'a'.repeat(256), policy);
  assert.throws(() => appendLog(file, 'next', policy), { code: 'EINVAL' });
  assert.equal(await readFile(outside, 'utf8'), '必须保留');
  assert.equal((await stat(file)).size, 256);
});

test('日志定时清理不重复启动，关闭 Runtime 后释放定时器', async t => {
  const { directory, file, policy } = await fixture(t);
  const runtime = new Runtime(directory, { logs: { ...policy, cleanupIntervalMs: 20 } });
  t.after(() => runtime.close());
  await runtime.initialize();
  const timer = runtime.logCleanupTimer;
  assert.equal(timer.hasRef(), false);
  await runtime.initialize();
  assert.equal(runtime.logCleanupTimer, timer);
  await writeFile(file + '.2', '待清理');
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('定时清理未执行')), 2000);
    const original = runtime.cleanupLogs.bind(runtime);
    runtime.cleanupLogs = () => { original(); clearTimeout(deadline); resolve(); };
  });
  await assert.rejects(stat(file + '.2'), { code: 'ENOENT' });
  await runtime.close();
  assert.equal(runtime.logCleanupTimer, null);
});

test('日志保留环境变量有默认值、允许关闭归档且拒绝错误配置', () => {
  assert.deepEqual(logPolicyFromEnv({}), DEFAULT_LOG_POLICY);
  assert.equal(LOG_FILES.length, 5);
  const policy = logPolicyFromEnv({ PALBOX_LOG_MAX_MB: '2', PALBOX_LOG_BACKUPS: '0', PALBOX_LOG_RETENTION_DAYS: '30' });
  assert.equal(policy.maxBytes, 2 * 1024 * 1024);
  assert.equal(policy.maxArchives, 0);
  assert.equal(policy.retentionMs, 30 * 24 * 60 * 60 * 1000);
  for (const env of [{ PALBOX_LOG_MAX_MB: '0' }, { PALBOX_LOG_MAX_MB: '1.5' }, { PALBOX_LOG_BACKUPS: '11' }, { PALBOX_LOG_RETENTION_DAYS: '' }, { PALBOX_LOG_RETENTION_DAYS: '366' }]) assert.throws(() => logPolicyFromEnv(env), /PALBOX_LOG_/);
});
