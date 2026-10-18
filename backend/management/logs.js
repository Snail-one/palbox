import { open } from 'node:fs/promises';
import { watch } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { stripVTControlCharacters } from 'node:util';
import path from 'node:path';

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

export async function readLogTail(file, limit = 65536) {
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
    return readableLog(new StringDecoder('utf8').write(buffer.subarray(start, bytesRead)));
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  } finally { await handle?.close(); }
}

export async function streamLogs({ request, response, runtime, auth, channel }) {
  const initial = await runtime.logs(channel); // Validate before sending SSE headers.
  if (response.destroyed) return;
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, no-transform',
    'X-Content-Type-Options': 'nosniff',
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
      if (!filename || String(filename) === `${channel}.log`) void refresh();
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
