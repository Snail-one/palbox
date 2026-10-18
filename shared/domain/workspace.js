export const WORKSPACE_VERSION = 1;

export function validateWorkspace(workspace) {
  if (!workspace || workspace.version !== WORKSPACE_VERSION || !Array.isArray(workspace.profiles) || !workspace.profiles.length) {
    throw new Error('本地配置数据格式不正确。原始数据已保留，未覆盖。');
  }
  const ids = new Set();
  for (const profile of workspace.profiles) {
    if (!profile || typeof profile.id !== 'string' || !profile.id || ids.has(profile.id) || typeof profile.name !== 'string' || !profile.name.trim() || typeof profile.source !== 'string' || (profile.initialSource !== undefined && typeof profile.initialSource !== 'string') || (profile.origin !== undefined && (typeof profile.origin !== 'string' || profile.origin.length > 200))) {
      throw new Error('本地配置记录不完整。原始数据已保留，未覆盖。');
    }
    ids.add(profile.id);
  }
  if (!ids.has(workspace.activeId)) throw new Error('本地配置的选中记录不存在。原始数据已保留，未覆盖。');
  return workspace;
}

export function createProfile(name, source, { id, now, origin } = {}) {
  return {
    id: id?.() ?? globalThis.crypto.randomUUID(),
    name,
    source,
    initialSource: source,
    updatedAt: now?.() ?? new Date().toISOString(),
    ...(origin ? { origin } : {})
  };
}

export function createWorkspace(profile) {
  return { version: WORKSPACE_VERSION, activeId: profile.id, profiles: [profile] };
}
