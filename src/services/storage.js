import { validateWorkspace } from '../domain/workspace.js';

// Keep the key and wire shape compatible with existing browser workspaces.
export const KEY = 'palbox.workspace.v1';
export { validateWorkspace as validate };

export function load(storage) {
  try {
    const raw = storage.getItem(KEY);
    return raw === null ? null : validateWorkspace(JSON.parse(raw));
  } catch (error) { throw new Error(`读取本地配置失败：${error.message}`); }
}

export function save(storage, workspace) {
  try { storage.setItem(KEY, JSON.stringify(validateWorkspace(workspace))); }
  catch (error) { throw new Error(`保存失败，请复制配置备份。${error.message}`); }
}

export function createRepository(getStorage) {
  return {
    load: () => load(getStorage()),
    save: workspace => save(getStorage(), workspace)
  };
}
