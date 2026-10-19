import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, appendFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readableLog, readLogTail, timestampLogChunk } from '../../backend/management/logs.js';
import { Runtime } from '../../backend/management/runtime.js';

test('日志隐藏终端颜色、标题与控制字符，并将进度回车和退格显示为可读文本', () => {
  assert.equal(readableLog('\x1b[32m中文启动🙂\x1b[0m\r\n\x1b]0;标题\x07进度 10%\r进度 20%\r\nabc\bD\x00\n'), '中文启动🙂\n进度 20%\nabD\n');
  assert.equal(readableLog('进度 50%\r'), '进度 50%');
  assert.equal(readableLog('正文\x1b[31'), '正文');
  assert.equal(readableLog('正文\x1b]0;未完成标题'), '正文');
});

test('分块输出只在行首增加时间戳，进度覆盖后保留时间，换行后使用新时间', () => {
  const state = { prefix: true, at: null };
  const first = '2026-10-18T08:01:02.123Z';
  const second = '2026-10-18T08:01:03.456Z';
  const third = '2026-10-18T08:01:04.789Z';
  const text = timestampLogChunk('中文', first, state)
    + timestampLogChunk('启动\r\x1b[32m更新完成\x1b[0m\r', second, state)
    + timestampLogChunk('\n下一行', third, state);
  assert.equal(readableLog(text), '[2026-10-18 08:01:02.123 UTC] 更新完成\n[2026-10-18 08:01:04.789 UTC] 下一行');
});

test('三个分类与统一视图使用相同的记录时间，刷新和重新读取不会改变时间戳', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-log-timestamps-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runtime = new Runtime(directory);
  await runtime.initialize();
  for (const channel of ['game', 'steamcmd', 'palbox']) {
    runtime.log(channel, `时间戳测试 ${channel}\n`);
    const raw = await readFile(path.join(directory, 'logs', channel + '.log'), 'utf8');
    const timestamp = raw.match(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} UTC\]/)?.[0];
    assert.ok(timestamp, '分类日志应记录 UTC 毫秒时间戳');
    assert.equal(await runtime.logs(channel), raw);
    assert.ok((await runtime.logs('all')).includes(timestamp), '统一视图使用同一时间戳');
    assert.equal(await new Runtime(directory).logs(channel), raw);
  }
});

test('日志尾部窗口与正在写入的 UTF-8 字符不会显示乱码，原始日志保持不变', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-log-tail-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'game.log');
  assert.equal(await readLogTail(file), '');
  await writeFile(file, '前缀🙂中文');
  assert.equal(await readLogTail(file, 9), '中文');
  const bytes = Buffer.from('测试');
  await writeFile(file, Buffer.concat([Buffer.from('\x1b[32m已有日志\x1b[0m\n'), bytes.subarray(0, 2)]));
  assert.equal(await readLogTail(file), '已有日志\n');
  await appendFile(file, bytes.subarray(2));
  assert.equal(await readLogTail(file), '已有日志\n测试');
  assert.match(await readFile(file, 'utf8'), /\x1b\[32m/);
});

test('登录记录独立存储，兼容旧面板日志且初始化不重复导入', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-login-logs-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'logs'));
  const oldLogin = '[2026-10-18 08:01:02.123 UTC] 登录失败（203.0.113.9，用户名 "old-admin"）\n';
  const original = `面板启动\n${oldLogin}普通任务：登录失败原因检查\n`;
  const panelFile = path.join(directory, 'logs/palbox.log');
  await writeFile(panelFile, original);
  // Existing combined journals must also hide old login records.
  await writeFile(path.join(directory, 'logs/combined.jsonl'), JSON.stringify({ channel: 'palbox', text: original }) + '\n');
  const runtime = new Runtime(directory);
  await runtime.initialize();
  runtime.log('login', '登录成功（198.51.100.2）\n');
  runtime.log('login', '登录尝试过于频繁（203.0.113.9）\n');
  runtime.log('palbox', '任务执行完成\n');
  await runtime.initialize();
  const log = await runtime.logs('login');
  assert.equal(log.split(oldLogin).length - 1, 1);
  assert.match(log, /\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} UTC\] 登录成功/);
  assert.match(log, /登录尝试过于频繁/);
  assert.doesNotMatch(log, /面板启动|任务执行完成/);
  assert.equal(await new Runtime(directory).logs('login'), log);
  assert.match(await readFile(panelFile, 'utf8'), /old-admin/);
  for (const channel of ['palbox', 'all']) {
    const text = await runtime.logs(channel);
    assert.doesNotMatch(text, /old-admin|登录成功|登录尝试过于频繁/);
    assert.match(text, /面板启动/);
    assert.match(text, /普通任务：登录失败原因检查/);
    assert.match(text, /任务执行完成/);
  }
});

