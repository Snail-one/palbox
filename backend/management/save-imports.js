import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, lstat, rename, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { failure, jsonWrite, readJson } from './files.js';
import { NativeBackups } from './native-backups.js';
import { parse } from '../../shared/domain/config.js';

const run = promisify(execFile);
const importId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$(?![\s\S])/;
const listing = /^([-d])[-rwxsStT]{9}[.+@]?\s+\d+\/\d+\s+(\d+)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s+(.+)$/;

export const DEFAULT_IMPORT_LIMITS = Object.freeze({
  maxCompressedBytes: 1024 ** 3,
  maxUncompressedBytes: 4 * 1024 ** 3,
  maxEntries: 20000,
  maxListingLine: 8192,
  maxListingBytes: 64 * 1024 * 1024,
  tarTimeoutMs: 120000,
  uploadTimeoutMs: 120000,
  maxStagedImports: 5,
  maxStagedBytes: 8 * 1024 ** 3,
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
    if (!['file', 'directory'].includes(entry?.type)) throw failure('压缩包包含链接或不支持的文件类型。');
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
      : /^Pal\/Saved\/SaveGames\/0\/([A-Za-z0-9_-]{1,128})$/.test(root) ? 'pal-saved'
      : /^[A-Za-z0-9_-]{1,128}$/.test(root) ? 'world' : null;
    if (!layout) continue;
    const worldId = layout === 'root' ? null : root.split('/').at(-1);
    candidates.push({ root, layout, worldId });
  }
  // A full Saved archive contains server configuration. One world directory
  // placed beside Config/ is an official download and still imports as a world.
  const besideConfig = candidates.length === 1 && candidates[0].layout === 'world';
  if (!besideConfig) {
    for (const root of ['Pal/Saved', 'Saved', '']) {
      const prefix = root ? `${root}/` : '';
      if (files.has(`${prefix}Level.sav`) && files.has(`${prefix}LevelMeta.sav`)) continue;
      if (!normalized.some(entry => entry.name === `${prefix}Config` || entry.name.startsWith(`${prefix}Config/`))) continue;
      if (!files.get(`${prefix}Config/LinuxServer/PalWorldSettings.ini`)?.size) throw failure('完整备份缺少有效的 PalWorldSettings.ini。');
      return { kind: 'full', root, layout: 'full', worldId: null, copy: [...files.keys()].filter(name => name.startsWith(prefix)).map(name => name.slice(prefix.length)) };
    }
  }
  if (!candidates.length) throw failure('压缩包中没有可导入的世界存档（需要 Level.sav 和 LevelMeta.sav）。');
  if (candidates.length > 1) throw failure('压缩包包含多个世界存档，请只保留一个世界后重新压缩。');
  const [{ root, layout, worldId }] = candidates;
  const prefix = root ? `${root}/` : '';
  const level = files.get(`${prefix}Level.sav`);
  const meta = files.get(`${prefix}LevelMeta.sav`);
  if (!level.size || !meta.size) throw failure('世界存档文件为空，无法导入。');
  const copy = [...files.keys()].filter(name => name.startsWith(prefix)).map(name => name.slice(prefix.length));
  if (!copy.includes('Level.sav') || !copy.includes('LevelMeta.sav')) throw failure('世界存档不完整。');
  return { kind: 'world', root, layout, worldId, copy };
}

function tarEnvironment() {
  const env = { ...process.env, LC_ALL: 'C', LANG: 'C', TZ: 'UTC' };
  delete env.TAR_OPTIONS;
  delete env.POSIXLY_CORRECT;
  return env;
}

