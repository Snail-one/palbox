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
  'source-view-dialog', 'source-view-text', 'source-view-description', 'view-profile-source',
  'source-view-close', 'source-view-ok', 'source-view-copy', 'source-view-save', 'source-view-mode',
  'source-view-error', 'new-profile', 'rename-profile', 'copy-profile', 'delete-profile',
  'profile-list', 'profile-count', 'profile-origin'
];

function setup({ failSave = false } = {}) {
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
  const official = { id: 'official', name: '我的帕鲁世界', source: 'OptionSettings=(ExpRate=1)', origin: '官方默认配置（DefaultPalWorldSettings.ini）' };
  const workspace = { active: imported, profiles: [imported, official] };
  const saves = [];
  const panel = createProfilePanel({
    dom,
    workspace,
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
    actions: {}
  });
  panel.render();
  return { elements, rows: elements.get('profile-list').children, saves };
}

test('点击配置名称弹出可编辑源码，保存调用回调并关闭弹窗', async () => {
  const { elements, rows, saves } = setup();
  await rows[0].children[0].fire('click');
  const dialog = elements.get('source-view-dialog');
  const text = elements.get('source-view-text');
  const saveButton = elements.get('source-view-save');
  assert.equal(dialog.open, true);
  assert.equal(text.readOnly, false);
  assert.equal(text.value, 'OptionSettings=(ExpRate=2)');
  assert.equal(saveButton.hidden, false);
  assert.equal(saveButton.disabled, false);
  assert.equal(elements.get('source-view-mode').textContent, 'UTF-8 · 可编辑');
  assert.match(elements.get('source-view-description').textContent, /来源：导入文件：world\.ini/);

  text.value = 'OptionSettings=(ExpRate=5)';
  await saveButton.fire('click');
  assert.deepEqual(saves, [{ id: 'imported', source: 'OptionSettings=(ExpRate=5)' }]);
  assert.equal(dialog.open, false);
  assert.equal(saveButton.disabled, false);
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
  assert.match(elements.get('source-view-description').textContent, /只读/);
  await saveButton.fire('click');
  assert.deepEqual(saves, []);
});

test('保存失败时保留弹窗并显示错误', async () => {
  const { elements, rows } = setup({ failSave: true });
  await rows[0].children[0].fire('click');
  await elements.get('source-view-save').fire('click');
  assert.equal(elements.get('source-view-dialog').open, true);
  assert.equal(elements.get('source-view-error').hidden, false);
  assert.match(elements.get('source-view-error').textContent, /保存失败/);
});
