import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { parse, encodeString, decodeString, mergeConfiguration, applyManagedAccess, applyManagedChanges, MAX_CONFIGURATION_SOURCE_LENGTH } from '../../shared/domain/config.js';
import {
  createProfile, createWorkspace, validateWorkspace, MAX_PROFILES,
  GAME_DEFAULT_PROFILE_ID, GAME_DEFAULT_PROFILE_NAME, OFFICIAL_DEFAULT_ORIGIN, DERIVED_DEFAULT_ORIGIN
} from '../../shared/domain/workspace.js';
import { jsonWrite, readJson, failure } from './files.js';

export function managedTemplate(port, source, { password } = {}) {
  return applyManagedChanges(source, new Map([
    ['RESTAPIEnabled', 'True'], ['AdminPassword', encodeString(password || randomBytes(24).toString('hex'))], ['PublicPort', String(port)]
  ]));
}

function sourcePassword(source) {
  if (typeof source !== 'string') return '';
  try { return decodeString(parse(source).entries.find(entry => entry.key === 'AdminPassword')?.raw || '""'); }
  catch { return ''; }
}

// Parameters whose raw value differs from the previous official baseline.
// Unchanged keys stay out so the next official file can replace them.
function changedParameters(profileSource, previousManaged) {
  try {
    const previousValues = new Map(parse(previousManaged).entries.map(entry => [entry.key, entry.raw]));
    const overrides = parse(profileSource).entries.filter(entry => previousValues.get(entry.key) !== entry.raw);
    if (!overrides.length) return '';
    return `OptionSettings=(${overrides.map(entry => `${entry.key}=${entry.raw}`).join(',')})`;
  } catch {
    return profileSource;
  }
}

// Every profile rests on the official managed default. An unedited copy follows
// the file; an edited copy keeps only the parameters it changed.
function rebaseProfile(profile, managed, previousManaged) {
  const followed = Boolean(previousManaged) && profile.source === previousManaged;
  let nextSource = managed;
  if (!followed && profile.source) {
    const overlay = previousManaged ? changedParameters(profile.source, previousManaged) : profile.source;
    if (overlay) nextSource = mergeConfiguration(managed, overlay);
  }
  const password = sourcePassword(managed);
  if (password && !sourcePassword(nextSource)) nextSource = applyManagedAccess(nextSource, password);
  if (profile.initialSource === managed && profile.source === nextSource) return false;
  profile.initialSource = managed;
  profile.source = nextSource;
  profile.updatedAt = new Date().toISOString();
  return true;
}

function mergedImportedSource(profile, importedSource) {
  const password = sourcePassword(profile.source) || sourcePassword(profile.initialSource) || randomBytes(24).toString('hex');
  const merged = applyManagedAccess(mergeConfiguration(profile.initialSource, importedSource), password);
  if (merged.length > MAX_CONFIGURATION_SOURCE_LENGTH || profile.initialSource.length > MAX_CONFIGURATION_SOURCE_LENGTH) {
    throw failure('合并后的配置内容过长，无法保存，请精简后重试。');
  }
  return merged;
}

