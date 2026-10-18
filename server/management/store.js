import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { parse, serialize, encodeString } from '../../src/domain/config.js';
import { createProfile, createWorkspace, validateWorkspace } from '../../src/domain/workspace.js';
import template from '../../src/domain/template.js';
import { jsonWrite, readJson, failure } from './files.js';

export function managedTemplate(port = 8211) {
  return serialize(parse(template), new Map([
    ['RESTAPIEnabled', 'True'], ['AdminPassword', encodeString(randomBytes(24).toString('hex'))], ['PublicPort', String(port)]
  ]));
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
    this.writes = Promise.resolve();
  }
  async initialize() {
    const saved = await readJson(this.file, null);
    if (saved) {
      // Accept the original workspace shape for migration from a browser export.
      this.workspace = validateConfigurationWorkspace(saved.workspace || saved);
      this.revision = saved.revision || 1;
    } else {
      let source;
      try { source = await readFile(path.join(this.directory, 'server/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini'), 'utf8'); parse(source); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        source = managedTemplate(this.gamePort);
      }
      this.workspace = createWorkspace(createProfile('我的帕鲁世界', source));
      this.revision = 1;
      await this.persist();
    }
    for (const profile of this.workspace.profiles) profile.initialSource ??= profile.source;
  }
  snapshot() { return { workspace: structuredClone(this.workspace), revision: this.revision }; }
  active() { return this.workspace.profiles.find(p => p.id === this.workspace.activeId); }
  persist() { return jsonWrite(this.file, this.snapshot()); }
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
      await jsonWrite(this.file, { workspace: candidate, revision: next });
      this.workspace = candidate;
      this.revision = next;
      return this.snapshot();
    });
    this.writes = operation.catch(() => {});
    return operation;
  }
}
