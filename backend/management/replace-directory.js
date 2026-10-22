import path from 'node:path';
import fs from 'node:fs/promises';
import { failure } from './files.js';

/** Prepare the entire replacement before moving the old directory out of the way. */
export async function replaceDirectory(source, target, { afterReplace = async () => {}, onCleanupError = () => {} } = {}) {
  const stage = await fs.mkdtemp(path.join(path.dirname(target), '.import-'));
  const replacement = path.join(stage, 'replacement');
  const previous = path.join(stage, 'previous');
  let preserve = false;
  try {
    await fs.cp(source, replacement, { recursive: true, force: false, errorOnExist: true });
    let moved = false;
    try { await fs.rename(target, previous); moved = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    let installed = false;
    try {
      await fs.rename(replacement, target);
      installed = true;
      // Keep the original directory until all dependent writes have committed.
      await afterReplace();
    }
    catch (error) {
      try {
        if (installed) await fs.rename(target, replacement);
        if (moved) await fs.rename(previous, target);
      } catch {
        preserve = true;
        const rollback = failure(`${error.message}；目录回滚失败，原数据已保留在 ${previous}，请检查服务器。`, 500);
        rollback.rollbackFailed = true;
        throw rollback;
      }
      throw error;
    }
  } finally {
    // A cleanup failure after commit must not turn a successful replacement
    // into a failed task whose data has already changed.
    if (!preserve) await fs.rm(stage, { recursive: true, force: true }).catch(onCleanupError);
  }
}
