import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNavigation } from '../../frontend/src/ui/navigation.js';

class Element {
  constructor() {
    this.hidden = false;
    this.attributes = new Map();
    this.dataset = {};
    this.listeners = new Map();
    this.links = [];
    const classes = new Set();
    this.classList = {
      contains: name => classes.has(name),
      remove: name => classes.delete(name),
      toggle: (name, active) => active ? classes.add(name) : classes.delete(name)
    };
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  querySelectorAll() { return this.links; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  focus() { this.focused = true; }
}

function setup(hash = '#game') {
  const elements = new Map();
  const $ = id => {
    if (id === 'login-logs-navigation') return null;
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const links = [];
  for (const [page, views] of [
    ['game', [['overview', 'game-overview'], ['players', 'game-players-view']]],
    ['saves', [['native', 'saves-native'], ['archives', 'saves-archives']]],
    ['configuration', [['editor', 'configuration-editor'], ['profiles', 'configuration-profiles']]]
  ]) {
    $(`${page}-navigation`).links = views.map(([view, target]) => {
      const link = new Element();
      link.dataset.view = view;
      link.setAttribute('aria-controls', target);
      links.push(link);
      return link;
    });
  }
  const document = {
    activeElement: { tagName: 'DIV' },
    querySelector: selector => selector === '.skip-link' ? $('skip-link') : null,
    querySelectorAll: () => links,
    addEventListener: (name, callback) => $('document').addEventListener(name, callback)
  };
  const window = {
    location: { hash },
    addEventListener: (name, callback) => $('window').addEventListener(name, callback),
    scrollTo() {}
  };
  const modes = [];
  let saves = 0;
  createNavigation({ dom: { $, document }, window, isDirty: () => false, onSave: () => saves++, onConfigurationView: mode => modes.push(mode) });
  return {
    $, document, window, modes, get saves() { return saves; },
    go(hash) { window.location.hash = hash; $('window').listeners.get('hashchange')(); },
    key(event) { $('document').listeners.get('keydown')(event); }
  };
}

test('官方与手动备份可独立进入，切换时仅显示对应页面并更新导航', () => {
  const app = setup('#saves');
  assert.equal(app.$('saves-page').hidden, false);
  assert.equal(app.$('saves-native').hidden, false);
  assert.equal(app.$('saves-archives').hidden, true);
  assert.equal(app.$('game-page').hidden, true);
  assert.equal(app.$('configuration-page').hidden, true);
  assert.equal(app.$('configuration-actions').hidden, true);
  assert.equal(app.$('nav-saves').getAttribute('aria-current'), 'page');
  assert.equal(app.$('saves-navigation').links[0].getAttribute('aria-current'), 'page');
  assert.equal(app.document.title, 'PalBox · 存档管理 · 官方备份');
  assert.equal(app.$('main').getAttribute('aria-label'), '官方备份');
  assert.equal(app.$('game-actions').hidden, false);
  app.go('#saves/archives');
  assert.equal(app.$('saves-native').hidden, true);
  assert.equal(app.$('saves-archives').hidden, false);
  assert.equal(app.$('saves-navigation').links[0].hasAttribute('aria-current'), false);
  assert.equal(app.$('saves-navigation').links[1].getAttribute('aria-current'), 'page');
  assert.equal(app.document.title, 'PalBox · 存档管理 · 手动备份');
  app.go('#saves');
  assert.equal(app.$('saves-native').hidden, false);
  assert.equal(app.$('saves-archives').hidden, true);
});

test('直接加载手动备份地址可恢复子页面，旧存档管理地址仍可访问官方备份', () => {
  const direct = setup('#saves/archives');
  assert.equal(direct.$('saves-archives').hidden, false);
  assert.equal(direct.$('saves-native').hidden, true);
  const legacy = setup('#game/saves');
  assert.equal(legacy.$('saves-page').hidden, false);
  assert.equal(legacy.$('saves-native').hidden, false);
  assert.equal(legacy.$('game-page').hidden, true);
});

test('存档页面与游戏、配置页面互不混用，保存快捷键只作用于配置', () => {
  const app = setup('#saves/archives');
  const event = { ctrlKey: true, key: 's', preventDefault() {} };
  app.key(event);
  assert.equal(app.saves, 0);
  app.go('#configuration/advanced');
  assert.equal(app.$('saves-page').hidden, true);
  assert.equal(app.$('saves-archives').hidden, true);
  assert.equal(app.$('configuration-editor').hidden, false);
  assert.equal(app.$('configuration-actions').hidden, false);
  assert.equal(app.$('game-actions').hidden, false);
  assert.equal(app.$('configuration-apply').hidden, false);
  assert.deepEqual(app.modes, ['advanced']);
  app.key(event);
  assert.equal(app.saves, 1);
  app.go('#configuration/profiles');
  assert.equal(app.$('configuration-apply').hidden, true);
  app.go('#game/players');
  assert.equal(app.$('game-players-view').hidden, false);
  assert.equal(app.$('game-overview').hidden, true);
  assert.equal(app.$('game-actions').hidden, false);
  assert.equal(app.$('configuration-page').hidden, true);
  assert.equal(app.$('nav-saves').hasAttribute('aria-current'), false);
  app.go('#game');
  assert.equal(app.$('game-overview').hidden, false);
  assert.equal(app.$('game-actions').hidden, false);
  assert.equal(app.$('configuration-actions').hidden, true);
});

test('登录日志有独立导航，直接进入和前后切换不混用游戏或配置页面', () => {
  const app = setup('#login-logs');
  assert.equal(app.document.title, 'PalBox · 登录日志');
  assert.equal(app.$('login-logs-page').hidden, false);
  assert.equal(app.$('main').getAttribute('aria-label'), '登录日志');
  for (const page of ['game', 'saves', 'configuration']) assert.equal(app.$(`${page}-page`).hidden, true);
  assert.equal(app.$('nav-login-logs').getAttribute('aria-current'), 'page');
  assert.equal(app.$('configuration-actions').hidden, true);
  assert.equal(app.$('game-actions').hidden, false);
  app.go('#configuration');
  assert.equal(app.$('login-logs-page').hidden, true);
  assert.equal(app.$('nav-login-logs').hasAttribute('aria-current'), false);
  app.go('#login-logs');
  assert.equal(app.$('login-logs-page').hidden, false);
  assert.equal(app.$('configuration-apply').hidden, true);
});
