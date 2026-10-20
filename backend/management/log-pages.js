import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { failure } from './files.js';
import { logFileNames } from './log-retention.js';

const BLOCK_BYTES = 16 * 1024;
const PAGE_BLOCKS = 4;
const hash = bytes => createHash('sha256').update(bytes).digest('base64url');

async function bytes(file, offset, length) {
  const buffer = Buffer.alloc(length);
  let count = 0;
  while (count < length) {
    const { bytesRead } = await file.handle.read(buffer, count, length - count, offset + count);
    if (!bytesRead) break;
    count += bytesRead;
  }
  return buffer.subarray(0, count);
}

async function fingerprint(file, offset, headLength = Math.min(32, file.size)) {
  const head = await bytes(file, 0, headLength);
  const tail = await bytes(file, Math.max(0, offset - 32), Math.min(32, offset));
  return { headLength, digest: hash(Buffer.concat([head, tail])) };
}

async function cursor(channel, file, offset) {
  return Buffer.from(JSON.stringify({ v: 1, channel, file: file.key, offset, ...await fingerprint(file, offset) })).toString('base64url');
}

function parseCursor(value, channel) {
  try {
    if (typeof value !== 'string' || value.length > 1024 || !/^[\w-]+$/.test(value)) throw new Error();
    const result = JSON.parse(Buffer.from(value, 'base64url'));
    if (result.v !== 1 || result.channel !== channel || typeof result.file !== 'string' || result.file.length > 120
      || !Number.isSafeInteger(result.offset) || result.offset < 0
      || !Number.isInteger(result.headLength) || result.headLength < 0 || result.headLength > 32
      || typeof result.digest !== 'string' || !/^[\w-]{43}$/.test(result.digest)) throw new Error();
    return result;
  } catch { throw failure('日志位置无效，请返回最新日志。', 400); }
}

/** Fixed byte blocks keep their identity when a partial block grows or a file rotates. */
export async function readLogPage(directory, channel, maxArchives, { before, after } = {}) {
  if (!['all', 'game', 'steamcmd', 'palbox', 'login'].includes(channel)) throw failure('日志类型不存在。', 404);
  if (before !== undefined && after !== undefined) throw failure('不能同时读取前后两个方向的日志。', 400);
  const position = before !== undefined ? parseCursor(before, channel) : after !== undefined ? parseCursor(after, channel) : null;
  const base = path.join(directory, 'logs', channel === 'all' ? 'combined.jsonl' : `${channel}.log`);
  const files = [];
  try {
    const seen = new Set();
    // Open current first: renames during this scan cannot duplicate an inode.
    for (const name of logFileNames(base, maxArchives).reverse()) {
      let handle;
      try {
        handle = await open(name, constants.O_RDONLY | constants.O_NOFOLLOW);
        const info = await handle.stat();
        const key = `${info.dev}:${info.ino}:${info.birthtimeMs}`;
        if (!info.isFile() || seen.has(key)) { await handle.close(); continue; }
        seen.add(key);
        files.unshift({ handle, key, size: info.size });
      } catch (error) {
        await handle?.close();
        if (!['ENOENT', 'ELOOP'].includes(error.code)) throw error;
      }
    }
    let index = position ? files.findIndex(file => file.key === position.file) : files.length - 1;
    let valid = !position;
    if (position && index >= 0 && position.offset <= files[index].size && position.headLength <= files[index].size) {
      valid = (await fingerprint(files[index], position.offset, position.headLength)).digest === position.digest;
    }
    const gap = Boolean(position && !valid);
    if (gap && before !== undefined) return { blocks: [], before: null, after: null, hasMore: false, hasNewer: false, gap: true };
    const forward = after !== undefined && valid;
    if (!position || gap) index = files.length - 1;
    const blocks = [];
    if (forward) {
      for (let item = index; item < files.length && blocks.length < PAGE_BLOCKS; item++) {
        const file = files[item];
        const offset = item === index ? position.offset : 0;
        if (offset === file.size) continue;
        for (let start = Math.floor(offset / BLOCK_BYTES) * BLOCK_BYTES; start < file.size && blocks.length < PAGE_BLOCKS; start += BLOCK_BYTES) {
          const data = await bytes(file, start, Math.min(BLOCK_BYTES, file.size - start));
          blocks.push({ file: file.key, start, data: data.toString('base64'), index: item, end: start + data.length });
        }
      }
    } else {
      for (let item = index; item >= 0 && blocks.length < PAGE_BLOCKS; item--) {
        const file = files[item];
        let end = valid && position && item === index ? position.offset : file.size;
        while (end > 0 && blocks.length < PAGE_BLOCKS) {
          const start = Math.floor((end - 1) / BLOCK_BYTES) * BLOCK_BYTES;
          const data = await bytes(file, start, end - start);
          blocks.unshift({ file: file.key, start, data: data.toString('base64'), index: item, end: start + data.length });
          end = start;
        }
      }
    }
    const first = blocks[0], last = blocks.at(-1);
    return {
      blocks: blocks.map(({ file, start, data }) => ({ file, start, data })),
      before: first ? await cursor(channel, files[first.index], first.start) : null,
      after: last ? await cursor(channel, files[last.index], last.end) : after ?? null,
      hasMore: Boolean(first && (first.start > 0 || files.slice(0, first.index).some(file => file.size))),
      hasNewer: Boolean(last && (last.end < files[last.index].size || files.slice(last.index + 1).some(file => file.size))),
      gap
    };
  } finally { await Promise.allSettled(files.map(file => file.handle.close())); }
}
