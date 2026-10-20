import path from 'node:path';
import fs from 'node:fs/promises';
import { failure } from './files.js';

/** Prepare the entire replacement before moving the old directory out of the way. */
export async function replaceDirectory(source, target) {
  const stage = await fs.mkdtemp(path.join(path.dirname(target), '.import-'));
  const replacement = path.join(stage, 'replacement');
  const previous = path.join(stage, 'previous');
  let preserve = false;
  try {
    await fs.cp(source, replacement, { recursive: true, force: false, errorOnExist: true });
    let moved = false;
    try { await fs.rename(target, previous); moved = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await fs.rename(replacement, target); }
    catch (error) {
      if (moved) {
        try { await fs.rename(previous, target); }
        catch {
          preserve = true;
          const rollback = failure(`导入回滚失败，原数据已保留在 ${previous}，请检查服务器。`, 500);
          rollback.rollbackFailed = true;
          throw rollback;
        }
      }
      throw error;
    }
  } finally { if (!preserve) await fs.rm(stage, { recursive: true, force: true }); }
}