function sevenZipEnvironment() {
  return { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8', TZ: 'UTC' };
}

// 7-Zip reads /dev/tty for a password when headers are encrypted. A fixed
// non-empty password makes that fail immediately instead of blocking the panel.
const SEVEN_ZIP_PASSWORD = '-ppalbox-import-rejects-encrypted-archives';

function encryptedArchive(stderr) {
  return /encrypted|wrong password/i.test(String(stderr || ''));
}

const ARCHIVE_TYPES = new Map([
  ['application/gzip', 'gzip'],
  ['application/x-gzip', 'gzip'],
  ['application/zip', 'zip'],
  ['application/x-zip-compressed', 'zip'],
  ['application/x-7z-compressed', '7z'],
  ['application/octet-stream', null]
]);

export function detectArchive(magic) {
  if (magic.length >= 6 && magic[0] === 0x37 && magic[1] === 0x7a && magic[2] === 0xbc && magic[3] === 0xaf && magic[4] === 0x27 && magic[5] === 0x1c) return '7z';
  if (magic.length >= 4 && magic[0] === 0x50 && magic[1] === 0x4b && [0x03, 0x05, 0x07].includes(magic[2]) && [0x04, 0x06, 0x08].includes(magic[3])) return 'zip';
  if (magic.length >= 2 && magic[0] === 0x1f && magic[1] === 0x8b) return 'gzip';
  return null;
}

let sevenZipCommand;
async function sevenZipBinary() {
  if (sevenZipCommand) return sevenZipCommand;
  for (const name of ['7zz', '7z']) {
    try {
      await run(name, ['i'], { timeout: 10000, stdio: 'ignore' });
      sevenZipCommand = name;
      return name;
    } catch (error) {
      if (error.code !== 'ENOENT') throw failure('无法运行 7zip。', 500);
    }
  }
  throw failure('服务器未安装 7zip，无法导入 .zip 或 .7z。请安装 7zip 后重试。', 500);
}

function classifySevenZipEntry(fields) {
  if (fields.get('Encrypted') === '+') throw failure('压缩包包含加密文件，无法导入。', 400);
  const attributes = fields.get('Attributes') || '';
  if (/(^|\s)l[-rwxsStT]{9}(?:\s|$)/.test(attributes)) return 'link';
  if (fields.get('Folder') === '+' || /(^|\s)d[-rwxsStT]{9}(?:\s|$)/.test(attributes)) return 'directory';
  return 'file';
}

export class SaveImports {
  constructor({ directory, runtime, native, limits = {} }) {
    this.directory = path.resolve(directory);
    this.runtime = runtime;
    this.native = native;
    this.limits = { ...DEFAULT_IMPORT_LIMITS, ...limits };
    this.root = path.join(this.directory, 'palbox/imports');
    this.receiving = new Set();
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
      if (this.receiving.has(entry.name)) continue;
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
    const inspected = await this.inspectSnapshot(snapshot, meta.kind || 'world');
    if (JSON.stringify(inspected.files) !== JSON.stringify(meta.files) || inspected.bytes !== meta.uncompressedBytes
      || (meta.directories && JSON.stringify(inspected.directories) !== JSON.stringify(meta.directories))) throw failure('导入存档已损坏，请重新上传。', 404);
    return { ...meta, kind: meta.kind || 'world', snapshot };
  }

  async remove(id) {
    const { directory } = this.resolve(id);
    await rm(directory, { recursive: true, force: true });
  }

  async usage() {
    let bytes = 0;
    const walk = async directory => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        const info = await lstat(file);
        if (info.isDirectory()) await walk(file);
        else if (info.isFile()) bytes += info.size;
        else throw failure('导入暂存目录包含链接或特殊文件。', 400);
      }
    };
    const entries = await readdir(this.root);
    await walk(this.root);
    return { bytes, count: entries.length };
  }

  async scan(archive, options = {}) {
    const format = options.format || 'gzip';
    if (format === 'gzip') return this.scanGzip(archive, options);
    if (format === 'zip' || format === '7z') return this.scanSeven(archive, options);
    throw failure('不支持的压缩格式。', 400);
  }

  async scanGzip(archive, { signal, maxBytes = this.limits.maxUncompressedBytes } = {}) {
    const entries = [];
    let bytes = 0;
    let expanded = 0;
    let listingBytes = 0;
    let pending = '';
    // Include bounded space for tar headers, padding and extended metadata.
    // Counting the gzip output also covers data that tar ignores after EOF.
    const expandedLimit = maxBytes + this.limits.maxEntries * 1024 + this.limits.maxListingBytes;
    const child = spawn('tar', ['-tvf', '-', '--ignore-zeros', '--numeric-owner', '--quoting-style=escape'], { env: tarEnvironment(), signal });
    child.stderr.resume();
    const completed = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve() : reject(failure('不是有效的 .tar.gz 存档。', 400)));
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), this.limits.tarTimeoutMs);
    const parseLine = line => {
      if (!line) return;
      if (line.length > this.limits.maxListingLine) throw failure('压缩包包含过长的路径。', 400);
      const match = listing.exec(line);
      if (!match) throw failure('压缩包目录格式无法识别。', 400);
      const type = match[1] === 'd' ? 'directory' : 'file';
      const size = Number(match[2]);
      if (!Number.isSafeInteger(size) || size < 0) throw failure('压缩包包含无效文件大小。', 400);
      if (type === 'file') bytes += size;
      if (bytes > maxBytes) throw failure('压缩包解压后超过大小或暂存总量限制。', 413);
      entries.push({ name: match[3], type, size });
      if (entries.length > this.limits.maxEntries) throw failure('压缩包条目数量超过限制。', 413);
    };
    const counter = new Transform({ transform: (chunk, encoding, callback) => {
      expanded += chunk.length;
      callback(expanded > expandedLimit ? failure('压缩包解压后超过大小限制。', 413) : null, chunk);
    } });
    // Attach rejection handlers immediately and wait for every stream/process
    // before returning, so a failed upload cannot leave work running in the background.
    let processingError;
    const stop = error => {
      // Killing tar can report a generic exit before pipeline reports its size
      // limit error. Preserve the more specific rejection after all work settles.
      if (!processingError || error.status === 413) processingError = error;
      child.kill('SIGKILL'); counter.destroy(error);
    };
    const input = pipeline(createReadStream(archive), createGunzip(), counter, child.stdin, { signal }).catch(stop);
    const output = (async () => {
      child.stdout.setEncoding('utf8');
      for await (const chunk of child.stdout) {
        listingBytes += Buffer.byteLength(chunk);
        if (listingBytes > this.limits.maxListingBytes) throw failure('压缩包目录过大，无法安全校验。', 413);
        pending += chunk;
        let end;
        while ((end = pending.indexOf('\n')) !== -1) {
          parseLine(pending.slice(0, end));
          pending = pending.slice(end + 1);
        }
        if (pending.length > this.limits.maxListingLine) throw failure('压缩包包含过长的路径。', 400);
      }
      parseLine(pending);
    })().catch(stop);
    try {
      await Promise.all([input, output, completed]);
      if (processingError) throw processingError;
    } catch (error) {
      stop(error);
      await Promise.allSettled([input, output, completed]);
      if (processingError.status) throw processingError;
      throw failure('不是有效的 .tar.gz 存档。', 400);
    } finally { clearTimeout(timer); }
    return { ...detectSnapshot(entries), entries, uncompressedBytes: bytes };
  }

  async scanSeven(archive, { signal, maxBytes = this.limits.maxUncompressedBytes } = {}) {
    const binary = await sevenZipBinary();
    const child = spawn(binary, ['l', '-slt', '-ba', '-sccUTF-8', SEVEN_ZIP_PASSWORD, archive], { env: sevenZipEnvironment(), signal, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { if (stderr.length < 4096) stderr += chunk.slice(0, 4096 - stderr.length); });
    const entries = [];
    let bytes = 0;
    let listingBytes = 0;
    let pending = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), this.limits.tarTimeoutMs);
    const closed = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
    const parseBlock = block => {
      if (!block.trim()) return;
      const fields = new Map();
      for (const line of block.split('\n')) {
        if (line.length > this.limits.maxListingLine) throw failure('压缩包包含过长的路径。', 400);
        const separator = line.indexOf(' = ');
        if (separator === -1) continue;
        fields.set(line.slice(0, separator), line.slice(separator + 3));
      }
      if (!fields.has('Path')) return;
      const type = classifySevenZipEntry(fields);
      const size = Number(fields.get('Size') || 0);
      if (!Number.isSafeInteger(size) || size < 0) throw failure('压缩包包含无效文件大小。', 400);
      if (type === 'file') bytes += size;
      if (bytes > maxBytes) throw failure('压缩包解压后超过大小或暂存总量限制。', 413);
      entries.push({ name: fields.get('Path'), type, size });
      if (entries.length > this.limits.maxEntries) throw failure('压缩包条目数量超过限制。', 413);
    };
    try {
      child.stdout.setEncoding('utf8');
      for await (const chunk of child.stdout) {
        listingBytes += Buffer.byteLength(chunk);
        if (listingBytes > this.limits.maxListingBytes) throw failure('压缩包目录过大，无法安全校验。', 413);
        pending += chunk.replaceAll('\r', '');
        let end;
        while ((end = pending.indexOf('\n\n')) !== -1) {
          parseBlock(pending.slice(0, end));
          pending = pending.slice(end + 2);
        }
        if (pending.length > this.limits.maxListingBytes) throw failure('压缩包目录过大，无法安全校验。', 413);
      }
      parseBlock(pending);
      const code = await closed;
      if (code !== 0) throw failure(encryptedArchive(stderr) ? '压缩包包含加密文件，无法导入。' : '不是有效的 .zip 或 .7z 存档。', 400);
    } catch (error) {
      child.kill('SIGKILL');
      await closed.catch(() => {});
      if (error.status) throw error;
      throw failure(encryptedArchive(stderr) ? '压缩包包含加密文件，无法导入。' : '不是有效的 .zip 或 .7z 存档。', 400);
    } finally { clearTimeout(timer); }
    return { ...detectSnapshot(entries), entries, uncompressedBytes: bytes };
  }

  async verify(directory) {
    let bytes = 0;
    let count = 0;
    const files = [];
    const directories = [];
    const walk = async current => {
      for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(current, entry.name);
        const info = await lstat(file);
        const name = path.relative(directory, file).split(path.sep).join('/');
        count++;
        if (info.isDirectory()) { directories.push(name); await walk(file); }
        else if (info.isFile()) { bytes += info.size; files.push({ name, bytes: info.size }); }
        else throw failure('导入存档包含链接或特殊文件。', 400);
        if (bytes > this.limits.maxUncompressedBytes || count > this.limits.maxEntries) throw failure('导入存档超过大小限制。', 413);
      }
    };
    await walk(directory);
    return { bytes, count, files, directories };
  }

  async inspectSnapshot(snapshot, kind) {
    const verified = await this.verify(snapshot);
    if (kind === 'full') {
      const config = path.join(snapshot, 'Config/LinuxServer/PalWorldSettings.ini');
      try {
        const source = await readFile(config, 'utf8');
        if (!source.trim()) throw failure('完整备份的 PalWorldSettings.ini 为空。');
        parse(source);
      } catch (error) {
        if (error.code === 'ENOENT') throw failure('完整备份缺少 PalWorldSettings.ini。');
        throw error;
      }
      const archived = new NativeBackups(snapshot, this.directory);
      const worlds = await archived.worlds();
      const worldId = await archived.configuredWorld();
      if (worlds.length) {
        if (!worlds.includes(worldId)) throw failure('完整备份的 GameUserSettings.ini 缺少有效的世界 ID。');
        const level = await lstat(path.join(snapshot, 'SaveGames/0', worldId, 'Level.sav')).catch(error => {
          if (error.code === 'ENOENT') throw failure('完整备份缺少配置指定的世界存档。');
          throw error;
        });
        if (!level.isFile() || !level.size) throw failure('完整备份的世界存档为空或无效。');
      }
      return { ...verified, worldId };
    }
    if (kind !== 'world') throw failure('导入存档类型无效。');
    for (const name of ['Level.sav', 'LevelMeta.sav']) {
      if (!verified.files.some(file => file.name === name && file.bytes > 0)) throw failure('世界存档不完整，需要非空的 Level.sav 和 LevelMeta.sav。');
    }
    return verified;
  }

  async extract(archive, detected, directory, { signal, format = 'gzip' } = {}) {
    const extract = path.join(directory, 'extract');
    const snapshot = path.join(directory, 'snapshot');
    await mkdir(extract, { mode: 0o700 });
    try {
      try {
        if (format === 'gzip') {
          await run('tar', ['-xzf', archive, '--ignore-zeros', '--no-same-owner', '--no-same-permissions', '--no-overwrite-dir', '-C', extract], {
            maxBuffer: 1024 * 1024,
            timeout: this.limits.tarTimeoutMs,
            signal,
            env: tarEnvironment()
          });
        } else {
          await run(await sevenZipBinary(), ['x', `-o${extract}`, '-y', '-bd', '-bso0', SEVEN_ZIP_PASSWORD, archive], {
            maxBuffer: 1024 * 1024,
            timeout: this.limits.tarTimeoutMs,
            signal,
            env: sevenZipEnvironment()
          });
        }
      } catch (error) {
        if (error.status) throw error;
        if (encryptedArchive(error.stderr)) throw failure('压缩包包含加密文件，无法导入。', 400);
        throw failure('无法解压存档压缩包。', 400);
      }
      let source = extract;
      for (const part of detected.root.split('/').filter(Boolean)) {
        source = path.join(source, part);
        const info = await lstat(source).catch(error => { if (error.code === 'ENOENT') throw failure('压缩包中的世界目录不存在。', 400); throw error; });
        if (!info.isDirectory()) throw failure('压缩包中的世界目录无效。', 400);
      }
      await rename(source, snapshot);
      const verified = await this.verify(snapshot);
      return { snapshot, verified };
    } finally { await rm(extract, { recursive: true, force: true }); }
  }

  async receive(request, { authorize = () => {} } = {}) {
    authorize();
    const type = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!ARCHIVE_TYPES.has(type)) throw failure('请上传 .tar.gz、.zip 或 .7z 格式的存档或完整备份。', 415);
    const declared = Number(request.headers['content-length']);
    if (Number.isFinite(declared) && declared > this.limits.maxCompressedBytes) throw failure('存档压缩包超过大小限制。', 413);
    if (this.receiving.size) throw failure('已有存档正在上传，请稍后再试。', 429);
    const id = randomUUID();
    this.receiving.add(id);
    const directory = path.join(this.root, id);
    let archive = path.join(directory, 'upload.bin');
    let handle;
    let timer;
    const controller = new AbortController();
    const expire = () => {
      controller.abort();
      request.destroy();
    };
    try {
      timer = setTimeout(expire, this.limits.uploadTimeoutMs);
      await this.cleanup();
      const usage = await this.usage();
      if (usage.count >= this.limits.maxStagedImports || usage.bytes >= this.limits.maxStagedBytes) throw failure('导入暂存数量或总量已达上限，请导入已有存档或等待过期清理。', 413);
      authorize();
      await mkdir(directory, { mode: 0o700 });
      handle = await open(archive, 'wx', 0o600);
      let bytes = 0;
      let magic = Buffer.alloc(0);
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        authorize();
        bytes += chunk.length;
        if (bytes > this.limits.maxCompressedBytes || usage.bytes + bytes > this.limits.maxStagedBytes) throw failure('存档压缩包超过大小或暂存总量限制。', 413);
        if (magic.length < 6) magic = Buffer.concat([magic, chunk]).subarray(0, 6);
        let offset = 0;
        while (offset < chunk.length) offset += (await handle.write(chunk, offset, chunk.length - offset, null)).bytesWritten;
      }
      clearTimeout(timer);
      // Bound validation and extraction as well as reading a slow request body.
      timer = setTimeout(() => controller.abort(), 2 * this.limits.tarTimeoutMs);
      authorize();
      const format = detectArchive(magic);
      const declaredFormat = ARCHIVE_TYPES.get(type);
      if (!format || (declaredFormat && declaredFormat !== format)) throw failure('请上传 .tar.gz、.zip 或 .7z 格式的存档或完整备份。', 400);
      const stored = path.join(directory, format === 'gzip' ? 'upload.tar.gz' : format === 'zip' ? 'upload.zip' : 'upload.7z');
      await handle.sync();
      await handle.close();
      handle = null;
      await rename(archive, stored);
      archive = stored;
      const detected = await this.scan(archive, { format, signal: controller.signal, maxBytes: Math.min(this.limits.maxUncompressedBytes, this.limits.maxStagedBytes - usage.bytes - bytes) });
      authorize();
      const extracted = await this.extract(archive, detected, directory, { format, signal: controller.signal });
      const inspected = await this.inspectSnapshot(extracted.snapshot, detected.kind);
      if (extracted.verified.files.length !== detected.copy.length) throw failure('压缩包文件数量不一致，请重新打包。', 400);
      const meta = {
        id,
        createdAt: new Date().toISOString(),
        kind: detected.kind,
        layout: detected.layout,
        worldId: detected.kind === 'full' ? inspected.worldId : detected.worldId,
        compressedBytes: bytes,
        uncompressedBytes: inspected.bytes,
        entries: detected.entries.length,
        files: inspected.files,
        directories: inspected.directories
      };
      const metaBytes = Buffer.byteLength(JSON.stringify(meta, null, 2) + '\n');
      if (usage.bytes + bytes + inspected.bytes + metaBytes > this.limits.maxStagedBytes) throw failure('导入暂存总量超过限制。', 413);
      authorize();
      if (controller.signal.aborted) throw failure('存档处理超时，请重试。', 408);
      await jsonWrite(path.join(directory, 'meta.json'), meta, { beforeCommit: authorize });
      await rm(archive, { force: true });
      return meta;
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await rm(directory, { recursive: true, force: true });
      if (controller.signal.aborted) throw failure('存档处理超时，请重试。', 408);
      throw error;
    } finally { clearTimeout(timer); this.receiving.delete(id); }
  }
}
