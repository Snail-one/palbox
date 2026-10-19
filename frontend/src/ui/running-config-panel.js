import { fields, groups } from '../../../shared/domain/schema.js';
import { createParameterEvidence } from './components/parameter-evidence.js';

/** Present only values returned by the running game's settings endpoint. */
export function createRunningConfigPanel({ dom }) {
  const { $, el, icon } = dom;
  let entries = [];
  let category = 'all';
  const categories = [...groups, { id: 'other', name: '其他参数', icon: 'code' }];
  const groupOf = key => fields[key]?.group || 'other';

  function selectView(next) {
    $('running-visual').hidden = next !== 'visual';
    $('running-json').hidden = next !== 'json';
    $('running-search').hidden = next === 'json';
    for (const button of $('running-view').querySelectorAll('button')) {
      const selected = button.dataset.runningView === next;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
  }
  for (const button of $('running-view').querySelectorAll('button')) {
    button.addEventListener('click', () => selectView(button.dataset.runningView));
  }
  $('running-search').addEventListener('input', renderFields);

  function renderCategories() {
    $('running-categories').replaceChildren();
    for (const group of [{ id: 'all', name: '全部', icon: 'grid' }, ...categories]) {
      const count = group.id === 'all' ? entries.length : entries.filter(([key]) => groupOf(key) === group.id).length;
      if (!count && group.id !== 'all') continue;
      const button = el('button', `category-button${category === group.id ? ' active' : ''}`);
      button.type = 'button';
      button.dataset.runningCategory = group.id;
      button.setAttribute('aria-pressed', String(category === group.id));
      button.append(icon(group.icon), el('span', '', group.name), el('span', 'running-category-count', String(count)));
      button.addEventListener('click', () => { category = group.id; renderCategories(); renderFields(); });
      $('running-categories').append(button);
    }
  }

  function renderField(key, value, index) {
    const field = fields[key];
    const box = el('div', `field${field?.wide ? ' wide' : ''}`);
    box.dataset.runningKey = key;
    const id = `running-field-${index}`, descriptionId = `running-desc-${index}`;
    const heading = el('div', 'parameter-heading');
    const label = el('label', 'field-label', field?.label || key); label.htmlFor = id;
    heading.append(label);
    if (field) heading.append(createParameterEvidence(dom, field, descriptionId));
    box.append(el('div', 'field-key', key), heading);
    const description = el('p', 'running-field-description', field?.description || '接口返回的参数，当前没有对应的用途说明。');
    if (!field) description.id = descriptionId;
    box.append(description);
    let control;
    const boolean = typeof value === 'boolean' ? value
      : field?.type === 'boolean' && ['True', 'False'].includes(value) ? value === 'True' : null;
    if (boolean !== null) {
      control = el('output', 'running-boolean-value');
      const indicator = el('span', 'toggle');
      indicator.dataset.enabled = String(boolean); indicator.setAttribute('aria-hidden', 'true');
      control.append(indicator, el('span', '', boolean ? '已开启' : '已关闭'), el('code', '', JSON.stringify(value)));
      box.append(control);
    } else if (Array.isArray(value) && field?.type === 'platforms' && value.every(item => typeof item === 'string')) {
      control = el('output', 'running-platforms');
      if (!value.length) control.textContent = '[]';
      for (const platform of value) control.append(el('span', 'tag', platform));
      box.append(control);
    } else if (value !== null && typeof value === 'object') {
      control = el('pre', 'running-structured-value', JSON.stringify(value, null, 2));
      control.tabIndex = 0; box.append(control);
    } else {
      const wrap = el('div', 'input-wrap');
      control = el('input', `field-input${field?.secret ? ' field-secret' : ''}${field?.unit && typeof value === 'number' ? ' has-unit' : ''}`);
      control.type = field?.secret ? 'password' : 'text';
      control.readOnly = true; control.autocomplete = 'off'; control.spellcheck = false;
      control.value = value === null ? 'null' : String(value);
      if (value === '') control.placeholder = '空字符串（未设置）';
      wrap.append(control);
      if (field?.unit && typeof value === 'number') wrap.append(el('span', 'input-unit', field.unit));
      if (field?.secret) {
        const reveal = el('button', 'icon-button reveal-button'); reveal.type = 'button';
        reveal.setAttribute('aria-label', `显示${field.label}`); reveal.setAttribute('aria-pressed', 'false'); reveal.append(icon('eye'));
        reveal.addEventListener('click', () => {
          const visible = control.type === 'password'; control.type = visible ? 'text' : 'password';
          reveal.setAttribute('aria-label', `${visible ? '隐藏' : '显示'}${field.label}`); reveal.setAttribute('aria-pressed', String(visible));
        });
        wrap.append(reveal);
      }
      box.append(wrap);
      if (field?.options && typeof value === 'string' && Object.hasOwn(field.options, value)) {
        box.append(el('p', 'running-enum-label', field.options[value]));
      }
    }
    control.id = id; control.setAttribute('aria-describedby', descriptionId);
    if (control.tagName === 'PRE') control.setAttribute('aria-label', field?.label || key);
    return box;
  }

  function renderFields() {
    const query = $('running-search').value.trim().toLowerCase();
    const selected = entries.filter(([key, value]) => {
      const field = fields[key];
      const text = `${key} ${field?.label || ''} ${field?.description || ''} ${field?.secret ? '' : JSON.stringify(value)}`;
      return (category === 'all' || groupOf(key) === category) && text.toLowerCase().includes(query);
    });
    $('running-result-count').textContent = `${selected.length} / ${entries.length} 项参数 · 只读`;
    const list = $('running-field-list'); list.replaceChildren();
    $('running-empty').hidden = selected.length > 0;
    $('running-empty').textContent = entries.length ? '没有匹配的运行参数，试试其他分类或关键词。' : '暂无运行参数';
    for (const group of categories) {
      const values = selected.filter(([key]) => groupOf(key) === group.id);
      if (!values.length) continue;
      const section = el('section', 'running-parameter-group');
      const title = el('h3', 'running-group-title'); title.append(icon(group.icon), el('span', '', group.name), el('span', 'subtle-tag', `${values.length} 项`));
      const grid = el('div', 'fields-grid running-fields');
      for (const [key, value] of values) grid.append(renderField(key, value, entries.findIndex(([name]) => name === key)));
      section.append(title, grid); list.append(section);
    }
  }

  function clear() {
    entries = []; category = 'all';
    $('running-search').value = ''; $('running-source').value = '';
    $('running-config-content').hidden = true;
    $('running-categories').replaceChildren(); $('running-field-list').replaceChildren();
    $('running-result-count').textContent = '';
    selectView('visual');
  }
  return {
    clear,
    render(settings) {
      clear(); entries = Object.entries(settings);
      $('running-source').value = JSON.stringify(settings, null, 2);
      $('running-config-content').hidden = false;
      renderCategories(); renderFields();
    }
  };
}
