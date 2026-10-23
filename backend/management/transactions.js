import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { atomicWrite, failure } from './files.js';
import paths from '../../shared/data-paths.cjs';
import { BACKUP_CATEGORIES } from './backup-paths.js';

async function ensureDirectory(directory) {
  await fs.mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await fs.lstat(directory);
  if (!info.isDirectory()) throw failure('事务暂存目录不能包含链接或特殊文件。');
  return info;
}

const transactions = new Map();
const queues = new Map();
const journalDirectory = directory => path.join(directory, 'palbox/transaction-journal');
const journalTemporary = /^[0-9a-f-]{36}\.json\.[0-9a-f-]{36}\.tmp$/;

// Serialize bookkeeping and parent removal so concurrent exports cannot race
// with rmdir while creating a new transaction under the same root.
function exclusive(directory, operation) {
  const previous = queues.get(directory) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  queues.set(directory, next);
  return next.finally(() => { if (queues.get(directory) === next) queues.delete(directory); });
}

async function removeEmpty(directory) {
  await fs.rmdir(directory).catch(error => {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
  });
}

async function writeRecord(record) {
  await ensureDirectory(journalDirectory(record.directory));
  const { stage, state, recoverable } = record;
  await atomicWrite(record.file, JSON.stringify({ version: 1, stage, state, recoverable }) + '\n');
}

async function removeRecord(record) {
  await fs.rm(record.stage, { recursive: true, force: true });
  await removeEmpty(path.dirname(record.stage));
  await fs.unlink(record.file).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await removeEmpty(journalDirectory(record.directory));
}

async function finishRecord(record, onCleanupError) {
  try {
    await writeRecord(record);
    await safeStage(record.directory, record.stage);
    if (record.state === 'cleanup') await removeRecord(record);
  } catch (error) {
    onCleanupError(new Error(`${error.message}；暂存目录：${record.stage}`, { cause: error }));
  }
}

/** Prefer the shared data directory; atomic swaps must stay on the target device. */
export async function createTransaction(directory, targetParent, prefix, { recoverable = true } = {}) {
  directory = path.resolve(directory);
  return exclusive(directory, async () => {
    await ensureDirectory(path.join(directory, 'palbox'));
    const preferred = paths.dataPaths(directory).transactions;
    let stage;
    let file;
    let root = preferred;
    try {
      const preferredInfo = await ensureDirectory(preferred);
      const targetInfo = await fs.lstat(targetParent);
      if (!targetInfo.isDirectory()) throw failure('目标存档目录不能包含链接或特殊文件。');
      if (preferredInfo.dev !== targetInfo.dev) {
        root = path.join(targetParent, '.palbox-transactions');
        await ensureDirectory(root);
      }
      await ensureDirectory(journalDirectory(directory));
      stage = await fs.mkdtemp(path.join(root, prefix));
      file = path.join(journalDirectory(directory), `${randomUUID()}.json`);
      const record = { directory, stage, file, state: 'active', recoverable };
      // Persist before callers can move original data into the transaction.
      await writeRecord(record);
      transactions.set(stage, record);
      return stage;
    } catch (error) {
      if (stage) await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
      if (file) await fs.unlink(file).catch(() => {});
      await removeEmpty(root).catch(() => {});
      await removeEmpty(journalDirectory(directory)).catch(() => {});
      throw error;
    } finally {
      // A parent cleanup failure must not hide a newly registered transaction.
      // Startup cleanup can remove any empty preferred root left behind.
      if (root !== preferred) await removeEmpty(preferred).catch(() => {});
    }
  });
}

/** Only committed or successfully rolled-back transactions are disposable. */
export async function finishTransaction(stage, { preserve = false, onCleanupError = () => {} } = {}) {
  const record = transactions.get(stage);
  if (!record) {
    // Support replaceDirectory's standalone staging directory as well.
    if (!preserve) await fs.rm(stage, { recursive: true, force: true }).catch(onCleanupError);
    return;
  }
  return exclusive(record.directory, async () => {
    try {
      record.state = preserve ? 'recovery' : 'cleanup';
      await finishRecord(record, onCleanupError);
    } finally {
      transactions.delete(stage);
    }
  });
}

// Never follow a replaced parent link while processing a persisted path.
async function safeStage(directory, stage) {
  const relative = path.relative(directory, stage);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw failure('事务清理路径不在数据目录内。');
  const root = path.dirname(stage);
  const temporaryFile = root === journalDirectory(directory) && journalTemporary.test(path.basename(stage));
  const journalRoot = root === journalDirectory(directory) && (/^\.empty-root-[0-9a-f-]{36}$/.test(path.basename(stage)) || temporaryFile);
  if (root !== paths.dataPaths(directory).transactions && path.basename(root) !== '.palbox-transactions' && !journalRoot) throw failure('事务清理路径无效。');
  let current = directory;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    try {
      const info = await fs.lstat(current);
      if (!(temporaryFile && current === stage ? info.isFile() : info.isDirectory())) throw failure('事务清理目录不能包含链接或特殊文件。');
    } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  }
}

