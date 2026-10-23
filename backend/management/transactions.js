import path from 'node:path';
import { lstat, mkdir, mkdtemp } from 'node:fs/promises';
import { failure } from './files.js';
import paths from '../../shared/data-paths.cjs';

async function ensureDirectory(directory) {
  await mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(directory);
  if (!info.isDirectory()) throw failure('事务暂存目录不能包含链接或特殊文件。');
  return info;
}

/** Prefer the shared data directory; atomic swaps must stay on the target device. */
export async function createTransaction(directory, targetParent, prefix) {
  await ensureDirectory(path.join(directory, 'palbox'));
  const preferred = paths.dataPaths(directory).transactions;
  const preferredInfo = await ensureDirectory(preferred);
  const targetInfo = await lstat(targetParent);
  if (!targetInfo.isDirectory()) throw failure('目标存档目录不能包含链接或特殊文件。');
  let root = preferred;
  if (preferredInfo.dev !== targetInfo.dev) {
    root = path.join(targetParent, '.palbox-transactions');
    await ensureDirectory(root);
  }
  return mkdtemp(path.join(root, prefix));
}
