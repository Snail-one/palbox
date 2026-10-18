import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { parse, serialize, encodeString, decodeString } from '../../shared/domain/config.js';
import {
  createProfile, createWorkspace, validateWorkspace,
  GAME_DEFAULT_PROFILE_ID, GAME_DEFAULT_PROFILE_NAME, OFFICIAL_DEFAULT_ORIGIN, DERIVED_DEFAULT_ORIGIN
} from '../../shared/domain/workspace.js';
import { jsonWrite, readJson, failure } from './files.js';

export function managedTemplate(port, source, { password } = {}) {
  const changes = new Map([
    ['RESTAPIEnabled', 'True'], ['AdminPassword', encodeString(password || randomBytes(24).toString('hex'))], ['PublicPort', String(port)]
  ]);
  const parsed = parse(source);
  const keys = new Set(parsed.entries.map(entry => entry.key));
  const missing = [...changes].filter(([key]) => !keys.has(key));
  if (missing.length) source = source.slice(0, parsed.end) + (parsed.entries.length ? ',' : '') + missing.map(([key, raw]) => `${key}=${raw}`).join(',') + source.slice(parsed.end);
  return serialize(parse(source), changes);
}

function sourcePassword(source) {
  if (typeof source !== 'string') return '';
  try { return decodeString(parse(source).entries.find(entry => entry.key === 'AdminPassword')?.raw || '""'); }
  catch { return ''; }
}

export function validateConfigurationWorkspace(value) {
  try { validateWorkspace(value); } catch (error) { throw failure(error.message); }
  // The server-owned default entry is additional to the user limit.
  if (value.profiles.filter(profile => profile.locked !== true).length > 100) throw failure('最多保留 100 套配置。');
  for (const profile of value.profiles) {
    if (profile.source.length > 1024 * 1024 || (profile.initialSource?.length || 0) > 1024 * 1024 || profile.name.length > 100) throw failure('配置内容或名称过长。');
    try {
      parse(profile.source);
      if (profile.initialSource !== undefined) parse(profile.initialSource);
    } catch (error) { throw failure(error.message); }
  }
  return value;
}

