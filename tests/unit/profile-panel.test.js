import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfilePanel } from '../../frontend/src/ui/profile-panel.js';

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.className = '';
    this.textContent = '';
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.listeners = new Map();
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.readOnly = false;
    this.scrollTop = 0;
    this.open = false;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren() { this.children.length = 0; }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  fire(type) {
    return Promise.all((this.listeners.get(type) || []).map(handler => handler({ target: this })));
  }
  showModal() { this.open = true; }
  close() { this.open = false; this.fire('close'); }
}

const IDS = [
  'source-view-dialog', 'source-view-text', 'source-view-description', 'source-view-title', 'view-profile-source',
  'source-view-close', 'source-view-ok', 'source-view-copy', 'source-view-save', 'source-view-file', 'source-view-mode',
  'source-view-error', 'source-view-switch', 'source-view-tab-import', 'source-view-tab-source', 'source-view-import',
  'source-view-panel', 'source-view-import-description', 'profile-import-drop', 'profile-import-file', 'profile-import-text',
  'profile-import-error', 'profile-import-confirm', 'new-profile', 'rename-profile', 'copy-profile', 'delete-profile',
  'profile-list', 'profile-count', 'profile-origin', 'profile-default-status', 'import-button'
];

function setup({ failSave = false, defaults = { state: 'ready', baselineCurrent: true } } = {}) {
  const imports = [];
  const elements = new Map(IDS.map(id => [id, new FakeElement()]));
  const document = {
    getElementById: id => elements.get(id) ?? null,
    createElement: tag => new FakeElement(tag),
    createElementNS: (_namespace, tag) => new FakeElement(tag)
  };
  const dom = {
    document,
    $: id => document.getElementById(id),
    el: (tag, className, text) => {
      const node = new FakeElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    },
    empty: node => node.replaceChildren(),
    icon: () => new FakeElement('svg')
  };
  const imported = { id: 'imported', name: '二号世界', source: 'OptionSettings=(ExpRate=2)', origin: '导入文件：world.ini' };
  const official = { id: 'official', name: '游戏默认配置', source: 'OptionSettings=(ExpRate=1)', origin: '官方默认配置（DefaultPalWorldSettings.ini）', locked: true };
  official.initialSource = official.source;
  imported.initialSource = official.source;
  const workspace = { active: imported, profiles: [imported, official] };
  const saves = [];
  const panel = createProfilePanel({
    dom,
    workspace,
    getDefaultConfiguration: () => defaults,
    ask: async () => null,
    beforeLeave: async () => true,
    ready: () => true,
    isDirty: () => false,
    clipboard: { write: async () => {} },
    notify: () => {},
    onSaveSource: async (id, source) => {
      if (failSave) throw new Error('保存失败，请复制备份后重试。');
      saves.push({ id, source });
    },
    onImportSource: async (id, source) => {
      if (failSave) throw new Error('保存失败，请复制备份后重试。');
      imports.push({ id, source });
    },
    validate: source => {
      if (!String(source).trim()) throw new Error('配置内容为空。');
      return source;
    },
    actions: {}
  });
  panel.render();
  return { elements, rows: elements.get('profile-list').children, saves, imports, workspace, panel, defaults };
}

test('每套配置显示官方默认同步状态，自定义修改仍为最新，缺项或旧基准显示待同步', () => {
  const { elements, rows, workspace, panel, defaults } = setup();
  const badge = row => row.children[0].children[1].children.find(child => child.className === 'profile-default-status');
  assert.deepEqual(rows.map(row => badge(row).textContent), ['已同步最新默认配置', '已同步最新默认配置']);
  assert.equal(elements.get('profile-default-status').dataset.state, 'current');
  workspace.profiles[0].initialSource = 'OptionSettings=(ExpRate=0.5)';
  panel.render();
  assert.equal(badge(rows[0]).dataset.state, 'pending');
  assert.equal(badge(rows[1]).dataset.state, 'current');
  workspace.profiles[0].initialSource = workspace.profiles[1].initialSource;
  workspace.profiles[0].source = 'OptionSettings=(Extra=1)';
  panel.render();
  assert.equal(badge(rows[0]).dataset.state, 'pending');
  defaults.baselineCurrent = false;
  panel.render();
  assert.deepEqual(rows.map(row => badge(row).dataset.state), ['pending', 'pending']);
});

test('官方文件缺失或不可读时，即使保留了缓存配置也不能标记为最新', () => {
  for (const state of ['missing', 'unavailable', 'unknown']) {
    const { rows, elements } = setup({ defaults: { state, baselineCurrent: true } });
    for (const row of rows) {
      const badge = row.children[0].children[1].children.find(child => child.className === 'profile-default-status');
      assert.equal(badge.dataset.state, 'unknown');
      assert.doesNotMatch(badge.textContent, /已同步/);
    }
    assert.equal(elements.get('profile-default-status').dataset.state, 'unknown');
  }
});

test('达到 10 套配置后禁用新建、导入和副本，删除后恢复', () => {
  const { elements, workspace, panel } = setup();
  while (workspace.profiles.length < 10) workspace.profiles.push({ ...workspace.profiles[0], id: `extra-${workspace.profiles.length}` });
  panel.render();
  for (const id of ['new-profile', 'copy-profile', 'import-button']) {
    assert.equal(elements.get(id).disabled, true);
    assert.match(elements.get(id).title, /10 套配置/);
  }
  for (const row of elements.get('profile-list').children) {
    assert.equal(row.children[1].children.find(button => button.dataset.profileAction === 'duplicate').disabled, true);
  }
  workspace.profiles.pop();
  panel.render();
  for (const id of ['new-profile', 'copy-profile', 'import-button']) assert.equal(elements.get(id).disabled, false);
});

