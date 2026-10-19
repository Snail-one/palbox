import { createFieldFeedback } from './field-feedback.js';
import { createParameterEvidence } from './parameter-evidence.js';
import { createAdminPasswordControl } from './admin-password.js';
import { encodeString } from '../../../../shared/domain/config.js';
import { updateModifiedBadge } from './modified-badge.js';

export function createParameterView({ dom, editor, catalog, view, onChanged }) {
  const { $, el, icon, empty } = dom;
  const raw = key => editor.outputRaw(key);
  const isModified = key => editor.isModified(key);
  const isUnknown = entry => catalog.isUnknown(entry);
  const matches = entry => catalog.matches(entry, view.search);
  const { updateValue, formatOnBlur } = createFieldFeedback({ dom, editor, onChanged });
  function renderTable() {
    empty($('parameter-rows'));
    const unknownCount = editor.entries.filter(isUnknown).length;
    const counts = catalog.summarize(editor.entries);
    const entries = editor.entries.filter(e => matches(e) && (!view.unknownOnly || isUnknown(e)) && (!view.unverifiedOnly || catalog.isCommunity(e)));
    $('unknown-only').checked = view.unknownOnly;
    $('unverified-only').checked = view.unverifiedOnly;
    $('table-count').textContent = `${counts.official} 项官方说明 · ${counts.community} 项行为未完全验证 · ${unknownCount} 项未识别 · 当前显示 ${entries.length} 项`;
    $('table-empty').hidden = entries.length > 0;
    $('table-empty').textContent = view.unknownOnly
      ? (unknownCount === 0 ? '当前配置没有未识别参数。' : '没有匹配的未识别参数，试试其他关键词。')
      : view.unverifiedOnly
      ? (counts.community === 0 ? '当前配置没有未验证参数。' : '没有匹配的未验证参数，试试其他关键词。')
      : '没有匹配的参数。';
    for (const entry of entries) {
      const row = el('tr', isModified(entry.key) ? 'modified' : '');
      const name = el('td', '', entry.key);
      const field = catalog.fields[entry.key];
      if (field) {
        const heading = el('div', 'parameter-heading');
        heading.append(el('span', 'parameter-label', field.label), createParameterEvidence(dom, field, `raw-desc-${entry.key}`));
        updateModifiedBadge(dom, heading, isModified(entry.key));
        name.append(heading);
      } else {
        name.append(el('small', 'unknown-tag', '未识别参数 · 用途尚未核实'));
        updateModifiedBadge(dom, name, isModified(entry.key));
      }
      const cell = el('td');
      const wrap = el('div', 'input-wrap');
      const secret = catalog.fields[entry.key]?.secret;
      const input = el('input', `raw-input${secret ? ' field-secret' : ''}`);
      input.type = secret ? 'password' : 'text'; input.autocomplete = 'off'; input.spellcheck = false;
      input.value = editor.draft(entry.key) !== undefined ? editor.draft(entry.key) : raw(entry.key);
      input.setAttribute('aria-label', `${entry.key} 的原始值`);
      const errorNode = el('p', 'field-error', editor.error(entry.key));
      errorNode.id = `raw-error-${entry.key}`; errorNode.setAttribute('aria-live', 'polite');
      input.setAttribute('aria-describedby', errorNode.id);
      input.setAttribute('aria-invalid', String(Boolean(editor.error(entry.key))));
      input.addEventListener('input', () => updateValue(entry.key, input.value.trim(), input, errorNode));
      if (field?.type === 'number') formatOnBlur(entry.key, input, errorNode);
      wrap.append(input);
      if (secret) {
        const reveal = el('button', 'icon-button reveal-button'); reveal.setAttribute('aria-label', `显示 ${entry.key}`); reveal.setAttribute('aria-pressed', 'false'); reveal.append(icon('eye'));
        reveal.addEventListener('click', () => {
          const visible = input.type === 'password'; input.type = visible ? 'text' : 'password';
          reveal.setAttribute('aria-pressed', String(visible)); reveal.setAttribute('aria-label', `${visible ? '隐藏' : '显示'} ${entry.key}`);
        });
        wrap.append(reveal);
      }
      cell.append(['AdminPassword', 'ServerPassword'].includes(entry.key) ? createAdminPasswordControl({ dom, input, wrap, label: field.label, onGenerate(password) {
        input.value = encodeString(password);
        updateValue(entry.key, input.value, input, errorNode);
      } }) : wrap, errorNode);
      row.append(name, cell); $('parameter-rows').append(row);
    }
  }
  return { render: renderTable };
}
