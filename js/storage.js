(function (root) {
  'use strict';
  const KEY = 'palbox.workspace.v1';
  function validate(workspace) {
    if (!workspace || workspace.version !== 1 || !Array.isArray(workspace.profiles) || !workspace.profiles.length) throw new Error('本地配置数据格式不正确。原始数据已保留，未覆盖。');
    const ids = new Set();
    for (const profile of workspace.profiles) {
      if (!profile || typeof profile.id !== 'string' || !profile.id || ids.has(profile.id) || typeof profile.name !== 'string' || !profile.name.trim() || typeof profile.source !== 'string') throw new Error('本地配置记录不完整。原始数据已保留，未覆盖。');
      ids.add(profile.id);
    }
    if (!ids.has(workspace.activeId)) throw new Error('本地配置的选中记录不存在。原始数据已保留，未覆盖。');
    return workspace;
  }
  function load(storage) {
    try {
      const raw = storage.getItem(KEY);
      return raw === null ? null : validate(JSON.parse(raw));
    } catch (error) { throw new Error(`读取本地配置失败：${error.message}`); }
  }
  function save(storage, workspace) {
    try { storage.setItem(KEY, JSON.stringify(validate(workspace))); }
    catch (error) { throw new Error(`保存失败，请复制配置备份。${error.message}`); }
  }
  const api = { KEY, validate, load, save };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PalStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
