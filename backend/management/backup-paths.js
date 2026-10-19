import path from 'node:path';
import { lstat, mkdir } from 'node:fs/promises';
import { failure } from './files.js';

export const BACKUP_CATEGORIES = Object.freeze(['manual', 'scheduled', 'before-update']);

// The configured data directory is trusted. Reject links beneath it before any
// backup operation; filesystem permissions still need to exclude hostile local writers.
export async function backupDirectory(directory, category, { create = false } = {}) {
  if (category !== undefined && !BACKUP_CATEGORIES.includes(category)) throw failure('备份路径无效。');
  let current = directory;
  for (const part of ['backups', ...(category === undefined ? [] : [category])]) {
    current = path.join(current, part);
    if (create) await mkdir(current, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    if (!(await lstat(current)).isDirectory()) throw failure('备份目录不能包含链接或特殊文件。');
  }
  return current;
}
