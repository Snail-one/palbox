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
      this.#workspace = createWorkspace(this.#profile('我的帕鲁世界', template));
      if (!this.#blocked) this.persist();
    }
  }

  get profiles() { return this.#workspace.profiles; }
  get active() { return this.profiles.find(profile => profile.id === this.#workspace.activeId); }
  get initialSource() { return this.active.initialSource ?? this.active.source; }
  get persisted() { return this.#persisted; }
  get message() { return this.#message; }
  #profile(name, source) { return createProfile(name, source, this.#identity); }

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

  add(name, source = this.#template, { select = true } = {}) {
    parse(source);
    const profile = this.#profile(name, source);
    this.profiles.push(profile);
    if (select) this.select(profile.id);
    this.#persisted = false;
    return profile;
  }

  rename(name, id = this.active.id) {
    const profile = this.profiles.find(profile => profile.id === id);
    if (!profile) throw new Error('配置不存在。');
    profile.name = name;
    this.#persisted = false;
  }

  remove(id = this.active.id, { fallbackSource = this.#template } = {}) {
    if (!this.profiles.some(profile => profile.id === id)) throw new Error('配置不存在。');
    const activeRemoved = id === this.active.id;
    const remaining = this.profiles.filter(profile => profile.id !== id);
    if (!remaining.length) { parse(fallbackSource); remaining.push(this.#profile('我的帕鲁世界', fallbackSource)); }
    this.#workspace.profiles = remaining;
    if (activeRemoved) this.select(remaining[0].id);
    this.#persisted = false;
  }

  removeActive() { this.remove(); }

  saveSource(source) {
    parse(source);
    // Capture legacy profiles before their first edit; later saves keep this baseline.
    this.active.initialSource ??= this.active.source;
    const previous = { ...this.active };
    this.active.source = source;
    this.active.updatedAt = this.#identity.now?.() ?? new Date().toISOString();
    try {
      if (this.persist()) return true;
    } catch (error) {
      Object.assign(this.active, previous);
      throw error;
    }
    Object.assign(this.active, previous);
    return false;
  }
}
