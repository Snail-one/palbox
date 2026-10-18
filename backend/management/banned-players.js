import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { failure } from './files.js';

const MAX_BYTES = 1024 * 1024;
const userIdPattern = /^[a-zA-Z][a-zA-Z0-9-]*_[a-zA-Z0-9:._-]+$/;

function normalizeUserId(value) {
  if (typeof value !== 'string') return null;
  // Newer builds may write "steam_<SteamID64>,<PlayerUID>"; the platform user
  // ID before the comma is what the REST ban/unban endpoints accept.
  const text = value.trim().split(',', 1)[0].trim();
  const id = /^\d{17}$/.test(text) ? `steam_${text}` : text;
  if (id.length > 200 || !userIdPattern.test(id)) return null;
  return id;
}

export function parseBanList(text) {
  const ids = new Set();
  let skipped = 0;
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith('#') || value.startsWith('//') || value.startsWith(';')) continue;
    const id = normalizeUserId(value);
    if (!id) { skipped++; continue; }
    ids.add(id);
  }
  return { players: [...ids].map(userId => ({ userId })), skipped };
}

/** Newer game versions store the local ban list as a JSON array of user IDs. */
export function parseBanListJson(text) {
  const source = text.replace(/^\uFEFF/, '');
  if (!source.trim()) return { players: [], skipped: 0 };
  let value;
  try { value = JSON.parse(source); }
  catch { throw failure('封禁名单 JSON 格式无效。', 400); }
  if (!Array.isArray(value)) throw failure('封禁名单 JSON 格式无效。', 400);
  const ids = new Set();
  let skipped = 0;
  for (const entry of value) {
    const id = normalizeUserId(entry);
    if (!id) { skipped++; continue; }
    ids.add(id);
  }
  return { players: [...ids].map(userId => ({ userId })), skipped };
}

async function readBounded(saved, relative) {
  let handle;
  try {
    const root = await realpath(saved);
    const file = await realpath(path.join(root, relative));
    if (!file.startsWith(root + path.sep)) throw failure('封禁名单路径超出存档目录。', 403);
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile()) throw failure('封禁名单不是有效文件。');
    if (info.size > MAX_BYTES) throw failure('封禁名单超过 1 MB，无法读取。', 413);
    return { text: await handle.readFile('utf8'), updatedAt: info.mtime.toISOString() };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  } finally { await handle?.close(); }
}

/**
 * Prefer the current JSON ban list; fall back to the legacy text file used by
 * older server builds. `updatedAt` lets the caller decide whether a recent
 * panel ban/unban is newer than the on-disk snapshot.
 */
export async function readBanList(saved) {
  const current = await readBounded(saved, 'SaveGames/Config/banlist.json');
  if (current) return { ...parseBanListJson(current.text), updatedAt: current.updatedAt };
  const legacy = await readBounded(saved, 'SaveGames/banlist.txt');
  if (legacy) return { ...parseBanList(legacy.text), updatedAt: legacy.updatedAt };
  return { players: [], skipped: 0, updatedAt: null };
}
