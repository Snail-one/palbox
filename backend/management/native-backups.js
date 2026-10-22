import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, readdir, readFile, open, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { failure } from './files.js';
import { backupDirectory } from './backup-paths.js';
import { createBackupDownloadFilename } from './backup-downloads.js';

const run = promisify(execFile);
export const worldName = /^[A-Za-z0-9_-]{1,128}$(?![\s\S])/;
const snapshotName = /^\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}$(?![\s\S])/;
export const saveName = /^[A-Za-z0-9_-]{1,128}\.sav$(?![\s\S])/;
const signature = info => `${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
const changing = () => failure('官方备份正在写入或已被轮换，请刷新后重试。', 409);
const snapshotDate = timestamp => new Date(`${timestamp.slice(0, 10).replaceAll('.', '-')}T${timestamp.slice(11).replaceAll('.', ':')}Z`);

export function configuredWorldId(settings) {
  const configured = settings.match(/^\s*DedicatedServerName\s*=\s*"?([A-Za-z0-9_-]+)"?\s*$/m)?.[1];
  return configured && worldName.test(configured) ? configured : null;
}

/** Read the game's backup/world snapshots; never schedule or create game backups. */
export class NativeBackups {
  constructor(saved, directory) { this.saved = saved; this.directory = directory; }

  async safeDirectory(parts) {
    let current = this.saved;
    for (const part of ['', ...parts]) {
      current = path.join(current, part);
      if (!(await lstat(current)).isDirectory()) throw failure('存档目录不能包含链接或特殊文件。');
    }
    return current;
  }

  async worlds() {
    let root;
    try { root = await this.safeDirectory(['SaveGames', '0']); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory() && worldName.test(entry.name)).map(entry => entry.name);
  }

  async clearWorld(worldId, assertStopped) {
    if (!worldName.test(worldId || '')) throw failure('世界 ID 无效。');
    await assertStopped();
    let root;
    try { root = await this.safeDirectory(['SaveGames', '0', worldId]); }
    catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
    const entries = await readdir(root);
    for (const name of entries) {
      await assertStopped();
      // Remove links themselves; never follow them outside the save directory.
      await rm(path.join(root, name), { recursive: true, force: true });
    }
    return entries.length;
  }

  async configuredWorld() {
    let settings = '';
    try { settings = await readFile(path.join(this.saved, 'Config/LinuxServer/GameUserSettings.ini'), 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return configuredWorldId(settings);
  }

  async activeWorld() {
    const worlds = await this.worlds();
    const configured = await this.configuredWorld();
    if (configured) return worlds.includes(configured) ? configured : null;
    return worlds.length === 1 ? worlds[0] : null;
  }

  async ensureWorld(worldId) {
    if (!worldName.test(worldId || '')) throw failure('世界 ID 无效。');
    let current = this.saved;
    let created = false;
    for (const part of ['', 'SaveGames', '0', worldId]) {
      current = path.join(current, part);
      try {
        if (!(await lstat(current)).isDirectory()) throw failure('存档目录不能包含链接或特殊文件。');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await mkdir(current, { mode: 0o700 });
        created = true;
      }
    }
    return { directory: current, created };
  }

  async inspect(directory, { requirePlayers = true } = {}) {
    const files = [];
    const entries = [];
    const root = await readdir(directory, { withFileTypes: true });
    for (const entry of root.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      const info = await lstat(file);
      if (entry.name === 'Players' && info.isDirectory()) {
        entries.push(['Players/', signature(info)]);
        for (const player of (await readdir(file)).sort()) {
          const playerInfo = await lstat(path.join(file, player));
          if (!saveName.test(player) || !playerInfo.isFile() || !playerInfo.size) throw failure('官方备份的玩家文件无效。');
          files.push({ name: `Players/${player}`, bytes: playerInfo.size, signature: signature(playerInfo) });
        }
      } else {
        if (!saveName.test(entry.name) || !info.isFile() || !info.size) throw failure('官方备份包含无效文件。');
        files.push({ name: entry.name, bytes: info.size, signature: signature(info) });
      }
    }
    if (!files.some(file => file.name === 'Level.sav') || !files.some(file => file.name === 'LevelMeta.sav') || (requirePlayers && !entries.length)) throw failure('官方备份不完整，缺少世界或玩家存档。');
    return { files, fingerprint: JSON.stringify([...entries, ...files]), bytes: files.reduce((total, file) => total + file.bytes, 0) };
  }

  async get(id) {
    if (typeof id !== 'string') throw failure('官方备份不存在。', 404);
    const [worldId, timestamp, extra] = id.split('/');
    if (!worldName.test(worldId || '') || !snapshotName.test(timestamp || '') || extra !== undefined) throw failure('官方备份路径无效。');
    const directory = await this.safeDirectory(['SaveGames', '0', worldId, 'backup', 'world', timestamp]);
    return { id, worldId, timestamp, directory, ...await this.inspect(directory) };
  }

  async list() {
    const activeWorld = await this.configuredWorld();
    const backups = [];
    for (const worldId of await this.worlds()) {
      let root;
      try { root = await this.safeDirectory(['SaveGames', '0', worldId, 'backup', 'world']); }
      catch (error) { if (error.code === 'ENOENT' || error.status === 400) continue; throw error; }
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !snapshotName.test(entry.name)) continue;
        try {
          const backup = await this.get(`${worldId}/${entry.name}`);
          // Managed game processes run in UTC; keep the original name for snapshot IDs.
          const date = snapshotDate(entry.name);
          if (Number.isNaN(date.getTime())) continue;
          backups.push({ id: backup.id, worldId, timestamp: entry.name, createdAt: date.toISOString(), bytes: backup.bytes, canRestore: worldId === activeWorld });
        } catch (error) {
          // Snapshots can disappear during the game's normal rotation, or still be incomplete.
          if (error.code !== 'ENOENT' && !error.status) throw error;
        }
      }
    }
    backups.sort((a, b) => b.timestamp.localeCompare(a.timestamp) || a.worldId.localeCompare(b.worldId));
    return { activeWorld, backups };
  }

  async copy(id, destination) {
    const before = await this.get(id);
    await mkdir(path.join(destination, 'Players'), { recursive: true, mode: 0o700 });
    try {
      for (const file of before.files) {
        const source = await open(path.join(before.directory, file.name), constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          if (signature(await source.stat()) !== file.signature) throw changing();
          const target = await open(path.join(destination, file.name), 'wx', 0o600);
          try {
            const buffer = Buffer.alloc(1024 * 1024);
            let position = 0;
            while (position < file.bytes) {
              const { bytesRead } = await source.read(buffer, 0, Math.min(buffer.length, file.bytes - position), position);
              if (!bytesRead) throw changing();
              let written = 0;
              while (written < bytesRead) written += (await target.write(buffer, written, bytesRead - written)).bytesWritten;
              position += bytesRead;
            }
            await target.sync();
          } finally { await target.close(); }
          if (signature(await source.stat()) !== file.signature) throw changing();
        } finally { await source.close(); }
      }
      if ((await this.get(id)).fingerprint !== before.fingerprint) throw changing();
    } catch (error) {
      if (['ENOENT', 'ELOOP'].includes(error.code)) throw changing();
      throw error;
    }
    return before;
  }

  async copyLiveConfig(destination) {
    const sourcePath = path.join(this.saved, 'Config/LinuxServer/PalWorldSettings.ini');
    let source;
    try { source = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) {
      if (error.code === 'ENOENT') throw failure('当前游戏配置缺少 PalWorldSettings.ini。', 409);
      if (error.code === 'ELOOP') throw failure('当前游戏配置包含链接，拒绝下载。', 409);
      throw error;
    }
    try {
      const before = await source.stat();
      if (!before.isFile() || !before.size) throw failure('当前游戏配置 PalWorldSettings.ini 无效。', 409);
      await mkdir(destination, { recursive: true, mode: 0o700 });
      const target = await open(path.join(destination, 'PalWorldSettings.ini'), 'wx', 0o600);
      try {
        const buffer = Buffer.alloc(1024 * 1024);
        let position = 0;
        while (position < before.size) {
          const { bytesRead } = await source.read(buffer, 0, Math.min(buffer.length, before.size - position), position);
          if (!bytesRead) throw failure('当前游戏配置正在变化，请重试。', 409);
          let written = 0;
          while (written < bytesRead) written += (await target.write(buffer, written, bytesRead - written)).bytesWritten;
          position += bytesRead;
        }
        await target.sync();
        if (signature(await source.stat()) !== signature(before)) throw failure('当前游戏配置正在变化，请重试。', 409);
      } finally { await target.close(); }
    } finally { await source.close(); }
  }

  async export(id, { timeZone = 'UTC' } = {}) {
    const downloadFilename = createBackupDownloadFilename(timeZone);
    const stage = await mkdtemp(path.join(await backupDirectory(this.directory), '.official-export-'));
    const cleanup = () => rm(stage, { recursive: true, force: true });
    try {
      const snapshot = path.join(stage, 'snapshot');
      const backup = await this.copy(id, snapshot);
      const packed = path.join(stage, 'packed');
      await mkdir(packed, { mode: 0o700 });
      await rename(snapshot, path.join(packed, backup.worldId));
      await this.copyLiveConfig(path.join(packed, 'Config/LinuxServer'));
      const file = path.join(stage, 'backup.tar.gz');
      await run('tar', ['-czf', file, '-C', packed, '--', ...await readdir(packed)]);
      return { file, filename: downloadFilename(snapshotDate(backup.timestamp), 'pal', backup.worldId), cleanup };
    } catch (error) { await cleanup(); throw error; }
  }

  async replaceWorld(worldId, source, { beforeSwap, onCleanupError = () => {} } = {}) {
    if (!worldName.test(worldId || '')) throw failure('世界 ID 无效。');
    await this.inspect(source, { requirePlayers: false });
    const names = await readdir(source);
    let world = null;
    try { world = await this.safeDirectory(['SaveGames', '0', worldId]); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (world) {
      for (const name of names) {
        try {
          const info = await lstat(path.join(world, name));
          if (name === 'Players' ? !info.isDirectory() : !info.isFile()) throw failure('当前世界包含链接或无效存档，拒绝恢复。');
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
    await beforeSwap?.();
    world = await this.safeDirectory(['SaveGames', '0', worldId]);
    const stage = await mkdtemp(path.join(await backupDirectory(this.directory), '.official-restore-'));
    const moved = [];
    let preserve = false;
    try {
      await mkdir(path.join(stage, 'previous'));
      try {
        for (const name of names) {
          const previous = path.join(stage, 'previous', name);
          const target = path.join(world, name);
          let existed = false;
          try { await rename(target, previous); existed = true; }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          const entry = { target, previous, existed, installed: false };
          moved.push(entry);
          await rename(path.join(source, name), target);
          entry.installed = true;
        }
      } catch (error) {
        try {
          for (const entry of moved.reverse()) {
            if (entry.installed) await rm(entry.target, { recursive: true, force: true });
            if (entry.existed) await rename(entry.previous, entry.target);
          }
        } catch {
          preserve = true;
          const rollback = failure(`恢复回滚失败，原文件已保留在 ${stage}/previous，请检查服务器。`, 500);
          rollback.rollbackFailed = true;
          throw rollback;
        }
        throw error;
      }
    } finally { if (!preserve) await rm(stage, { recursive: true, force: true }).catch(onCleanupError); }
  }

  async restore(id, beforeReplace, { onCleanupError = () => {} } = {}) {
    const backup = await this.get(id);
    if (backup.worldId !== await this.configuredWorld()) throw failure('无法确认该备份属于 GameUserSettings.ini 指定的当前世界，拒绝恢复。', 409);
    const stage = await mkdtemp(path.join(await backupDirectory(this.directory), '.official-restore-'));
    try {
      const source = path.join(stage, 'save');
      await this.copy(id, source);
      await this.replaceWorld(backup.worldId, source, { onCleanupError, beforeSwap: async () => {
        await beforeReplace();
        if (backup.worldId !== await this.configuredWorld()) throw failure('当前世界已改变，请刷新后重试。', 409);
      } });
    } finally { await rm(stage, { recursive: true, force: true }).catch(onCleanupError); }
  }
}
