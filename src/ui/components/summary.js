import { decodeString } from '../../domain/config.js';
import { savedTime } from '../dom.js';

export function createSummary({ dom, editor, workspace, catalog, isDirty }) {
  const { $, document } = dom;
  return {
    render() {
      const profile = workspace.active;
      const unknownCount = editor.entries.filter(catalog.isUnknown).length;
      const counts = catalog.summarize(editor.entries);
      $('parameter-count').textContent = editor.entries.length;
      $('recognition-summary').textContent = `${counts.official} 项官方 · ${counts.community} 项待验证`;
      $('unknown-count').textContent = unknownCount;
      $('unknown-summary').setAttribute('aria-label', `查看和编辑 ${unknownCount} 项未识别参数`);
      $('player-count').textContent = editor.raw('ServerPlayerMaxNum') ?? '—';
      $('change-count').textContent = editor.changedKeys().length;
      let status = isDirty()
        ? { state: 'pending', label: '未保存', detail: '当前修改尚未保存到浏览器。' }
        : { state: 'saved', label: '已保存', detail: '所有有效修改已自动保存到当前浏览器。' };
      if (editor.sourceDraft !== null) status = { state: 'pending', label: '待应用', detail: '源码修改尚未应用，应用成功后会自动保存。' };
      if (editor.errorCount) status = { state: 'error', label: '输入有误', detail: `${editor.errorCount} 项输入需要修正，已保留上一次有效值。` };
      if (!workspace.persisted) status = { state: 'error', label: '保存失败', detail: '自动保存失败，请复制配置备份。' };
      const badge = $('change-caption');
      if (badge.textContent !== status.label) badge.textContent = status.label;
      badge.dataset.state = status.state;
      badge.title = status.detail;
      badge.setAttribute('aria-label', status.detail);
      $('profile-title').textContent = profile.name;
      $('profile-server').textContent = decodeString(editor.raw('ServerName') || 'PalWorldSettings.ini');
      $('profile-updated').textContent = savedTime(profile.updatedAt);
      document.title = `${isDirty() ? '● ' : ''}${profile.name} · Palbox`;
    }
  };
}
