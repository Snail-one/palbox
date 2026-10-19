import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, readdir, readFile, open, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { failure } from './files.js';
import { backupDirectory } from './backup-paths.js';

const run = promisify(execFile);
export const worldName = /^[A-Za-z0-9_-]{1,128}$(?![\s\S])/;
const snapshotName = /^\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}$(?![\s\S])/;
export const saveName = /^[A-Za-z0-9_-]{1,128}\.sav$(?![\s\S])/;
const signature = info => `${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
const changing = () => failure('官方备份正在写入或已被轮换，请刷新后重试。', 409);

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

  async configuredWorld() {
    let settings = '';
    try { settings = await readFile(path.join(this.saved, 'Config/LinuxServer/GameUserSettings.ini'), 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const configured = settings.match(/^\s*DedicatedServerName\s*=\s*"?([A-Za-z0-9_-]+)"?\s*$/m)?.[1];
    return configured && worldName.test(configured) ? configured : null;
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
    const activeWorld = await this.activeWorld();
    const backups = [];
    for (const worldId of await this.worlds()) {
      let root;
      try { root = await this.safeDirectory(['SaveGames', '0', worldId, 'backup', 'world']); }
      catch (error) { if (error.code === 'ENOENT' || error.status === 400) continue; throw error; }
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !snapshotName.test(entry.name)) continue;
        try {
          const backup = await this.get(`${worldId}/${entry.name}`);
          backups.push({ id: backup.id, worldId, timestamp: entry.name, bytes: backup.bytes, canRestore: worldId === activeWorld });
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

  async export(id) {
    const stage = await mkdtemp(path.join(await backupDirectory(this.directory), '.official-export-'));
    const cleanup = () => rm(stage, { recursive: true, force: true });
    try {
      const source = path.join(stage, 'save');
      const backup = await this.copy(id, source);
      const file = path.join(stage, 'backup.tar.gz');
      await run('tar', ['-czf', file, '-C', source, '--', ...await readdir(source)]);
      return { file, filename: `official-${backup.worldId}-${backup.timestamp}.tar.gz`, cleanup };
    } catch (error) { await cleanup(); throw error; }
  }

  async replaceWorld(worldId, source, { beforeSwap } = {}) {
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
    } finally { if (!preserve) await rm(stage, { recursive: true, force: true }); }
  }

  async restore(id, beforeReplace) {
    const backup = await this.get(id);
    if (backup.worldId !== await this.activeWorld()) throw failure('无法确认该备份属于当前世界，拒绝恢复。', 409);
    const stage = await mkdtemp(path.join(await backupDirectory(this.directory), '.official-restore-'));
    try {
      const source = path.join(stage, 'save');
      await this.copy(id, source);
      await this.replaceWorld(backup.worldId, source, { beforeSwap: async () => {
        await beforeReplace();
        if (backup.worldId !== await this.activeWorld()) throw failure('当前世界已改变，请刷新后重试。', 409);
      } });
    } finally { await rm(stage, { recursive: true, force: true }); }
  }
}
