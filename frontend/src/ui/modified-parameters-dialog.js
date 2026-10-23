import { parse } from '../../../shared/domain/config.js';
import { fields } from '../../../shared/domain/schema.js';
import { configurationValue } from './components/configuration-value.js';
import { updatePendingBadge } from './components/pending-badge.js';

export function createModifiedParametersDialog({ dom, editor, catalog, workspace }) {
  const { $, el } = dom;
  const dialog = $('modified-parameters-dialog');
  let pendingKeys = new Set();
  let pendingProfileId = null;

  function render() {
    if (!dialog.open) { $('modified-parameters-list').replaceChildren(); return; }
    if (pendingProfileId !== workspace.active?.id) pendingKeys.clear();
    const keys = workspace.active ? editor.changedKeys() : [];
    const baseline = new Map(workspace.active ? parse(workspace.initialSource).entries.map(({ key, raw }) => [key, raw]) : []);
    const query = $('modified-parameters-search').value.trim().toLowerCase();
    const selected = keys.filter(key => `${key} ${fields[key]?.label || ''} ${fields[key]?.description || ''}`.toLowerCase().includes(query));
    $('modified-parameters-note').textContent = workspace.active
      ? `当前配置：${workspace.active.name}。对比这套配置的初始基准；应用到游戏后仍会保留修改记录。`
      : '暂无可用配置，请先新建或选择配置。';
    if (editor.errorCount) $('modified-parameters-note').textContent += ' 存在无效输入，列表显示上一次有效值。';
    $('change-count').textContent = keys.length;
    $('modified-parameters-count').textContent = `显示 ${selected.length} 项`;
    $('modified-parameters-empty').hidden = selected.length > 0;
    $('modified-parameters-empty').textContent = keys.length ? '没有匹配的参数，请换一个关键词。' : '当前配置没有相对初始基准的修改。';
    const list = $('modified-parameters-list'); list.replaceChildren();
    for (const key of selected) {
      const card = el('section', 'pending-config-entry'); card.dataset.modifiedKey = key;
      const heading = el('div', 'pending-config-heading');
      heading.append(el('h3', '', fields[key]?.label || key), el('span', 'modified-badge', '已修改'));
      updatePendingBadge(dom, heading, pendingKeys.has(key));
      const values = el('div', 'pending-config-values');
      const before = baseline.get(key);
      const after = editor.raw(key);
      values.append(
        configurationValue(dom, '原始值', before === undefined ? null : catalog.formatOutput(key, before), key, 'original'),
        configurationValue(dom, '当前值', after === undefined ? null : editor.outputRaw(key), key, 'current')
      );
      card.append(heading, el('div', 'field-key', key), values); list.append(card);
    }
  }
  $('modified-parameters-search').addEventListener('input', render);
  $('show-modified-parameters').addEventListener('click', () => {
    if (dialog.open) return;
    $('modified-parameters-search').value = '';
    dialog.showModal(); render();
  });
  dialog.addEventListener('close', () => {
    $('modified-parameters-list').replaceChildren();
    $('modified-parameters-note').textContent = '';
    $('modified-parameters-search').value = '';
    $('modified-parameters-count').textContent = '';
  });
  for (const id of ['modified-parameters-close', 'modified-parameters-done']) $(id).addEventListener('click', () => dialog.close());
  return { render, setPendingConfiguration(value) {
    pendingProfileId = workspace.active?.id;
    pendingKeys = new Set(value?.changes.map(change => change.key) ?? []);
    for (const card of $('modified-parameters-list').querySelectorAll('[data-modified-key]')) {
      updatePendingBadge(dom, card.querySelector('.pending-config-heading'), pendingKeys.has(card.dataset.modifiedKey));
    }
  } };
}
