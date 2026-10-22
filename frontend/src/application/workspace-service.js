import { parse, decodeString, mergeConfiguration, applyManagedAccess, MAX_CONFIGURATION_SOURCE_LENGTH } from '../../../shared/domain/config.js';
import { createProfile, createWorkspace, validateWorkspace, MAX_PROFILES } from '../../../shared/domain/workspace.js';

function managedPassword(source) {
  try { return decodeString(parse(source).entries.find(entry => entry.key === 'AdminPassword')?.raw || '""'); }
  catch { return ''; }
}

function randomPassword() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Coordinates persistence through an injected { load, save } repository. */
export class WorkspaceService {
  #repository;
  #template;
  #identity;
  #workspace;
  #blocked = false;
  #persisted = true;
  #message = '';

  constructor({ repository, template, id, now }) {
    this.#repository = repository;
    this.#template = template;
    this.#identity = { id, now };
    try {
      this.#workspace = repository.load();
      if (this.#workspace) {
        validateWorkspace(this.#workspace);
        this.profiles.forEach(profile => {
          parse(profile.source);
          if (profile.initialSource !== undefined) parse(profile.initialSource);
        });
      }
    } catch (error) {
      this.#workspace = null;
      this.#blocked = true;
      this.#persisted = false;
      this.#message = `${error.message} 当前使用临时工作空间，可以编辑并复制；请先备份或修复原始数据。`;
    }
    if (!this.#workspace) {
      this.#workspace = createWorkspace(this.#blocked ? this.#profile('临时配置', template, '临时工作空间') : undefined);
      if (!this.#blocked) this.persist();
    }
  }

  get profiles() { return this.#workspace.profiles; }
  get active() { return this.profiles.find(profile => profile.id === this.#workspace.activeId); }
  get initialSource() { return this.active?.initialSource ?? this.active?.source; }
  get persisted() { return this.#persisted; }
  get message() { return this.#message; }
  #profile(name, source, origin) { return createProfile(name, source, { ...this.#identity, origin }); }

  persist() {
    if (this.#blocked) throw new Error(this.#message);
    try {
      this.#repository.save(this.#workspace);
      this.#persisted = true;
      this.#message = '';
      return true;
    } catch (error) {
      this.#persisted = false;
      this.#message = error.message;
      return false;
    }
  }

  select(id) {
    if (!this.profiles.some(profile => profile.id === id)) throw new Error('配置不存在。');
    this.#workspace.activeId = id;
  }

  add(name, source = this.#template, { select = true, origin } = {}) {
    if (this.profiles.length >= MAX_PROFILES) throw new Error(`最多保留 ${MAX_PROFILES} 套配置（含游戏默认配置），请先删除不需要的配置。`);
    parse(source);
    const profile = this.#profile(name, source, origin);
    this.profiles.push(profile);
    if (select || !this.active) this.select(profile.id);
    this.#persisted = false;
    return profile;
  }

  importConfiguration(name, source, defaultSource, { origin } = {}) {
    const password = managedPassword(defaultSource) || randomPassword();
    const merged = applyManagedAccess(mergeConfiguration(defaultSource, source), password);
    if (merged.length > MAX_CONFIGURATION_SOURCE_LENGTH || defaultSource.length > MAX_CONFIGURATION_SOURCE_LENGTH) throw new Error('合并后的配置内容过长，无法保存，请精简后重试。');
    const profile = this.add(name, merged, { origin });
    profile.initialSource = defaultSource;
    return profile;
  }

  // Overlay an imported file onto one existing profile. Missing keys stay as they are.
  mergeImportedChanges(id, importedSource) {
    const profile = this.profiles.find(candidate => candidate.id === id);
    if (!profile) throw new Error('配置不存在。');
    parse(importedSource);
    const password = managedPassword(profile.source) || managedPassword(profile.initialSource) || randomPassword();
    const merged = applyManagedAccess(mergeConfiguration(profile.source, importedSource), password);
    if (merged.length > MAX_CONFIGURATION_SOURCE_LENGTH) throw new Error('合并后的配置内容过长，无法保存，请精简后重试。');
    return merged;
  }

  rename(name, id = this.active?.id) {
    const profile = this.profiles.find(profile => profile.id === id);
    if (!profile) throw new Error('配置不存在。');
    if (profile.locked) throw new Error('游戏默认配置不能重命名。');
    profile.name = name;
    this.#persisted = false;
  }

  remove(id = this.active?.id) {
    const removed = this.profiles.find(profile => profile.id === id);
    if (!removed) throw new Error('配置不存在。');
    if (removed.locked) throw new Error('游戏默认配置不能删除。');
    const activeRemoved = id === this.active.id;
    const remaining = this.profiles.filter(profile => profile.id !== id);
    this.#workspace.profiles = remaining;
    if (activeRemoved) this.#workspace.activeId = (remaining.find(profile => !profile.locked) ?? remaining[0])?.id ?? null;
    this.#persisted = false;
  }

  updateSource(id, source) {
    const profile = this.profiles.find(candidate => candidate.id === id);
    if (!profile) throw new Error('配置不存在。');
    parse(source);
    // Capture legacy profiles before their first edit; later saves keep this baseline.
    profile.initialSource ??= profile.source;
    const previous = { ...profile };
    profile.source = source;
    profile.updatedAt = this.#identity.now?.() ?? new Date().toISOString();
    try {
      if (this.persist()) return true;
    } catch (error) {
      Object.assign(profile, previous);
      throw error;
    }
    Object.assign(profile, previous);
    return false;
  }

  saveSource(source) { return this.updateSource(this.active.id, source); }
}