/** Check leftovers once; interrupted writes retain their only recovery copy. */
export async function cleanupTransactions(directory, { startup = false, onCleanupError = () => {} } = {}) {
  directory = path.resolve(directory);
  return exclusive(directory, async () => {
    const journal = journalDirectory(directory);
    const known = new Set(transactions.keys());
    const handledRoots = new Set();
    let entries = [];
    let journalSafe = false;
    try {
      const info = await fs.lstat(journal);
      if (!info.isDirectory()) throw failure('事务清理记录目录不能包含链接或特殊文件。');
      entries = await fs.readdir(journal, { withFileTypes: true });
      journalSafe = true;
    } catch (error) { if (error.code !== 'ENOENT') onCleanupError(error); }
    for (const entry of entries) {
      if (!entry.isFile() || !/^[0-9a-f-]{36}\.json$/.test(entry.name)) continue;
      try {
        const file = path.join(journal, entry.name);
        const saved = JSON.parse(await fs.readFile(file, 'utf8'));
        if (saved.version !== 1 || typeof saved.stage !== 'string' || !['active', 'cleanup', 'recovery', 'exhausted'].includes(saved.state) || typeof saved.recoverable !== 'boolean') throw failure(`事务清理记录无效：${file}`);
        known.add(saved.stage);
        if (transactions.has(saved.stage)) continue;
        const record = { ...saved, directory, file };
        await safeStage(directory, record.stage);
        // Old retry-limit records are ordinary leftovers under this policy.
        if (record.state === 'exhausted') record.state = 'cleanup';
        try { await fs.lstat(record.stage); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          record.state = 'cleanup';
        }
        if (record.state === 'active') {
          if (!startup) continue;
          record.state = record.recoverable ? 'recovery' : 'cleanup';
        }
        handledRoots.add(path.dirname(record.stage));
        handledRoots.add(journal);
        await finishRecord(record, onCleanupError);
        if (record.state === 'recovery' && startup) onCleanupError(new Error(`中断或回滚失败的事务副本已保留，请检查后恢复：${record.stage}`));
      } catch (error) { onCleanupError(error); }
    }
    for (const entry of entries) {
      const stage = path.join(journal, entry.name);
      if (!entry.isFile() || !journalTemporary.test(entry.name) || known.has(stage)) continue;
      handledRoots.add(journal);
      try { await fs.rm(stage, { force: true }); await removeEmpty(journal); }
      catch (error) { onCleanupError(error); }
    }
    // Also remove empty roots left by older versions, without traversing worlds
    // or touching unmarked recovery data.
    const parents = [directory, path.join(directory, 'palbox'), path.join(directory, 'server/Pal/Saved/SaveGames/0'), path.join(directory, 'server/Pal/Saved/Config/LinuxServer'), ...BACKUP_CATEGORIES.map(category => path.join(directory, 'backups', category))];
    for (const root of [paths.dataPaths(directory).transactions, ...parents.map(parent => path.join(parent, '.palbox-transactions'))]) {
      try {
        await safeStage(directory, path.join(root, 'check'));
        if (startup) {
          const stages = await fs.readdir(root, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
          for (const entry of stages) {
            const stage = path.join(root, entry.name);
            if (!entry.isDirectory() || known.has(stage) || !/^(?:\.apply-|\.configuration-|\.official-(?:restore|export)-|\.steamcmd-|reset-|import-|world-restore-|steamcmd-swap-|backup-|restore-)/.test(entry.name)) continue;
            const disposable = /^(?:\.official-export-|\.steamcmd-|backup-|restore-)/.test(entry.name) || !(await fs.readdir(stage)).length;
            await ensureDirectory(journal);
            const record = { directory, stage, file: path.join(journal, `${randomUUID()}.json`), recoverable: !disposable, state: disposable ? 'cleanup' : 'recovery' };
            known.add(stage);
            handledRoots.add(root);
            handledRoots.add(journal);
            await finishRecord(record, onCleanupError);
            if (!disposable) onCleanupError(new Error(`旧版本遗留的事务副本已保留，请检查后恢复：${stage}`));
          }
        }
        if (!handledRoots.has(root)) await removeEmpty(root);
      }
      catch (error) { onCleanupError(error); }
    }
    if (journalSafe && !handledRoots.has(journal)) await removeEmpty(journal).catch(onCleanupError);
  });
}