test('子进程 stdout 和 stderr 分别流式解码，跨数据块的中文和表情保持完整', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-log-process-'));
  const runtime = new Runtime(directory);
  t.after(async () => { await runtime.close(); await rm(directory, { recursive: true, force: true }); });
  await runtime.initialize();
  const output = await runtime.run(process.execPath, ['-e', `
    const bytes = Buffer.from('中文🙂完成\\n');
    process.stdout.write(bytes.subarray(0, 1));
    setTimeout(() => {
      process.stderr.write('独立错误流\\n');
      process.stdout.write(bytes.subarray(1, 8));
      setTimeout(() => process.stdout.write(bytes.subarray(8)), 30);
    }, 30);
  `], 'steamcmd');
  for (const text of [output, await runtime.logs('steamcmd'), await readFile(path.join(directory, 'logs/steamcmd.log'), 'utf8')]) {
    assert.match(text, /中文🙂完成/);
    assert.match(text, /独立错误流/);
    assert.doesNotMatch(text, /\ufffd/);
  }
});

test('全部日志按接收顺序合并来源，保留跨块文本并清理终端控制码', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-combined-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runtime = new Runtime(directory);
  await runtime.initialize();
  runtime.log('game', '\x1b[32m游戏中文🙂\x1b[0m\n');
  runtime.log('steamcmd', '安装 10%\r安装 20%\n');
  runtime.log('palbox', '任务完成\n');
  runtime.log('game', '跨块');
  runtime.log('palbox', '插入其他来源\n');
  runtime.log('game', '消息\n');
  const bytes = Buffer.from('分块中文🙂\n');
  runtime.log('steamcmd', bytes.subarray(0, 1));
  runtime.log('steamcmd', bytes.subarray(1));
  const lines = (await runtime.logs('all')).trimEnd().split('\n').map(line => line.replace(/^\[[^\]]+\] /, ''));
  assert.deepEqual(lines, ['[game] 游戏中文🙂', '[update] 安装 20%', '[PalBox] 任务完成', '[game] 跨块消息', '[PalBox] 插入其他来源', '[update] 分块中文🙂']);
  assert.equal(await new Runtime(directory).logs('all'), await runtime.logs('all'), '重建 Runtime 后可读取已保存的统一日志');
  assert.match(await readFile(path.join(directory, 'logs/game.log'), 'utf8'), /\x1b\[32m/);
});

test('统一日志首次保留原有历史且不重复导入，超长中文日志保持有界', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-combined-history-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'logs'));
  await writeFile(path.join(directory, 'logs/game.log'), '已有游戏日志\n');
  await writeFile(path.join(directory, 'logs/palbox.log'), '已有面板日志\n登录成功（127.0.0.1）\n');
  const runtime = new Runtime(directory);
  await runtime.initialize();
  runtime.log('palbox', '新增日志\n');
  await runtime.initialize();
  const history = await runtime.logs('all');
  assert.equal(history.split('已有游戏日志').length - 1, 1);
  assert.match(history, /\[PalBox\] 已有面板日志/);
  assert.match(history, /\[PalBox\] 新增日志/);
  assert.doesNotMatch(history, /登录成功/);
  assert.match(await runtime.logs('login'), /登录成功（127.0.0.1）/);
  runtime.log('game', '中文🙂'.repeat(16000) + '最后一行\n');
  const text = await runtime.logs('all');
  assert.ok(Buffer.byteLength(text) <= 65536);
  assert.match(text, /\[game\] /);
  assert.match(text, /最后一行\n$/);
  assert.doesNotMatch(text, /\ufffd/);
});
