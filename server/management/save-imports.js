import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, lstat, rename, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { failure, jsonWrite, readJson } from './files.js';
import { saveName, worldName } from './native-backups.js';

const run = promisify(execFile);
const importId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const listing = /^([-d])[-rwxsStT]{9}[.+@]?\s+\d+\/\d+\s+(\d+)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s+(.+)$/;

export const DEFAULT_IMPORT_LIMITS = Object.freeze({
  maxCompressedBytes: 1024 ** 3,
  maxUncompressedBytes: 4 * 1024 ** 3,
  maxEntries: 20000,
  maxListingLine: 8192,
  maxListingBytes: 64 * 1024 * 1024,
  tarTimeoutMs: 120000,
  ttlMs: 60 * 60 * 1000
});

function cleanName(value, type) {
  if (typeof value !== 'string' || !value) throw failure('压缩包包含无效路径。');
  if (value.startsWith('/') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value) || value.trim() !== value) throw failure('压缩包包含无效路径。');
  let name = value.replace(/^(?:\.\/)+/, '');
  if (name.endsWith('/')) name = name.slice(0, -1);
  if (!name) {
    if (type === 'directory') return '';
    throw failure('压缩包包含无效路径。');
  }
  const parts = name.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /^[A-Za-z]:$/.test(part))) throw failure('压缩包包含不允许的路径。');
  return name;
}

function validateEntries(entries) {
  const names = new Set();
  const files = new Set();
  const normalized = [];
  for (const entry of entries) {
    const name = cleanName(entry?.name, entry?.type);
    if (!name) continue;
    if (names.has(name)) throw failure('压缩包包含重复路径。');
    names.add(name);
    if (entry.type === 'file') files.add(name);
    normalized.push({ name, type: entry.type, size: Number(entry.size) || 0 });
  }
  for (const name of names) {
    const parts = name.split('/');
    for (let i = 1; i < parts.length; i++) if (files.has(parts.slice(0, i).join('/'))) throw failure('压缩包包含不允许的路径。');
  }
  return normalized;
}

export function detectSnapshot(entries) {
  const normalized = validateEntries(entries);
  const files = new Map(normalized.filter(entry => entry.type === 'file').map(entry => [entry.name, entry]));
  const candidates = [];
  for (const entry of files.values()) {
    if (entry.name !== 'Level.sav' && !entry.name.endsWith('/Level.sav')) continue;
    const root = entry.name === 'Level.sav' ? '' : entry.name.slice(0, -10);
    if (!files.has(root ? `${root}/LevelMeta.sav` : 'LevelMeta.sav')) continue;
    const layout = root === '' ? 'root'
      : /^SaveGames\/0\/([A-Za-z0-9_-]{1,128})$/.test(root) ? 'savegames'
      : /^Pal\/Saved\/SaveGames\/0\/([A-Za-z0-9_-]{1,128})$/.test(root) ? 'pal-saved' : null;
    if (!layout) continue;
    const worldId = layout === 'root' ? null : root.split('/').at(-1);
    candidates.push({ root, layout, worldId });
  }
  if (!candidates.length) throw failure('压缩包中没有可导入的世界存档（需要 Level.sav 和 LevelMeta.sav）。');
  if (candidates.length > 1) throw failure('压缩包包含多个世界存档，请只保留一个世界后重新压缩。');
  const [{ root, layout, worldId }] = candidates;
  const prefix = root ? `${root}/` : '';
  const level = files.get(`${prefix}Level.sav`);
  const meta = files.get(`${prefix}LevelMeta.sav`);
  if (!level.size || !meta.size) throw failure('世界存档文件为空，无法导入。');
  const copy = [];
  for (const entry of files.values()) {
    if (!entry.name.startsWith(prefix)) continue;
    const relative = entry.name.slice(prefix.length);
    if (relative.includes('/')) {
      if (!relative.startsWith('Players/')) continue;
      const player = relative.slice('Players/'.length);
      if (player.includes('/') || !saveName.test(player) || !entry.size) throw failure('官方存档的玩家文件无效。');
      copy.push(relative);
      continue;
    }
    if (saveName.test(relative) && entry.size) copy.push(relative);
  }
  if (!copy.includes('Level.sav') || !copy.includes('LevelMeta.sav')) throw failure('世界存档不完整。');
  return { root, layout, worldId, copy };
}

