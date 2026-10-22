import { createFormView } from './components/form.js';
import { createParameterView } from './components/parameters.js';
import { createSourceEditor } from './components/source-editor.js';

export function createEditorPanel({ dom, editor, catalog, ask, notify, onChanged, ready, onViewChanged, workspace }) {
  const { $ } = dom;
  // Navigation/filter state is local to the UI; it never enters saved profiles.
  const view = { group: 'server', mode: 'form', advanced: 'table', search: '', unknownOnly: false, unverifiedOnly: false };
  const form = createFormView({ dom, editor, catalog, view, ask, onChanged, onCategory(group) {
    view.group = group;
    view.search = '';
    $('search').value = '';
    form.renderCategories();
    form.render();
  } });
  const parameters = createParameterView({ dom, editor, catalog, view, ask, onChanged });
  const source = createSourceEditor({ dom, editor, ask, notify, onChanged });

  function render() {
    $('configuration-editor-content').hidden = !workspace.active;
    $('configuration-empty').hidden = Boolean(workspace.active);
    const origin = workspace.active?.origin || '已有配置';
    const hasOfficial = workspace.profiles.some(profile => profile.locked);
    $('source-origin').textContent = `来源：${origin}`;
    $('source-origin').title = origin;
    $('source-file').textContent = hasOfficial ? '输入源码 · DefaultPalWorldSettings.ini' : '输入源码 · PalWorldSettings.ini';
    $('source-editor').readOnly = true;
    $('apply-source').disabled = true;
    $('restore-source').disabled = true;
    $('source-editor').title = '输入源码只读。底层为官方默认配置，请使用可视化编辑、参数列表或导入配置修改参数。';
    $('source-help').textContent = hasOfficial
      ? '所有配置的输入源码只读，底层读取官方默认配置 DefaultPalWorldSettings.ini。请在「可视化编辑」或「参数列表」中修改参数，或使用「导入配置」。'
      : '输入源码只读。安装服务端后以官方默认配置为底，请在「可视化编辑」或「参数列表」中修改参数。';
    $('view-form').hidden = view.mode !== 'form';
    $('view-advanced').hidden = view.mode !== 'advanced';
    $('table-container').hidden = view.advanced !== 'table';
    $('source-container').hidden = view.advanced !== 'source';
    $('output-container').hidden = view.advanced !== 'output';
    for (const mode of ['form', 'advanced']) {
      $('editor-mode-' + mode).classList.toggle('selected', mode === view.mode);
      $('editor-mode-' + mode).setAttribute('aria-pressed', String(mode === view.mode));
    }
    for (const mode of ['table', 'source', 'output']) {
      $('mode-' + mode).classList.toggle('selected', mode === view.advanced);
      $('mode-' + mode).setAttribute('aria-pressed', String(mode === view.advanced));
    }
    form.renderCategories();
    if (view.mode === 'form') form.render();
    else if (view.advanced === 'table') parameters.render();
    else source.render();
  }

  for (const mode of ['form', 'advanced']) $('editor-mode-' + mode).addEventListener('click', () => {
    if (view.mode === mode) return;
    view.mode = mode;
    render();
    onViewChanged(mode);
  });

  for (const mode of ['table', 'source', 'output']) $('mode-' + mode).addEventListener('click', () => {
    if (view.advanced === mode) return;
    // Reading the effective output and returning to the input preserves its draft.
    if (mode === 'table' && !ready()) return;
    view.advanced = mode;
    render();
  });
  $('search').addEventListener('input', () => {
    view.search = $('search').value.trim();
    form.renderCategories();
    if (view.mode === 'form') form.render();
    else parameters.render();
  });
  $('unknown-summary').addEventListener('click', () => {
    if (!ready()) return;
    view.mode = 'advanced';
    view.advanced = 'table';
    view.unknownOnly = true;
    view.unverifiedOnly = false;
    view.search = '';
    $('search').value = '';
    render();
    onViewChanged('advanced');
  });
  for (const [id, key, other] of [['unknown-only', 'unknownOnly', 'unverifiedOnly'], ['unverified-only', 'unverifiedOnly', 'unknownOnly']]) {
    $(id).addEventListener('change', () => {
      view[key] = $(id).checked;
      if (view[key]) view[other] = false;
      parameters.render();
    });
  }
  return { render, setMode(mode) {
    if (view.mode === mode) return;
    view.mode = mode;
    render();
  }, showSource() {
    if (view.mode === 'advanced' && view.advanced === 'source') return;
    view.mode = 'advanced';
    view.advanced = 'source';
    render();
  } };
}
