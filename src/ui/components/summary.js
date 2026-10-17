import { decodeString } from '../../domain/config.js';
import { savedTime } from '../dom.js';

export function createSummary({ dom, editor, workspace, catalog, isDirty }) {
  const { $, icon, document } = dom;
  return {
    render() {
      const profile = workspace.active;
      const unknownCount = editor.entries.filter(catalog.isUnknown).length;
      $('parameter-count').textContent = editor.entries.length;
      $('unknown-count').textContent = unknownCount;
      $('unknown-summary').setAttribute('aria-label', `查看和编辑 ${unknownCount} 项未识别参数`);
      $('player-count').textContent = editor.raw('ServerPlayerMaxNum') ?? '—';
      $('change-count').textContent = editor.changedKeys().length;
      let message = isDirty() ? '有更改尚未保存' : '所有更改已保存';
      if (editor.sourceDraft !== null) message = '源码待应用';
      if (editor.errorCount) message = `${editor.errorCount} 项输入需要修正`;
      if (!workspace.persisted) message = '更改尚未存入浏览器';
      $('change-caption').textContent = message;
      $('save-state').replaceChildren(icon(isDirty() ? 'edit' : 'check'), document.createTextNode(message));
      $('save-state').classList.toggle('unsaved', isDirty());
      $('profile-title').textContent = profile.name;
      $('profile-server').textContent = decodeString(editor.raw('ServerName') || 'PalWorldSettings.ini');
      $('profile-updated').textContent = savedTime(profile.updatedAt);
      document.title = `${isDirty() ? '● ' : ''}${profile.name} · Palbox`;
    }
  };
}
