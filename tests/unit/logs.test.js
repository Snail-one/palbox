import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, appendFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readableLog, readLogTail } from '../../backend/management/logs.js';
import { Runtime } from '../../backend/management/runtime.js';

test('日志隐藏终端颜色、标题与控制字符，并将进度回车和退格显示为可读文本', () => {
  assert.equal(readableLog('\x1b[32m中文启动🙂\x1b[0m\r\n\x1b]0;标题\x07进度 10%\r进度 20%\r\nabc\bD\x00\n'), '中文启动🙂\n进度 20%\nabD\n');
  assert.equal(readableLog('进度 50%\r'), '进度 50%');
  assert.equal(readableLog('正文\x1b[31'), '正文');
  assert.equal(readableLog('正文\x1b]0;未完成标题'), '正文');
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
