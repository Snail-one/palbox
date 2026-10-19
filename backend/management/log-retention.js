import { appendFileSync, closeSync, lstatSync, openSync, readSync, readdirSync, renameSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const DAY = 24 * 60 * 60 * 1000;
export const LOG_FILES = Object.freeze(['game.log', 'steamcmd.log', 'palbox.log', 'login.log', 'combined.jsonl']);
export const DEFAULT_LOG_POLICY = Object.freeze({ maxBytes: 5 * 1024 * 1024, maxArchives: 1, retentionMs: 7 * DAY, cleanupIntervalMs: 60 * 60 * 1000 });

export function logPolicy(options = {}) {
  const policy = { ...DEFAULT_LOG_POLICY, ...options };
  if (!Number.isSafeInteger(policy.maxBytes) || policy.maxBytes < 256 || policy.maxBytes > 100 * 1024 * 1024
    || !Number.isInteger(policy.maxArchives) || policy.maxArchives < 0 || policy.maxArchives > 10
    || !Number.isSafeInteger(policy.retentionMs) || policy.retentionMs < 1
    || !Number.isSafeInteger(policy.cleanupIntervalMs) || policy.cleanupIntervalMs < 1) throw new Error('日志保留参数无效。');
  return Object.freeze(policy);
}

export function logPolicyFromEnv(env) {
  function integer(name, fallback, min, max) {
    const value = env[name];
    if (value === undefined) return fallback;
    if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) throw new Error(`${name} 必须是 ${min} 到 ${max} 的整数。`);
    return Number(value);
  }
  return logPolicy({
    maxBytes: integer('PALBOX_LOG_MAX_MB', 5, 1, 100) * 1024 * 1024,
    maxArchives: integer('PALBOX_LOG_BACKUPS', 1, 0, 10),
    retentionMs: integer('PALBOX_LOG_RETENTION_DAYS', 7, 1, 365) * DAY
  });
}

function regularFile(file) {
  const info = lstatSync(file, { throwIfNoEntry: false });
  if (info && !info.isFile()) throw Object.assign(new Error('日志路径必须是普通文件。'), { code: 'EINVAL' });
  return info;
}

function remove(file) {
  if (regularFile(file)) unlinkSync(file);
}

function rotate(file, policy) {
  if (!policy.maxArchives) { remove(file); return; }
  remove(`${file}.${policy.maxArchives}`);
  for (let index = policy.maxArchives - 1; index >= 1; index--) {
    const previous = `${file}.${index}`;
    if (regularFile(previous)) renameSync(previous, `${file}.${index + 1}`);
  }
  // Do not replace a symlink or directory in the archive slot.
  regularFile(file + '.1');
  renameSync(file, file + '.1');
}

function tail(buffer, limit, jsonl) {
  let start = Math.max(0, buffer.length - limit);
  if (start && jsonl && buffer[start - 1] !== 10) {
    const newline = buffer.indexOf(10, start);
    start = newline < 0 ? buffer.length : newline + 1;
  }
  while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start++;
  return buffer.subarray(start);
}

function replace(file, buffer, mtime) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, buffer, { flag: 'wx', mode: 0o600 });
    // Preserve the original age when shrinking an oversized archive.
    if (mtime) utimesSync(temporary, mtime, mtime);
    renameSync(temporary, file);
  } finally {
    try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function shrink(file, info, policy) {
  const descriptor = openSync(file, 'r');
  const buffer = Buffer.alloc(policy.maxBytes + 1);
  let length;
  try { length = readSync(descriptor, buffer, 0, buffer.length, info.size - buffer.length); }
  finally { closeSync(descriptor); }
  const recent = tail(buffer.subarray(0, length), policy.maxBytes, file.includes('.jsonl'));
  replace(file, recent, info.mtime);
  return recent.length;
}

export function appendLog(file, value, policy = DEFAULT_LOG_POLICY) {
  const jsonl = file.endsWith('.jsonl');
  // A single burst can exceed the whole ring. Skip the part that would be
  // evicted immediately, bounding both disk writes and the number of rotations.
  const buffer = tail(Buffer.from(value), policy.maxBytes * (policy.maxArchives + 1), jsonl);
  if (!buffer.length) return;
  const info = regularFile(file);
  let size = info?.size ?? 0;
  if (info && info.mtimeMs < Date.now() - policy.retentionMs) { replace(file, Buffer.alloc(0)); size = 0; }
  else if (size > policy.maxBytes) size = shrink(file, info, policy);
  let offset = 0;
  while (offset < buffer.length) {
    let end = Math.min(buffer.length, offset + policy.maxBytes - size);
    if (end > offset && end < buffer.length) {
      const newline = buffer.lastIndexOf(10, end - 1);
      if (newline >= offset) end = newline + 1;
      else if (jsonl) end = offset;
      else while (end > offset && (buffer[end] & 0xc0) === 0x80) end--;
    }
    if (end === offset) {
      if (!size) throw new Error('单条日志记录超过文件大小上限。');
      rotate(file, policy); size = 0;
      continue;
    }
    appendFileSync(file, buffer.subarray(offset, end), { mode: 0o600 });
    size += end - offset;
    offset = end;
    if (offset < buffer.length) { rotate(file, policy); size = 0; }
  }
}

export function cleanupLogs(directory, policy = DEFAULT_LOG_POLICY, now = Date.now()) {
  const errors = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (/^(game\.log|steamcmd\.log|palbox\.log|login\.log|combined\.jsonl)\.[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.tmp$/.test(entry.name)) {
      try { remove(path.join(directory, entry.name)); } catch (error) { errors.push(error); }
      continue;
    }
    const match = /^(game\.log|steamcmd\.log|palbox\.log|login\.log|combined\.jsonl)(?:\.([1-9]\d*))?$/.exec(entry.name);
    if (!match) continue;
    const file = path.join(directory, entry.name);
    try {
      const info = regularFile(file);
      if (!info) continue;
      const archive = Number(match[2] || 0);
      if (archive > policy.maxArchives || (archive && info.mtimeMs < now - policy.retentionMs)) remove(file);
      else if (info.mtimeMs < now - policy.retentionMs && info.size) {
        // Keep empty active files as migration markers, so clearing an old
        // login/combined log cannot cause legacy history to be imported again.
        replace(file, Buffer.alloc(0));
      } else if (info.size > policy.maxBytes) shrink(file, info, policy);
    } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, '部分日志清理失败。');
}