export class ManagementStore {
  constructor(directory, gamePort = 8211) {
    this.directory = directory;
    this.file = path.join(directory, 'palbox/workspace.json');
    this.revision = 0;
    this.gamePort = gamePort;
    this.workspace = null;
    this.pendingDefault = null;
    this.writes = Promise.resolve();
  }
  async initialize() {
    const saved = await readJson(this.file, null);
    if (saved) {
      // Accept the original workspace shape for migration from a browser export.
      this.workspace = validateConfigurationWorkspace(saved.workspace || saved);
      this.revision = saved.revision || 1;
      this.pendingDefault = saved.pendingDefault || null;
    } else {
      let source;
      let origin;
      let pendingDefault = false;
      try { source = await readFile(path.join(this.directory, 'server/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini'), 'utf8'); parse(source); origin = '当前游戏配置（PalWorldSettings.ini）'; }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        source = await this.defaultTemplate({ optional: true });
        if (source === null) {
          source = managedTemplate(this.gamePort, '[/Script/Pal.PalGameWorldSettings]\nOptionSettings=()\n');
          origin = '安装前占位配置';
          pendingDefault = true;
        } else origin = DERIVED_DEFAULT_ORIGIN;
      }
      this.workspace = createWorkspace(createProfile('我的帕鲁世界', source, { origin }));
      this.revision = 1;
      // Before installation, keep only the settings required to manage the game.
      // Replace this untouched placeholder once the official file is installed.
      if (pendingDefault) this.pendingDefault = { id: this.active().id, source };
      await this.persist();
    }
    for (const profile of this.workspace.profiles) profile.initialSource ??= profile.source;
    // The game-default entry is owned by the server and always mirrors the file.
    await this.syncDefaultProfile();
  }
  snapshot() { return { workspace: structuredClone(this.workspace), revision: this.revision }; }
  active() { return this.workspace.profiles.find(p => p.id === this.workspace.activeId); }
  async readDefaultFile({ optional = false } = {}) {
    let source;
    try { source = await readFile(path.join(this.directory, 'server/DefaultPalWorldSettings.ini'), 'utf8'); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (optional) return null;
      throw failure('未找到游戏目录中的 DefaultPalWorldSettings.ini，请先安装服务端。', 409);
    }
    try {
      if (Buffer.byteLength(source, 'utf8') > 1024 * 1024 || !parse(source).entries.length) throw new Error('默认配置内容无效');
    } catch { throw failure('DefaultPalWorldSettings.ini 内容无效，请检查游戏目录中的官方默认配置。', 409); }
    return source;
  }
  async defaultTemplate({ optional = false } = {}) {
    const source = await this.readDefaultFile({ optional });
    return source === null ? null : managedTemplate(this.gamePort, source);
  }
  /**
   * Server-owned read-only entry that mirrors DefaultPalWorldSettings.ini.
   * Legacy profiles that only claimed the official origin become editable copies;
   * only this entry may carry locked/origin=official.
   */
  applyDefaultProfile(workspace, source) {
    let changed = false;
    let locked = workspace.profiles.find(profile => profile.locked === true) ?? workspace.profiles.find(profile => profile.id === GAME_DEFAULT_PROFILE_ID);
    if (locked) {
      if (locked.locked !== true) { locked.locked = true; changed = true; }
      for (const profile of workspace.profiles) {
        if (profile !== locked && profile.locked) { delete profile.locked; changed = true; }
      }
    }
    for (const profile of workspace.profiles) {
      if (profile !== locked && !profile.locked && profile.origin === OFFICIAL_DEFAULT_ORIGIN) {
        profile.origin = DERIVED_DEFAULT_ORIGIN;
        changed = true;
      }
    }
    if (source !== null) {
      if (!locked) {
        const managed = managedTemplate(this.gamePort, source);
        locked = createProfile(GAME_DEFAULT_PROFILE_NAME, managed, { id: () => GAME_DEFAULT_PROFILE_ID, origin: OFFICIAL_DEFAULT_ORIGIN, locked: true });
        workspace.profiles.push(locked);
        changed = true;
      } else {
        // Keep the generated admin password stable, enable REST management, and
        // follow the file only while the user has not edited the working source.
        const password = sourcePassword(locked.initialSource) || sourcePassword(locked.source);
        const managed = managedTemplate(this.gamePort, source, { password });
        const unedited = locked.source === locked.initialSource;
        let nextSource = unedited || !locked.source ? managed : locked.source;
        // An edited default may predate password generation (or have it cleared).
        // Keep its parameters but restore the managed credentials.
        if (!unedited && nextSource && !sourcePassword(nextSource)) nextSource = managedTemplate(this.gamePort, nextSource, { password });
        if (locked.name !== GAME_DEFAULT_PROFILE_NAME || locked.origin !== OFFICIAL_DEFAULT_ORIGIN || locked.locked !== true || locked.initialSource !== managed || locked.source !== nextSource) {
          Object.assign(locked, {
            name: GAME_DEFAULT_PROFILE_NAME, origin: OFFICIAL_DEFAULT_ORIGIN, locked: true,
            source: nextSource, initialSource: managed, updatedAt: new Date().toISOString()
          });
          changed = true;
        }
      }
    } else if (locked && (locked.name !== GAME_DEFAULT_PROFILE_NAME || locked.origin !== OFFICIAL_DEFAULT_ORIGIN || locked.locked !== true)) {
      Object.assign(locked, { name: GAME_DEFAULT_PROFILE_NAME, origin: OFFICIAL_DEFAULT_ORIGIN, locked: true });
      changed = true;
    }
    return changed;
  }
  syncDefaultProfile() {
    const operation = this.writes.then(async () => {
      let source = null;
      try { source = await this.readDefaultFile({ optional: true }); }
      catch { source = null; }
      if (!this.applyDefaultProfile(this.workspace, source)) return false;
      this.revision += 1;
      await this.persist();
      return true;
    });
    this.writes = operation.catch(() => {});
    return operation;
  }
  persist() { return jsonWrite(this.file, { ...this.snapshot(), ...(this.pendingDefault ? { pendingDefault: this.pendingDefault } : {}) }); }
  importDefaultIfPending() {
    const operation = this.writes.then(async () => {
      const pending = this.pendingDefault;
      let imported = false;
      let source = null;
      if (pending) {
        const profile = this.workspace.profiles.find(candidate => candidate.id === pending.id);
        if (profile && profile.source === pending.source) {
          source = await this.readDefaultFile();
          imported = true;
        }
      }
      if (source === null) {
        try { source = await this.readDefaultFile({ optional: true }); }
        catch { source = null; }
      }
      const workspace = structuredClone(this.workspace);
      if (imported) {
        const profile = workspace.profiles.find(candidate => candidate.id === pending.id);
        const managed = managedTemplate(this.gamePort, source);
        profile.source = managed; profile.initialSource = managed; profile.updatedAt = new Date().toISOString();
        profile.origin = DERIVED_DEFAULT_ORIGIN;
      }
      const changed = this.applyDefaultProfile(workspace, source) || imported;
      if (!changed) return false;
      const revision = this.revision + 1;
      const nextPending = imported ? null : this.pendingDefault;
      await jsonWrite(this.file, { workspace, revision, ...(nextPending ? { pendingDefault: nextPending } : {}) });
      this.workspace = workspace; this.revision = revision; this.pendingDefault = nextPending;
      return imported;
    });
    this.writes = operation.catch(() => {});
    return operation;
  }
  update(workspace, revision) {
    const operation = this.writes.then(async () => {
      if (revision !== this.revision) throw failure('配置已在其他页面修改，请刷新后再编辑。', 409);
      validateConfigurationWorkspace(workspace);
      const candidate = structuredClone(workspace);
      const locked = this.workspace.profiles.find(profile => profile.locked === true);
      for (let index = 0; index < candidate.profiles.length; index++) {
        const profile = candidate.profiles[index];
        if (locked && profile.id === locked.id) {
          // The server owns name/origin/restore baseline; parameter edits are allowed.
          const next = structuredClone(locked);
          next.source = profile.source;
          if (typeof profile.updatedAt === 'string') next.updatedAt = profile.updatedAt;
          candidate.profiles[index] = next;
          continue;
        }
        const previous = this.workspace.profiles.find(p => p.id === profile.id);
        delete profile.locked;
        // A later edit cannot accidentally replace the original input baseline or origin.
        profile.initialSource = previous?.initialSource ?? previous?.source ?? profile.initialSource ?? profile.source;
        if (previous?.origin) profile.origin = previous.origin;
        if (profile.origin === OFFICIAL_DEFAULT_ORIGIN) profile.origin = DERIVED_DEFAULT_ORIGIN;
      }
      if (locked && !candidate.profiles.some(profile => profile.id === locked.id)) candidate.profiles.push(structuredClone(locked));
      validateConfigurationWorkspace(candidate);
      const next = this.revision + 1;
      const pendingDefault = this.pendingDefault && candidate.profiles.some(profile => profile.id === this.pendingDefault.id && profile.source === this.pendingDefault.source) ? this.pendingDefault : null;
      await jsonWrite(this.file, { workspace: candidate, revision: next, ...(pendingDefault ? { pendingDefault } : {}) });
      this.pendingDefault = pendingDefault;
      this.workspace = candidate;
      this.revision = next;
      return this.snapshot();
    });
    this.writes = operation.catch(() => {});
    return operation;
  }
}
