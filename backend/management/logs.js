import { open, stat, writeFile } from 'node:fs/promises';
import { constants, watch } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { stripVTControlCharacters } from 'node:util';
import path from 'node:path';
import { API_SECURITY_HEADERS } from '../security-headers.js';
import { appendLog, DEFAULT_LOG_POLICY, logFileNames } from './log-retention.js';

const sources = { game: 'game', steamcmd: 'update', palbox: 'PalBox' };
const combinedFile = directory => path.join(directory, 'logs/combined.jsonl');
const isLoginRecord = text => /^(?:\[[^\]\r\n]+\]\s+)?登录(?:成功|失败|尝试过于频繁)（/.test(text);

export function withoutLoginLogs(text) {
  return text.split(/(?<=\n)/).filter(line => !isLoginRecord(line)).join('');
}

export async function initializeLoginLog(directory) {
  const file = path.join(directory, 'logs/login.log');
  try { await stat(file); return; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const legacy = await readLogTail(path.join(directory, 'logs/palbox.log'));
  const text = legacy.split(/(?<=\n)/).filter(isLoginRecord).join('');
  try { await writeFile(file, text && !text.endsWith('\n') ? text + '\n' : text, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}

export const logTimestamp = at => `[${at.replace('T', ' ').replace(/Z$/, ' UTC')}]`;

export function timestampLogChunk(text, at, state) {
  let output = '';
  for (const part of text.split(/([\r\n])/)) {
    if (!part) continue;
    if (part === '\n') {
      output += part;
      state.prefix = true;
      state.at = null;
    } else if (part === '\r') {
      output += part;
      // Progress output rewrites the same line: repeat its original timestamp.
      state.prefix = true;
    } else {
      if (state.prefix) {
        state.at ??= at;
        output += logTimestamp(state.at) + ' ';
        state.prefix = false;
      }
      output += part;
    }
  }
  return output;
}

export async function initializeCombinedLog(directory) {
  const file = combinedFile(directory);
  try { await stat(file); return; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Existing plain logs have no shared timestamps: retain their recent history
  // by source once, then record new output in the order received by Runtime.
  const history = await Promise.all(Object.keys(sources).map(async channel => {
    const text = await readLogTail(path.join(directory, 'logs', `${channel}.log`));
    return text ? JSON.stringify({ channel, text }) + '\n' : '';
  }));
  try { await writeFile(file, history.join(''), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}

export function appendCombinedLog(directory, channel, text, at = new Date().toISOString(), policy = DEFAULT_LOG_POLICY) {
  if (!Object.hasOwn(sources, channel) || !text) return;
  text = utf8Tail(text, policy.maxBytes * (policy.maxArchives + 1));
  // Preserve complete JSON records even with a small configured file limit.
  function* encode(part) {
    const record = JSON.stringify({ at, channel, text: part }) + '\n';
    if (Buffer.byteLength(record) <= policy.maxBytes) { yield record; return; }
    let middle = Math.floor(part.length / 2);
    if (/[\uDC00-\uDFFF]/.test(part[middle])) middle--;
    if (!middle) throw new Error('日志文件大小不足以保存单条记录。');
    yield* encode(part.slice(0, middle));
    yield* encode(part.slice(middle));
  }
  const records = [];
  for (const match of text.matchAll(/[\s\S]{1,16384}/gu)) records.push(...encode(match[0]));
  appendLog(combinedFile(directory), records.join(''), policy);
}

function utf8Tail(text, limit) {
  const bytes = Buffer.from(text);
  let start = Math.max(0, bytes.length - limit);
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString('utf8');
}

export async function readCombinedLog(directory, limit = 65536, maxArchives = DEFAULT_LOG_POLICY.maxArchives) {
  const journal = await readUtf8Tail(combinedFile(directory), 512 * 1024, maxArchives);
  const rows = [];
  const pending = new Map();
  for (const line of journal.split('\n')) {
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    if (!record || !Object.hasOwn(sources, record.channel) || typeof record.text !== 'string') continue;
    const parts = record.text.split('\n');
    for (let index = 0; index < parts.length; index++) {
      if (index === parts.length - 1 && !parts[index]) break;
      let row = pending.get(record.channel);
      if (!row) {
        row = { channel: record.channel, at: record.at, text: '' };
        rows.push(row);
        pending.set(record.channel, row);
      }
      row.text += parts[index];
      if (index < parts.length - 1) pending.delete(record.channel);
    }
  }
  const result = [];
  let remaining = limit;
  for (const row of rows.reverse()) {
    const text = readableLog(row.text);
    if (row.channel === 'palbox' && isLoginRecord(text)) continue;
    const prefix = `${row.at ? logTimestamp(row.at) + ' ' : ''}[${sources[row.channel]}] `;
    const available = remaining - Buffer.byteLength(prefix + '\n');
    if (available < 0) break;
    const tail = utf8Tail(text, available);
    const formatted = prefix + tail + '\n';
    result.unshift(formatted);
    remaining -= Buffer.byteLength(formatted);
    if (tail !== text) break;
  }
  return result.join('');
}

export function readableLog(text) {
  // Hide unfinished terminal escape sequences until the next file update.
  text = text.replace(/\x1b(?:\[[0-?]*[ -/]*|\][^\x07\x1b]*)?$/, '');
  text = stripVTControlCharacters(text).replace(/\r\n/g, '\n');
  return text.split('\n').map(line => {
    const frames = line.split('\r');
    const latest = frames.at(-1) || frames.at(-2) || '';
    const result = [];
    for (const character of latest) {
      if (character === '\b') result.pop();
      else if (!/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(character)) result.push(character);
    }
    return result.join('');
  }).join('\n');
}

async function readUtf8Tail(file, limit, maxArchives = DEFAULT_LOG_POLICY.maxArchives) {
  const chunks = [];
  const seen = new Set();
  let remaining = limit;
  for (const name of logFileNames(file, maxArchives).reverse()) {
    if (remaining <= 0) break;
    let handle;
    try {
      handle = await open(name, constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = await handle.stat();
      if (!info.isFile()) continue;
      const { size, dev, ino } = info;
      const key = `${dev}:${ino}`;
      // A rotation between two opens can move the current inode into .1.
      if (seen.has(key)) continue;
      seen.add(key);
      const buffer = Buffer.alloc(Math.min(size, remaining));
      let read = 0;
      while (read < buffer.length) {
        const { bytesRead } = await handle.read(buffer, read, buffer.length - read, Math.max(0, size - buffer.length) + read);
        if (!bytesRead) break;
        read += bytesRead;
      }
      chunks.unshift(buffer.subarray(0, read));
      remaining -= read;
    } catch (error) { if (!['ENOENT', 'ELOOP'].includes(error.code)) throw error; }
    finally { await handle?.close(); }
  }
  const buffer = Buffer.concat(chunks);
  let start = 0;
  while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start++;
  return new StringDecoder('utf8').write(buffer.subarray(start));
}

export async function readLogTail(file, limit = 65536, maxArchives = DEFAULT_LOG_POLICY.maxArchives) {
  return readableLog(await readUtf8Tail(file, limit, maxArchives));
}

export async function streamLogs({ request, response, runtime, auth, channel, pages = false, after }) {
  let cursor = after;
  const read = () => pages ? runtime.logPage(channel, cursor ? { after: cursor } : {}) : runtime.logs(channel);
  const initial = await read(); // Validate before sending SSE headers.
  if (!auth.session(request)) throw Object.assign(new Error('请先登录管理面板。'), { status: 401 });
  if (response.destroyed) return;
  response.writeHead(200, {
    ...API_SECURITY_HEADERS,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, no-transform',
    'X-Accel-Buffering': 'no'
  });
  response.flushHeaders();
  response.write('retry: 1000\n\n');
  request.setTimeout(0);
  response.setTimeout(0);
  let previous;
  let reading = false;
  let dirty = false;
  let closed = false;
  let watcher;
  let timer;
  let heartbeat;
  function close() {
    closed = true;
    watcher?.close();
    clearInterval(timer);
    clearInterval(heartbeat);
  }
  response.once('close', close);
  function publish(value) {
    const data = JSON.stringify(pages ? value : { text: value });
    if (closed || response.writableNeedDrain || data === previous) return false;
    if (pages && value.after) cursor = value.after;
    response.write(`${pages && cursor ? `id: ${cursor}\n` : ''}event: log\ndata: ${data}\n\n`);
    previous = data;
    return true;
  }
  async function refresh() {
    if (closed) return;
    if (!auth.session(request)) {
      response.end('event: unauthorized\ndata: {}\n\n'); close(); return;
    }
    if (reading) { dirty = true; return; }
    if (response.writableNeedDrain) return;
    reading = true;
    try {
      do {
        dirty = false;
        const value = await read();
        if (!auth.session(request)) { response.end('event: unauthorized\ndata: {}\n\n'); close(); return; }
        const published = publish(value);
        if (pages && published && value.hasNewer && !response.writableNeedDrain) dirty = true;
      } while (dirty && !closed);
    } catch {
      response.end(); close(); // EventSource reconnects and retries a fresh snapshot.
    } finally { reading = false; }
  }
  // Watch the directory so file creation and rotation keep the subscription alive.
  // A periodic check covers filesystems where watch events are unavailable.
  try {
    watcher = watch(path.join(runtime.directory, 'logs'), (_event, filename) => {
      const target = channel === 'all' ? 'combined.jsonl' : `${channel}.log`;
      if (!filename || String(filename) === target || String(filename).startsWith(target + '.')) void refresh();
    });
    watcher.on('error', () => { watcher.close(); });
  } catch { /* The periodic check also handles a temporarily missing directory. */ }
  timer = setInterval(refresh, 1000);
  response.on('drain', refresh);
  heartbeat = setInterval(() => {
    if (!closed && !response.writableNeedDrain) response.write(': heartbeat\n\n');
  }, 15000);
  publish(initial);
  void refresh(); // Catch writes between the initial read and watcher setup.
}
