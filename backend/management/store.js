import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { parse, serialize, encodeString } from '../../shared/domain/config.js';
import { createProfile, createWorkspace, validateWorkspace } from '../../shared/domain/workspace.js';
import { jsonWrite, readJson, failure } from './files.js';

export function managedTemplate(port, source) {
  const changes = new Map([
    ['RESTAPIEnabled', 'True'], ['AdminPassword', encodeString(randomBytes(24).toString('hex'))], ['PublicPort', String(port)]
  ]);
  const parsed = parse(source);
  const keys = new Set(parsed.entries.map(entry => entry.key));
  const missing = [...changes].filter(([key]) => !keys.has(key));
  if (missing.length) source = source.slice(0, parsed.end) + (parsed.entries.length ? ',' : '') + missing.map(([key, raw]) => `${key}=${raw}`).join(',') + source.slice(parsed.end);
  return serialize(parse(source), changes);
}

export function validateConfigurationWorkspace(value) {
  try { validateWorkspace(value); } catch (error) { throw failure(error.message); }
  if (value.profiles.length > 100) throw failure('最多保留 100 套配置。');
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
      let pendingDefault = false;
      try { source = await readFile(path.join(this.directory, 'server/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini'), 'utf8'); parse(source); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        source = await this.defaultTemplate({ optional: true });
        if (source === null) {
          source = managedTemplate(this.gamePort, '[/Script/Pal.PalGameWorldSettings]\nOptionSettings=()\n');
          pendingDefault = true;
        }
      }
      this.workspace = createWorkspace(createProfile('我的帕鲁世界', source));
      this.revision = 1;
      // Before installation, keep only the settings required to manage the game.
      // Replace this untouched placeholder once the official file is installed.
      if (pendingDefault) this.pendingDefault = { id: this.active().id, source };
      await this.persist();
    }
    for (const profile of this.workspace.profiles) profile.initialSource ??= profile.source;
  }
  snapshot() { return { workspace: structuredClone(this.workspace), revision: this.revision }; }
  active() { return this.workspace.profiles.find(p => p.id === this.workspace.activeId); }
  async defaultTemplate({ optional = false } = {}) {
    let source;
    try { source = await readFile(path.join(this.directory, 'server/DefaultPalWorldSettings.ini'), 'utf8'); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (optional) return null;
      throw failure('未找到游戏目录中的 DefaultPalWorldSettings.ini，请先安装服务端。', 409);
    }
    try {
      if (Buffer.byteLength(source, 'utf8') > 1024 * 1024 || !parse(source).entries.length) throw new Error('默认配置内容无效');
      return managedTemplate(this.gamePort, source);
    } catch { throw failure('DefaultPalWorldSettings.ini 内容无效，请检查游戏目录中的官方默认配置。', 409); }
  }
  persist() { return jsonWrite(this.file, { ...this.snapshot(), ...(this.pendingDefault ? { pendingDefault: this.pendingDefault } : {}) }); }
  importDefaultIfPending() {
    const operation = this.writes.then(async () => {
      if (!this.pendingDefault) return false;
      const profile = this.workspace.profiles.find(profile => profile.id === this.pendingDefault.id);
      if (!profile || profile.source !== this.pendingDefault.source) return false;
      const source = await this.defaultTemplate();
      const workspace = structuredClone(this.workspace);
      const imported = workspace.profiles.find(candidate => candidate.id === profile.id);
      imported.source = source; imported.initialSource = source; imported.updatedAt = new Date().toISOString();
      const revision = this.revision + 1;
      await jsonWrite(this.file, { workspace, revision });
      this.workspace = workspace; this.revision = revision; this.pendingDefault = null;
      return true;
    });
    this.writes = operation.catch(() => {});
    return operation;
  }
  update(workspace, revision) {
    const operation = this.writes.then(async () => {
      if (revision !== this.revision) throw failure('配置已在其他页面修改，请刷新后再编辑。', 409);
      validateConfigurationWorkspace(workspace);
      const candidate = structuredClone(workspace);
      for (const profile of candidate.profiles) {
        const previous = this.workspace.profiles.find(p => p.id === profile.id);
        // A later edit cannot accidentally replace the original input baseline.
        profile.initialSource = previous?.initialSource ?? previous?.source ?? profile.initialSource ?? profile.source;
      }
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
