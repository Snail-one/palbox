import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, unlink } from 'node:fs/promises';
import { jsonWrite, readJson } from './files.js';
import { configuredWorldId, worldName } from './native-backups.js';

const run = promisify(execFile);
const fingerprint = info => `${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;

export async function recordBackupWorld(file, worldId, info = null) {
  try {
    info ??= await lstat(file);
    await jsonWrite(file + '.json', { version: 1, fingerprint: fingerprint(info), worldId });
  } catch { /* Optional metadata must not make an otherwise valid backup fail. */ }
}

export async function readBackupWorld(file, info) {
  try {
    const cached = await readJson(file + '.json', null);
    if (cached?.version === 1 && cached.fingerprint === fingerprint(info)
      && (cached.worldId === null || (typeof cached.worldId === 'string' && worldName.test(cached.worldId)))) return cached.worldId;
  } catch { /* Missing or invalid metadata is rebuilt from this archive. */ }
  let worldId = null;
  const options = { timeout: 120000, maxBuffer: 64 * 1024 };
  try {
    const { stdout } = await run('tar', ['-xOzf', file, '--', 'Pal/Saved/Config/LinuxServer/GameUserSettings.ini'], options);
    worldId = configuredWorldId(stdout);
  } catch { /* Older world-only archives have no GameUserSettings.ini. */ }
  if (!worldId) {
    try {
      const { stdout } = await run('tar', ['-tzf', file], { ...options, maxBuffer: 8 * 1024 * 1024 });
      const worlds = new Set(stdout.split('\n').map(name => /^Pal\/Saved\/SaveGames\/0\/([A-Za-z0-9_-]{1,128})\/Level\.sav$/.exec(name)?.[1]).filter(Boolean));
      if (worlds.size === 1) worldId = [...worlds][0];
    } catch { /* Keep unreadable archives listed, with an unknown world ID. */ }
  }
  await recordBackupWorld(file, worldId, info);
  return worldId;
}

export async function removeBackupMetadata(file) {
  await unlink(file + '.json').catch(() => {});
}
