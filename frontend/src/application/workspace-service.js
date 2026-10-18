import { parse } from '../../../shared/domain/config.js';
import { createProfile, createWorkspace, validateWorkspace } from '../../../shared/domain/workspace.js';

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
      this.#workspace = createWorkspace(this.#profile('我的帕鲁世界', template, '内置模板'));
      if (!this.#blocked) this.persist();
    }
  }

  get profiles() { return this.#workspace.profiles; }
  get active() { return this.profiles.find(profile => profile.id === this.#workspace.activeId); }
  get initialSource() { return this.active.initialSource ?? this.active.source; }
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
    parse(source);
    const profile = this.#profile(name, source, origin);
    this.profiles.push(profile);
    if (select) this.select(profile.id);
    this.#persisted = false;
    return profile;
  }

  rename(name, id = this.active.id) {
    const profile = this.profiles.find(profile => profile.id === id);
    if (!profile) throw new Error('配置不存在。');
    if (profile.locked) throw new Error('游戏默认配置不能重命名。');
    profile.name = name;
    this.#persisted = false;
  }

  remove(id = this.active.id, { fallbackSource, fallbackOrigin } = {}) {
    const removed = this.profiles.find(profile => profile.id === id);
    if (!removed) throw new Error('配置不存在。');
    if (removed.locked) throw new Error('游戏默认配置不能删除。');
    const activeRemoved = id === this.active.id;
    const remaining = this.profiles.filter(profile => profile.id !== id);
    // Keeping the server-owned game-default entry is enough; do not recreate a
    // deleted editable profile when that entry is still available.
    if (!remaining.length) {
      const source = fallbackSource ?? this.#template;
      parse(source);
      remaining.push(this.#profile('我的帕鲁世界', source, fallbackOrigin ?? '内置模板'));
    }
    this.#workspace.profiles = remaining;
    if (activeRemoved) this.select((remaining.find(profile => !profile.locked) ?? remaining[0]).id);
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