export function validateConfigurationWorkspace(value, { maxProfiles = MAX_PROFILES } = {}) {
  try { validateWorkspace(value); } catch (error) { throw failure(error.message); }
  if (value.profiles.length > maxProfiles) throw failure(`最多保留 ${MAX_PROFILES} 套配置（含游戏默认配置），请先删除不需要的配置。`);
  for (const profile of value.profiles) {
    if (profile.source.length > MAX_CONFIGURATION_SOURCE_LENGTH || (profile.initialSource?.length || 0) > MAX_CONFIGURATION_SOURCE_LENGTH || profile.name.length > 100) throw failure('配置内容或名称过长。');
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
    this.defaultConfiguration = { state: 'unknown', version: null };
    this.writes = Promise.resolve();
  }
  async initialize() {
    const saved = await readJson(this.file, null);
    if (saved) {
      // Accept the original workspace shape for migration from a browser export.
      // Existing libraries remain readable and can be reduced to the new limit.
      this.workspace = validateConfigurationWorkspace(saved.workspace || saved, { maxProfiles: 101 });
      this.revision = saved.revision || 1;
      // Remove only untouched placeholders from older deployments.
      const pending = saved.pendingDefault;
      if (pending) {
        this.workspace.profiles = this.workspace.profiles.filter(profile => profile.id !== pending.id || profile.source !== pending.source);
        if (!this.active()) this.workspace.activeId = this.workspace.profiles[0]?.id ?? null;
        this.revision += 1;
        await this.persist();
      }
    } else {
      this.workspace = createWorkspace();
      this.revision = 1;
      // Preserve an existing server configuration, but never create a working copy automatically.
      try {
        const source = await readFile(path.join(this.directory, 'server/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini'), 'utf8');
        parse(source);
        this.workspace = createWorkspace(createProfile('当前游戏配置', source, { origin: '当前游戏配置（PalWorldSettings.ini）' }));
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
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
      const previousManaged = locked?.initialSource;
      if (!locked) {
        const managed = managedTemplate(this.gamePort, source);
        locked = createProfile(GAME_DEFAULT_PROFILE_NAME, managed, { id: () => GAME_DEFAULT_PROFILE_ID, origin: OFFICIAL_DEFAULT_ORIGIN, locked: true });
        workspace.profiles.push(locked);
        workspace.activeId ??= locked.id;
        changed = true;
      } else {
        // Rebase the default entry too: new and unchanged parameters follow the
        // official file while user overrides and managed credentials survive.
        const password = sourcePassword(locked.initialSource) || sourcePassword(locked.source);
        const managed = managedTemplate(this.gamePort, source, { password });
        const rebased = { ...locked };
        rebaseProfile(rebased, managed, previousManaged);
        let nextSource = rebased.source;
        // An edited default may predate password generation (or have it cleared).
        // Keep its parameters but restore the managed credentials.
        if (locked.source && !sourcePassword(locked.source)) nextSource = managedTemplate(this.gamePort, nextSource, { password });
        if (locked.name !== GAME_DEFAULT_PROFILE_NAME || locked.origin !== OFFICIAL_DEFAULT_ORIGIN || locked.locked !== true || locked.initialSource !== managed || locked.source !== nextSource) {
          Object.assign(locked, {
            name: GAME_DEFAULT_PROFILE_NAME, origin: OFFICIAL_DEFAULT_ORIGIN, locked: true,
            source: nextSource, initialSource: managed, updatedAt: new Date().toISOString()
          });
          changed = true;
        }
      }
      const managed = locked.initialSource;
      if (managed) {
        for (const profile of workspace.profiles) {
          if (profile === locked) continue;
          if (rebaseProfile(profile, managed, previousManaged)) changed = true;
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
      let state;
      try { source = await this.readDefaultFile({ optional: true }); state = source === null ? 'missing' : 'ready'; }
      catch { state = 'unavailable'; }
      const changed = this.applyDefaultProfile(this.workspace, source);
      const baseline = this.workspace.profiles.find(profile => profile.locked)?.initialSource;
      this.defaultConfiguration = { state, version: state === 'ready' && baseline ? createHash('sha256').update(baseline).digest('hex') : null };
      if (!changed) return false;
      this.revision += 1;
      await this.persist();
      return true;
    });
    this.writes = operation.catch(() => {});
    return operation;
  }
  persist() { return jsonWrite(this.file, this.snapshot()); }
  /**
   * Overlay an imported PalWorldSettings.ini onto the official default, fill
   * missing parameters from that baseline, and store the result on the locked
   * game-default profile. REST API stays enabled and the admin password stays
   * the profile's existing random password, whatever the imported file says.
   */
  async validateImportedConfig(importedSource) {
    if (typeof importedSource !== 'string' || !importedSource.trim()) throw failure('导入的游戏配置为空。', 409);
    try { parse(importedSource); } catch (error) { throw failure(error.message); }
    const official = await this.readDefaultFile();
    const workspace = structuredClone(this.workspace);
    this.applyDefaultProfile(workspace, official);
    const profile = workspace.profiles.find(entry => entry.locked === true);
    if (!profile?.initialSource) throw failure('未找到游戏默认配置。', 409);
    return mergedImportedSource(profile, importedSource);
  }
  applyImportedConfig(importedSource) {
    const operation = this.writes.then(async () => {
      if (typeof importedSource !== 'string' || !importedSource.trim()) throw failure('导入的游戏配置为空。', 409);
      parse(importedSource);
      const official = await this.readDefaultFile();
      this.applyDefaultProfile(this.workspace, official);
      const profile = this.workspace.profiles.find(entry => entry.locked === true);
      if (!profile?.initialSource) throw failure('未找到游戏默认配置。', 409);
      const merged = mergedImportedSource(profile, importedSource);
      profile.source = merged;
      profile.updatedAt = new Date().toISOString();
      this.workspace.activeId = profile.id;
      this.revision += 1;
      await this.persist();
      return merged;
    });
    this.writes = operation.catch(() => {});
    return operation;
  }
  async officialBaseline() {
    await this.readDefaultFile();
    const locked = this.workspace.profiles.find(profile => profile.locked === true);
    if (locked?.initialSource) return locked.initialSource;
    return this.defaultTemplate();
  }
  async newConfigurationTemplate() {
    const file = await this.readDefaultFile({ optional: true });
    if (file === null) {
      return { source: managedTemplate(this.gamePort, '[/Script/Pal.PalGameWorldSettings]\nOptionSettings=()\n'), origin: '手动创建的配置' };
    }
    const locked = this.workspace.profiles.find(profile => profile.locked === true);
    if (locked?.initialSource) return { source: locked.initialSource, origin: DERIVED_DEFAULT_ORIGIN };
    return { source: managedTemplate(this.gamePort, file), origin: DERIVED_DEFAULT_ORIGIN };
  }
  update(workspace, revision, { authorize = () => {} } = {}) {
    const operation = this.writes.then(async () => {
      authorize();
      if (revision !== this.revision) throw failure('配置已在其他页面修改，请刷新后再编辑。', 409);
      const limits = { maxProfiles: Math.max(MAX_PROFILES, this.workspace.profiles.length) };
      validateConfigurationWorkspace(workspace, limits);
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
        // The official managed default is the restore baseline for every profile.
        profile.initialSource = locked?.initialSource || previous?.initialSource || previous?.source || profile.initialSource || profile.source;
        if (previous?.origin) profile.origin = previous.origin;
        if (profile.origin === OFFICIAL_DEFAULT_ORIGIN) profile.origin = DERIVED_DEFAULT_ORIGIN;
      }
      if (locked && !candidate.profiles.some(profile => profile.id === locked.id)) candidate.profiles.push(structuredClone(locked));
      if (!candidate.activeId && locked) candidate.activeId = locked.id;
      validateConfigurationWorkspace(candidate, limits);
      const next = this.revision + 1;
      await jsonWrite(this.file, { workspace: candidate, revision: next }, { beforeCommit: authorize });
      this.workspace = candidate;
      this.revision = next;
      return this.snapshot();
    });
    this.writes = operation.catch(() => {});
    return operation;
  }
}
