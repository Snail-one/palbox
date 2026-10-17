import * as config from '../../domain/config.js';
import { createFieldFeedback } from './field-feedback.js';

export function createFormView({ dom, editor, catalog, view, onCategory, onChanged }) {
  const { $, el, icon, empty, document } = dom;
  const raw = key => editor.raw(key);
  const isModified = key => editor.isModified(key);
  const matches = entry => catalog.matches(entry, view.search);
  const { updateValue, rejectValue } = createFieldFeedback({ dom, editor, onChanged });
  function renderCategories() {
    empty($('category-nav'));
    for (const group of catalog.groups) {
      const button = el('button', `category-button${group.id === view.group && !view.search ? ' active' : ''}`, undefined);
      button.append(icon(group.icon), document.createTextNode(group.name));
      button.setAttribute('aria-pressed', String(group.id === view.group && !view.search));
      button.addEventListener('click', () => {
        onCategory(group.id);
      });
      $('category-nav').append(button);
    }
  }
  function labelWithDot(field) {
    const label = el('label', 'field-label', field.label);
    label.htmlFor = `field-${field.key}`;
    if (isModified(field.key)) {
      const dot = el('span', 'modified-dot');
      dot.title = '本次已修改'; label.append(dot);
    }
    return label;
  }
  function renderFields() {
    empty($('fields-grid'));
    const group = catalog.groups.find(g => g.id === view.group);
    $('group-icon').replaceChildren(icon(view.search ? 'search' : group.icon));
    $('group-title').textContent = view.search ? '搜索结果' : `${group.name}设置`;
    $('group-description').textContent = view.search ? `匹配「${view.search}」的可视化参数` : group.subtitle;
    const entries = Object.keys(catalog.fields).map(key => editor.entries.find(e => e.key === key)).filter(Boolean)
      .filter(e => matches(e) && (view.search || catalog.fields[e.key].group === view.group));
    $('group-count').textContent = `${entries.length} 项参数`;
    $('empty-state').hidden = entries.length > 0;
    for (const entry of entries) {
      const f = catalog.fields[entry.key];
      const value = raw(entry.key);
      const box = el('div', `field${f.wide ? ' wide' : ''}${f.type === 'boolean' ? ' boolean-field' : ''}`);
      const label = labelWithDot(f);
      const keyLabel = el('div', 'field-key', entry.key);
      const description = el('p', 'field-description', f.description);
      description.id = `desc-${entry.key}`;
      const errorNode = el('p', 'field-error', editor.error(entry.key));
      errorNode.id = `error-${entry.key}`;
      errorNode.setAttribute('aria-live', 'polite');
      let control;
      if (f.type === 'boolean') {
        const info = el('div', 'boolean-info');
        info.append(label, keyLabel, description, errorNode);
        control = el('button', 'toggle');
        control.setAttribute('role', 'switch');
        control.setAttribute('aria-checked', String(value === 'True'));
        control.setAttribute('aria-label', f.label);
        control.addEventListener('click', () => {
          const checked = control.getAttribute('aria-checked') !== 'true';
          control.setAttribute('aria-checked', String(checked));
          updateValue(entry.key, checked ? 'True' : 'False', control, errorNode);
        });
        box.append(info, control);
      } else {
        box.append(el('div', 'field-top'));
        box.firstChild.append(label);
        box.append(keyLabel);
        const wrap = el('div', 'input-wrap');
        if (f.type === 'select') {
          control = el('select', 'field-input field-select');
          for (const [v, name] of Object.entries(f.options)) {
            const option = el('option', '', name); option.value = v; control.append(option);
          }
          const decoded = config.decodeString(value);
          if (!Object.hasOwn(f.options, decoded)) { const option = el('option', '', `原始值：${decoded}`); option.value = decoded; control.append(option); }
          control.value = decoded;
          control.addEventListener('change', () => updateValue(entry.key, value.startsWith('"') ? config.encodeString(control.value) : control.value, control, errorNode));
          wrap.append(control);
        } else if (f.type === 'platforms') {
          control = el('fieldset', 'platform-fieldset');
          control.style.cssText = 'border:0;padding:0;margin:0;min-width:0;width:100%';
          control.append(el('legend', 'sr-only', f.label));
          const choices = el('div', 'platform-options');
          const platforms = /^\([^()]*\)$/.test(value) ? value.slice(1, -1).split(',').map(v => v.trim()).filter(Boolean) : null;
          if (platforms && platforms.every(v => /^[A-Za-z0-9_]+$/.test(v))) {
            for (const name of [...new Set(['Steam', 'Xbox', 'PS5', 'Mac', ...platforms])]) {
              const choice = el('label', 'platform-choice');
              const check = el('input'); check.type = 'checkbox'; check.value = name; check.checked = platforms.includes(name);
              choice.append(check, document.createTextNode(name)); choices.append(choice);
              check.addEventListener('change', () => {
                const selected = [...choices.querySelectorAll('input:checked')].map(n => n.value);
                updateValue(entry.key, `(${selected.join(',')})`, control, errorNode);
              });
            }
            control.append(choices);
          } else control.append(el('p', 'platform-warning', '当前平台值为特殊格式，请在高级编辑中修改。'));
          wrap.append(control);
        } else {
          control = el('input', `field-input${f.unit ? ' has-unit' : ''}${f.secret ? ' field-secret' : ''}`);
          control.type = f.secret ? 'password' : 'text';
          control.autocomplete = 'off';
          if (f.type === 'number') control.inputMode = f.integer ? 'numeric' : 'decimal';
          control.value = editor.draft(entry.key) !== undefined ? editor.draft(entry.key) : f.type === 'text' ? config.decodeString(value) : value;
          control.addEventListener('input', () => {
            let next;
            try { next = f.type === 'text' ? config.encodeString(control.value) : control.value.trim(); }
            catch (error) { rejectValue(entry.key, error.message, control, errorNode); return; }
            updateValue(entry.key, next, control, errorNode);
          });
          wrap.append(control);
          if (f.unit) wrap.append(el('span', 'input-unit', f.unit));
          if (f.secret) {
            const reveal = el('button', 'icon-button reveal-button');
            reveal.type = 'button'; reveal.setAttribute('aria-label', `显示${f.label}`); reveal.setAttribute('aria-pressed', 'false'); reveal.append(icon('eye'));
            reveal.addEventListener('click', () => {
              const visible = control.type === 'password'; control.type = visible ? 'text' : 'password';
              reveal.setAttribute('aria-label', `${visible ? '隐藏' : '显示'}${f.label}`); reveal.setAttribute('aria-pressed', String(visible));
            });
            wrap.append(reveal);
          }
        }
        box.append(wrap, description, errorNode);
      }
      control.id = `field-${entry.key}`;
      control.setAttribute('aria-describedby', `${description.id} ${errorNode.id}`);
      control.setAttribute('aria-invalid', String(Boolean(editor.error(entry.key))));
      $('fields-grid').append(box);
    }
  }
  return { render: renderFields, renderCategories };
}
