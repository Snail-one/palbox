import { open, stat, writeFile } from 'node:fs/promises';
import { watch, appendFileSync, existsSync, renameSync, statSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { stripVTControlCharacters } from 'node:util';
import path from 'node:path';
import { API_SECURITY_HEADERS } from '../security-headers.js';

const sources = { game: '游戏', steamcmd: '安装更新', palbox: '面板' };
const combinedFile = directory => path.join(directory, 'logs/combined.jsonl');

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

export function appendLog(file, value) {
  if (existsSync(file) && statSync(file).size > 5 * 1024 * 1024) renameSync(file, file + '.1');
  appendFileSync(file, value, { mode: 0o600 });
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

export function appendCombinedLog(directory, channel, text, at = new Date().toISOString()) {
  if (!Object.hasOwn(sources, channel) || !text) return;
  // Bound each record so a large burst still fits in the journal tail window.
  const records = text.match(/[\s\S]{1,16384}/gu).map(part => JSON.stringify({ at, channel, text: part }) + '\n');
  appendLog(combinedFile(directory), records.join(''));
}

function utf8Tail(text, limit) {
  const bytes = Buffer.from(text);
  let start = Math.max(0, bytes.length - limit);
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString('utf8');
}

export async function readCombinedLog(directory, limit = 65536) {
  const journal = await readUtf8Tail(combinedFile(directory), 512 * 1024);
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
    const prefix = `${row.at ? logTimestamp(row.at) + ' ' : ''}[${sources[row.channel]}] `;
    const available = remaining - Buffer.byteLength(prefix + '\n');
    if (available < 0) break;
    const text = readableLog(row.text);
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

async function readUtf8Tail(file, limit) {
  let handle;
  try {
    handle = await open(file, 'r');
    const { size } = await handle.stat();
    const offset = Math.max(0, size - limit);
    const buffer = Buffer.alloc(Math.min(size, limit));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    let start = 0;
    // The tail window may begin in the middle of a UTF-8 character.
    if (offset) while (start < bytesRead && (buffer[start] & 0xc0) === 0x80) start++;
    // A producer may still be writing the final character. Do not flush an
    // incomplete UTF-8 sequence as a replacement character into the snapshot.
    return new StringDecoder('utf8').write(buffer.subarray(start, bytesRead));
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  } finally { await handle?.close(); }
}

export async function readLogTail(file, limit = 65536) {
  return readableLog(await readUtf8Tail(file, limit));
}

export async function streamLogs({ request, response, runtime, auth, channel }) {
  const initial = await runtime.logs(channel); // Validate before sending SSE headers.
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
  function publish(text) {
    if (closed || response.writableNeedDrain || text === previous) return;
    response.write(`event: log\ndata: ${JSON.stringify({ text })}\n\n`);
    previous = text;
  }
  async function refresh() {
    if (closed) return;
    if (!auth.session(request)) {
      response.end('event: unauthorized\ndata: {}\n\n'); close(); return;
    }
    if (reading) { dirty = true; return; }
    reading = true;
    try {
      do {
        dirty = false;
        publish(await runtime.logs(channel));
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
      if (!filename || String(filename) === target) void refresh();
    });
    watcher.on('error', () => { watcher.close(); });
  } catch { /* The periodic check also handles a temporarily missing directory. */ }
  timer = setInterval(refresh, 1000);
  heartbeat = setInterval(() => {
    if (!closed && !response.writableNeedDrain) response.write(': heartbeat\n\n');
  }, 15000);
  publish(initial);
  void refresh(); // Catch writes between the initial read and watcher setup.
}