test('点击配置名称弹出只读源码，不能直接保存源码', async () => {
  const { elements, rows, saves } = setup();
  await rows[0].children[0].fire('click');
  const dialog = elements.get('source-view-dialog');
  const text = elements.get('source-view-text');
  const saveButton = elements.get('source-view-save');
  assert.equal(dialog.open, true);
  assert.equal(text.readOnly, true);
  assert.equal(text.value, 'OptionSettings=(ExpRate=2)');
  assert.equal(saveButton.hidden, true);
  assert.equal(saveButton.disabled, true);
  assert.equal(elements.get('source-view-mode').textContent, 'UTF-8 · 只读');
  assert.equal(elements.get('source-view-file').textContent, '输入源码 · DefaultPalWorldSettings.ini');
  assert.match(elements.get('source-view-description').textContent, /来源：导入文件：world\.ini/);
  assert.match(elements.get('source-view-description').textContent, /只读/);

  text.value = 'OptionSettings=(ExpRate=5)';
  await saveButton.fire('click');
  assert.deepEqual(saves, []);
  assert.equal(dialog.open, true);
});

test('官方默认配置来源的弹窗只读且不会调用保存回调', async () => {
  const { elements, rows, saves } = setup();
  await rows[1].children[0].fire('click');
  const text = elements.get('source-view-text');
  const saveButton = elements.get('source-view-save');
  assert.equal(elements.get('source-view-dialog').open, true);
  assert.equal(text.readOnly, true);
  assert.equal(saveButton.hidden, true);
  assert.equal(saveButton.disabled, true);
  assert.equal(elements.get('source-view-mode').textContent, 'UTF-8 · 只读');
  assert.equal(elements.get('source-view-file').textContent, '输入源码 · DefaultPalWorldSettings.ini');
  assert.match(elements.get('source-view-description').textContent, /不可修改|只读/);
  assert.equal(elements.get('source-view-title').textContent, '查看源配置');
  assert.equal(elements.get('source-view-import').hidden, true);
  await elements.get('source-view-tab-import').fire('click');
  assert.equal(elements.get('source-view-title').textContent, '导入配置');
  assert.equal(elements.get('source-view-import').hidden, false);
  assert.equal(elements.get('source-view-panel').hidden, true);
  assert.match(elements.get('source-view-import-description').textContent, /游戏默认配置/);
  assert.match(elements.get('source-view-import-description').textContent, /REST API 保持开启/);
  await saveButton.fire('click');
  assert.deepEqual(saves, []);
  const tools = rows[1].children[1];
  assert.equal(tools.children[0].disabled, false);
  assert.equal(tools.children[0].children[1].textContent, '选择');
  assert.deepEqual(tools.children.map(button => button.dataset.profileAction), ['select', 'duplicate']);
});

test('导入配置覆盖当前条目，失败时保留弹窗', async () => {
  const { elements, rows, imports } = setup();
  await rows[1].children[0].fire('click');
  await elements.get('source-view-tab-import').fire('click');
  elements.get('profile-import-text').value = 'OptionSettings=(ExpRate=8)';
  await elements.get('profile-import-confirm').fire('click');
  assert.deepEqual(imports, [{ id: 'official', source: 'OptionSettings=(ExpRate=8)' }]);
  assert.equal(elements.get('source-view-dialog').open, false);

  const failed = setup({ failSave: true });
  await failed.rows[1].children[0].fire('click');
  await failed.elements.get('source-view-tab-import').fire('click');
  failed.elements.get('profile-import-text').value = 'OptionSettings=(ExpRate=8)';
  await failed.elements.get('profile-import-confirm').fire('click');
  assert.equal(failed.elements.get('source-view-dialog').open, true);
  assert.equal(failed.elements.get('profile-import-error').hidden, false);
  assert.match(failed.elements.get('profile-import-error').textContent, /保存失败/);
  assert.deepEqual(failed.imports, []);
});

test('只读源码不会因为保存失败写入配置', async () => {
  const { elements, rows, saves } = setup({ failSave: true });
  await rows[0].children[0].fire('click');
  await elements.get('source-view-save').fire('click');
  assert.equal(elements.get('source-view-dialog').open, true);
  assert.equal(elements.get('source-view-error').hidden, true);
  assert.deepEqual(saves, []);
});

test('没有官方配置时只显示灰色禁用入口，保留新建和导入', () => {
  const { elements, workspace, panel } = setup();
  workspace.profiles = []; workspace.active = undefined;
  panel.render();
  const rows = elements.get('profile-list').children;
  assert.equal(rows.length, 1);
  assert.match(rows[0].className, /unavailable/);
  assert.equal(rows[0].attributes['aria-disabled'], 'true');
  assert.equal(rows[0].children[0].disabled, true);
  assert.equal(elements.get('new-profile').disabled, false);
  assert.equal(elements.get('import-button').disabled, false);
  assert.equal(elements.get('copy-profile').disabled, true);
  assert.equal(elements.get('view-profile-source').disabled, true);
  assert.equal(workspace.profiles.length, 0);
});
