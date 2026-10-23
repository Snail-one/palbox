import { parse, decodeString, encodeString } from '../../../shared/domain/config.js';
import { fields } from '../../../shared/domain/schema.js';
import { configurationValue } from './components/configuration-value.js';
import { updatePendingBadge } from './components/pending-badge.js';
import { updateModifiedBadge } from './components/modified-badge.js';
import { createFieldFeedback } from './components/field-feedback.js';

export function createModifiedParametersDialog({ dom, editor, catalog, workspace, ask, onChanged }) {
  const { $, el } = dom;
  const dialog = $('modified-parameters-dialog');
  let pendingKeys = new Set();
  let pendingProfileId = null;
  let renderedProfileId = null;
  const rows = new Map();
  const feedback = createFieldFeedback({ dom, editor, catalog, ask, onChanged, onRestored() {
    render();
    $('modified-parameters-search').focus();
  } });

  function clear() { $('modified-parameters-list').replaceChildren(); rows.clear(); }

  function currentValue(key) {
    const box = el('div', 'pending-config-value'); box.dataset.diffValue = 'current';
    box.append(el('span', 'pending-config-label', '当前值（可编辑）'));
    if (editor.raw(key) === undefined) {
      box.append(el('span', 'management-note', '参数已移除'));
      return { box };
    }
    const field = fields[key];
    const options = field?.type === 'boolean' ? { True: '开启（True）', False: '关闭（False）' } : field?.type === 'select' ? field.options : null;
    const input = el(options ? 'select' : 'input', `field-input${options ? ' field-select' : ''}${field?.secret ? ' field-secret' : ''}`);
    input.id = `modified-field-${key}`;
    input.setAttribute('aria-label', `${field?.label || key}：当前值`);
    const error = el('p', 'field-error'); error.id = `modified-error-${key}`; error.setAttribute('aria-live', 'polite');
    input.setAttribute('aria-describedby', error.id);
    const display = () => editor.draft(key) ?? (field?.type === 'text' ? decodeString(editor.raw(key)) : editor.outputRaw(key));
    if (options) {
      for (const [value, label] of Object.entries(options)) {
        const option = el('option', '', label); option.value = value; input.append(option);
      }
      const value = decodeString(display());
      if (!Object.hasOwn(options, value)) { const option = el('option', '', `原始值：${value}`); option.value = value; input.append(option); }
      input.value = value;
      input.addEventListener('change', () => feedback.updateValue(key, field.type === 'select' && editor.raw(key).startsWith('"') ? encodeString(input.value) : input.value, input, error));
    } else {
      input.type = field?.secret ? 'password' : 'text'; input.autocomplete = 'off'; input.spellcheck = false;
      if (field?.type === 'number') input.inputMode = field.integer ? 'numeric' : 'decimal';
      input.value = display();
      input.addEventListener('input', () => {
        let raw;
        try { raw = field?.type === 'text' ? encodeString(input.value) : input.value.trim(); }
        catch (caught) { feedback.rejectValue(key, caught.message, input, error); return; }
        feedback.updateValue(key, raw, input, error);
      });
      if (field?.type === 'number') feedback.formatOnBlur(key, input, error);
    }
    input.addEventListener('blur', () => queueMicrotask(render));
    const wrap = el('div', 'input-wrap'); wrap.append(input);
    if (field?.secret) {
      const reveal = el('button', 'icon-button reveal-button'); reveal.type = 'button';
      reveal.setAttribute('aria-label', `显示${field.label}：当前值`); reveal.setAttribute('aria-pressed', 'false'); reveal.append(dom.icon('eye'));
      reveal.addEventListener('click', () => {
        const visible = input.type === 'password'; input.type = visible ? 'text' : 'password';
        reveal.setAttribute('aria-label', `${visible ? '隐藏' : '显示'}${field.label}：当前值`); reveal.setAttribute('aria-pressed', String(visible));
      });
      wrap.append(reveal);
    }
    box.append(wrap, error);
    return { box, input, error, display, options };
  }

  function render() {
    if (!dialog.open) { clear(); return; }
    if (renderedProfileId !== workspace.active?.id) { clear(); renderedProfileId = workspace.active?.id; }
    if (pendingProfileId !== workspace.active?.id) pendingKeys.clear();
    const changed = workspace.active ? editor.changedKeys() : [];
    const focused = dom.document.activeElement;
    const focusedKey = focused?.matches('input, select, textarea') ? focused.closest('[data-modified-key]')?.dataset.modifiedKey : null;
    const keys = [...new Set([...changed, ...editor.entries.filter(({ key }) => editor.error(key)).map(({ key }) => key), ...(focusedKey ? [focusedKey] : [])])];
    const baseline = new Map(workspace.active ? parse(workspace.initialSource).entries.map(({ key, raw }) => [key, raw]) : []);
    const query = $('modified-parameters-search').value.trim().toLowerCase();
    const selected = keys.filter(key => `${key} ${fields[key]?.label || ''} ${fields[key]?.description || ''}`.toLowerCase().includes(query));
    $('modified-parameters-note').textContent = workspace.active
      ? `当前配置：${workspace.active.name}。可直接编辑并自动保存，恢复默认仅恢复这一项的初始基准；仍需应用配置才会影响游戏。`
      : '暂无可用配置，请先新建或选择配置。';
    if (editor.errorCount) $('modified-parameters-note').textContent += ' 无效输入会保留，上一次有效值仍用于保存。';
    $('change-count').textContent = changed.length;
    const saveState = $('change-caption'), status = $('modified-parameters-save');
    status.textContent = saveState.textContent; status.dataset.state = saveState.dataset.state; status.title = saveState.title;
    status.setAttribute('aria-label', saveState.getAttribute('aria-label'));
    $('modified-parameters-count').textContent = `显示 ${selected.length} 项`;
    $('modified-parameters-empty').hidden = selected.length > 0;
    $('modified-parameters-empty').textContent = keys.length ? '没有匹配的参数，请换一个关键词。' : '当前配置没有相对初始基准的修改。';
    const list = $('modified-parameters-list');
    // Preserve the focused control through autosave and status updates, even while
    // its value briefly matches the baseline during typing.
    for (const [key, row] of rows) if (!selected.includes(key)) { row.card.remove(); rows.delete(key); }
    for (const key of selected) {
      const existing = rows.get(key);
      if (existing) {
        updateModifiedBadge(dom, existing.heading, editor.isModified(key));
        updatePendingBadge(dom, existing.heading, pendingKeys.has(key));
        feedback.updateResetButton(key, existing.heading);
        if (existing.input) {
          existing.input.setAttribute('aria-invalid', String(Boolean(editor.error(key)))); existing.error.textContent = editor.error(key);
          if (existing.input !== focused) existing.input.value = existing.options ? decodeString(existing.display()) : existing.display();
        }
        continue;
      }
      const card = el('section', 'pending-config-entry'); card.dataset.modifiedKey = key;
      const heading = el('div', 'pending-config-heading');
      heading.append(el('h3', '', fields[key]?.label || key));
      updateModifiedBadge(dom, heading, editor.isModified(key));
      updatePendingBadge(dom, heading, pendingKeys.has(key));
      feedback.updateResetButton(key, heading);
      const values = el('div', 'pending-config-values');
      const before = baseline.get(key);
      const control = currentValue(key);
      values.append(
        configurationValue(dom, '原始值', before === undefined ? null : catalog.formatOutput(key, before), key, 'original'),
        control.box
      );
      card.append(heading, el('div', 'field-key', key), values); list.append(card);
      if (control.input) { control.input.setAttribute('aria-invalid', String(Boolean(editor.error(key)))); control.error.textContent = editor.error(key); }
      rows.set(key, { card, heading, ...control });
    }
  }
  $('modified-parameters-search').addEventListener('input', render);
  for (const id of ['show-modified-parameters', 'modified-summary']) $(id).addEventListener('click', () => {
    if (dialog.open) return;
    $('modified-parameters-search').value = '';
    dialog.showModal(); render();
  });
  dialog.addEventListener('close', () => {
    clear();
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