function tarEnvironment() {
  const env = { ...process.env, LC_ALL: 'C', LANG: 'C', TZ: 'UTC' };
  delete env.TAR_OPTIONS;
  delete env.POSIXLY_CORRECT;
  return env;
}

export class SaveImports {
  constructor({ directory, runtime, native, limits = {} }) {
    this.directory = path.resolve(directory);
    this.runtime = runtime;
    this.native = native;
    this.limits = { ...DEFAULT_IMPORT_LIMITS, ...limits };
    this.root = path.join(this.directory, 'palbox/imports');
  }

  async initialize() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await this.cleanup();
  }

  async cleanup() {
    let entries;
    try { entries = await readdir(this.root, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    const now = Date.now();
    for (const entry of entries) {
      const file = path.join(this.root, entry.name);
      try {
        const info = await lstat(file);
        if (now - info.mtimeMs > this.limits.ttlMs) await rm(file, { recursive: true, force: true });
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }

  resolve(id) {
    if (typeof id !== 'string' || !importId.test(id)) throw failure('导入存档不存在或已过期，请重新上传。', 404);
    return { directory: path.join(this.root, id), snapshot: path.join(this.root, id, 'snapshot') };
  }

  async get(id) {
    const { directory, snapshot } = this.resolve(id);
    let meta;
    try { meta = await readJson(path.join(directory, 'meta.json')); }
    catch (error) { if (error.code === 'ENOENT' || error.name === 'SyntaxError') throw failure('导入存档不存在或已过期，请重新上传。', 404); throw error; }
    if (!meta || Date.now() - Date.parse(meta.createdAt) > this.limits.ttlMs) {
      await this.remove(id);
      throw failure('导入存档已过期，请重新上传。', 404);
    }
    let info;
    try { info = await lstat(snapshot); }
    catch (error) { if (error.code === 'ENOENT') throw failure('导入存档不存在或已过期，请重新上传。', 404); throw error; }
    if (!info.isDirectory()) throw failure('导入存档无效，请重新上传。', 404);
    const inspected = await this.native.inspect(snapshot, { requirePlayers: false });
    if (inspected.files.length !== meta.files.length || inspected.bytes !== meta.uncompressedBytes) throw failure('导入存档已损坏，请重新上传。', 404);
    return { ...meta, snapshot };
  }

  async remove(id) {
    const { directory } = this.resolve(id);
    await rm(directory, { recursive: true, force: true });
  }

  async scan(archive) {
    let stdout;
    try {
      ({ stdout } = await run('tar', ['-tvzf', archive, '--numeric-owner', '--quoting-style=escape'], {
        maxBuffer: this.limits.maxListingBytes,
        timeout: this.limits.tarTimeoutMs,
        env: tarEnvironment()
      }));
    } catch (error) {
      if (error.code === 'ENOBUFS') throw failure('压缩包目录过大，无法安全校验。', 413);
      if (error.killed || error.signal) throw failure('压缩包校验超时，请检查文件。', 400);
      throw failure('不是有效的 .tar.gz 存档。', 400);
    }
    const entries = [];
    let bytes = 0;
    for (const line of stdout.split('\n')) {
      if (!line) continue;
      if (line.length > this.limits.maxListingLine) throw failure('压缩包包含过长的路径。', 400);
      const match = listing.exec(line);
      if (!match) throw failure('压缩包目录格式无法识别。', 400);
      const type = match[1] === 'd' ? 'directory' : 'file';
      const size = Number(match[2]);
      if (!Number.isSafeInteger(size) || size < 0) throw failure('压缩包包含无效文件大小。', 400);
      if (type === 'file') bytes += size;
      if (bytes > this.limits.maxUncompressedBytes) throw failure('压缩包解压后超过大小限制。', 413);
      entries.push({ name: match[3], type, size });
      if (entries.length > this.limits.maxEntries) throw failure('压缩包条目数量超过限制。', 413);
    }
    return { ...detectSnapshot(entries), entries, uncompressedBytes: bytes };
  }

  async verify(directory) {
    let bytes = 0;
    let count = 0;
    const walk = async current => {
      for (const entry of await readdir(current, { withFileTypes: true })) {
        const file = path.join(current, entry.name);
        const info = await lstat(file);
        if (info.isDirectory()) await walk(file);
        else if (info.isFile()) { bytes += info.size; count++; }
        else throw failure('导入存档包含链接或特殊文件。', 400);
        if (bytes > this.limits.maxUncompressedBytes || count > this.limits.maxEntries) throw failure('导入存档超过大小限制。', 413);
      }
    };
    await walk(directory);
    return { bytes, count };
  }

  async extract(archive, detected, directory) {
    const extract = path.join(directory, 'extract');
    const snapshot = path.join(directory, 'snapshot');
    await mkdir(extract, { mode: 0o700 });
    try {
      try {
        await run('tar', ['-xzf', archive, '--no-same-owner', '--no-same-permissions', '--no-overwrite-dir', '-C', extract], {
          maxBuffer: 1024 * 1024,
          timeout: this.limits.tarTimeoutMs,
          env: tarEnvironment()
        });
      } catch { throw failure('无法解压存档压缩包。', 400); }
      let source = extract;
      for (const part of detected.root.split('/').filter(Boolean)) {
        source = path.join(source, part);
        const info = await lstat(source).catch(error => { if (error.code === 'ENOENT') throw failure('压缩包中的世界目录不存在。', 400); throw error; });
        if (!info.isDirectory()) throw failure('压缩包中的世界目录无效。', 400);
      }
      await mkdir(snapshot, { mode: 0o700 });
      for (const name of detected.copy) {
        const from = path.join(source, name);
        const to = path.join(snapshot, name);
        const info = await lstat(from).catch(error => { if (error.code === 'ENOENT') throw failure('压缩包中的世界存档不完整。', 400); throw error; });
        if (!info.isFile() || !info.size) throw failure('压缩包中的世界存档无效。', 400);
        await mkdir(path.dirname(to), { recursive: true, mode: 0o700 });
        await rename(from, to);
      }
      const verified = await this.verify(snapshot);
      return { snapshot, verified };
    } finally { await rm(extract, { recursive: true, force: true }); }
  }

  async receive(request) {
    const type = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!['application/gzip', 'application/x-gzip', 'application/octet-stream'].includes(type)) throw failure('请上传 .tar.gz 格式的官方存档。', 415);
    const declared = Number(request.headers['content-length']);
    if (Number.isFinite(declared) && declared > this.limits.maxCompressedBytes) throw failure('存档压缩包超过大小限制。', 413);
    await this.cleanup();
    const id = randomUUID();
    const directory = path.join(this.root, id);
    const archive = path.join(directory, 'upload.tar.gz');
    await mkdir(directory, { mode: 0o700 });
    let handle;
    try {
      handle = await open(archive, 'wx', 0o600);
      let bytes = 0;
      let magic = Buffer.alloc(0);
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > this.limits.maxCompressedBytes) throw failure('存档压缩包超过大小限制。', 413);
        if (magic.length < 2) magic = Buffer.concat([magic, chunk]).subarray(0, 2);
        let offset = 0;
        while (offset < chunk.length) offset += (await handle.write(chunk, offset, chunk.length - offset, null)).bytesWritten;
      }
      if (magic.length < 2 || magic[0] !== 0x1f || magic[1] !== 0x8b) throw failure('上传文件不是 gzip 压缩包。', 400);
      await handle.sync();
      await handle.close();
      handle = null;
      const detected = await this.scan(archive);
      const extracted = await this.extract(archive, detected, directory);
      const inspected = await this.native.inspect(extracted.snapshot, { requirePlayers: false });
      if (extracted.verified.count !== detected.copy.length) throw failure('压缩包文件数量不一致，请重新打包。', 400);
      const meta = {
        id,
        createdAt: new Date().toISOString(),
        layout: detected.layout,
        worldId: detected.worldId,
        compressedBytes: bytes,
        uncompressedBytes: inspected.bytes,
        entries: detected.entries.length,
        files: inspected.files.map(file => ({ name: file.name, bytes: file.bytes }))
      };
      await jsonWrite(path.join(directory, 'meta.json'), meta);
      await rm(archive, { force: true });
      return meta;
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }
}
