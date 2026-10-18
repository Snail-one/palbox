import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { failure } from './files.js';

export function parseBanList(text) {
  const ids = new Set();
  let skipped = 0;
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith('#') || value.startsWith('//') || value.startsWith(';')) continue;
    const id = /^\d{17}$/.test(value) ? `steam_${value}` : value;
    if (id.length > 200 || !/^[a-zA-Z][a-zA-Z0-9-]*_[a-zA-Z0-9:._-]+$/.test(id)) { skipped++; continue; }
    ids.add(id);
  }
  return { players: [...ids].map(userId => ({ userId })), skipped };
}

export async function readBanList(saved) {
  let handle;
  try {
    const root = await realpath(saved);
    const file = await realpath(path.join(root, 'SaveGames/banlist.txt'));
    if (!file.startsWith(root + path.sep)) throw failure('封禁名单路径超出存档目录。', 403);
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile()) throw failure('封禁名单不是有效文件。');
    if (info.size > 1024 * 1024) throw failure('封禁名单超过 1 MB，无法读取。', 413);
    return parseBanList(await handle.readFile('utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { players: [], skipped: 0 };
    throw error;
  } finally { await handle?.close(); }
}
