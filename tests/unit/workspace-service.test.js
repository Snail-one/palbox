import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceService } from '../../frontend/src/application/workspace-service.js';
import { createProfile, OFFICIAL_DEFAULT_ORIGIN } from '../../shared/domain/workspace.js';
import template from '../../shared/domain/template.js';
import { parse, MAX_CONFIGURATION_SOURCE_LENGTH } from '../../shared/domain/config.js';
import { EditorSession } from '../../shared/domain/editor-session.js';

const KEY = 'workspace';
const createRepository = getStorage => ({
  load() { const raw = getStorage().getItem(KEY); return raw == null ? null : JSON.parse(raw); },
  save(value) {
    try { getStorage().setItem(KEY, JSON.stringify(value)); }
    catch { throw new Error('保存失败，请复制配置备份。'); }
  }
});

function setup(initial = { version: 1, activeId: 'initial', profiles: [{ id: 'initial', name: '我的帕鲁世界', source: template, initialSource: template }] }) {
  const data = new Map(initial === null ? [] : [[KEY, JSON.stringify(initial)]]);
  let fail = false;
  const storage = {
    getItem: key => data.get(key) ?? null,
    setItem(key, value) {
      if (fail) throw new Error('QuotaExceededError');
      data.set(key, value);
    }
  };
  let sequence = 0;
  const service = new WorkspaceService({ repository: createRepository(() => storage), template, id: () => `p-${++sequence}`, now: () => '2026-10-17T00:00:00Z' });
  return { service, data, storage, fail: () => { fail = true; } };
}

test('普通 HTTP 页面没有 randomUUID 时仍生成配置编号', t => {
  const original = globalThis.crypto.randomUUID;
  globalThis.crypto.randomUUID = undefined;
  t.after(() => { globalThis.crypto.randomUUID = original; });
  const profile = createProfile('配置', 'OptionSettings=(ExpRate=1)');
  assert.match(profile.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('兼容现有 v1 工作空间记录，加载不会覆盖源文件', () => {
  const old = { version: 1, activeId: 'old', profiles: [{ id: 'old', name: '旧配置', source: '; keep\n' + template, updatedAt: '2026-01-01' }] };
  const { service, data } = setup(old);
  assert.equal(service.active.id, 'old');
  assert.equal(service.active.source, old.profiles[0].source);
  assert.equal(data.get(KEY), JSON.stringify(old));
});

test('新建、复制、重命名、切换与删除通过工作空间服务完成', () => {
  const { service } = setup();
  const original = service.active;
  const copy = service.add('副本', original.source.replace('ExpRate=1.000000', 'ExpRate=2'));
  assert.equal(service.profiles.length, 2);
  service.rename('新名称');
  assert.equal(service.persist(), true);
  assert.equal(service.active.name, '新名称');
  service.select(original.id);
  assert.equal(service.active.source, template);
  service.select(copy.id);
  service.remove();
  assert.equal(service.active.id, original.id);
  service.remove();
  assert.equal(service.profiles.length, 0);
  assert.equal(service.active, undefined);
});

test('最多添加 10 套配置，拒绝超限时不改变选择与内容，删除后可添加', () => {
  const { service } = setup();
  while (service.profiles.length < 10) service.add(`配置 ${service.profiles.length}`, template, { select: false });
  const before = structuredClone(service.profiles);
  const activeId = service.active.id;
  assert.throws(() => service.add('超限配置'), /最多保留 10 套配置/);
  assert.deepEqual(service.profiles, before);
  assert.equal(service.active.id, activeId);
  service.remove(service.profiles.at(-1).id);
  service.add('恢复添加', template, { select: false });
  assert.equal(service.profiles.length, 10);
});

test('可更新任意配置的源码并保留输入基准', () => {
  const { service } = setup();
  const active = service.active;
  const copy = service.add('副本', template, { select: false, origin: '复制自「我的帕鲁世界」' });
  const baseline = copy.initialSource;
  const next = template.replace('ExpRate=1.000000', 'ExpRate=3');
  assert.equal(service.updateSource(copy.id, next), true);
  assert.equal(service.active.id, active.id);
  assert.equal(service.profiles.find(profile => profile.id === copy.id).source, next);
  assert.equal(copy.initialSource, baseline);
  assert.throws(() => service.updateSource(copy.id, 'not a config'), /配置内容为空|未找到目标段落/);
  assert.equal(service.profiles.find(profile => profile.id === copy.id).source, next);
});

test('新建配置可记录来源并在保存后保留', () => {
  const { service, data } = setup();
  const profile = service.add('来源配置', template, { select: false, origin: '导入文件：world.ini' });
  assert.equal(profile.origin, '导入文件：world.ini');
  assert.equal(service.persist(), true);
  const saved = JSON.parse(data.get(KEY));
  assert.equal(saved.profiles.find(candidate => candidate.id === profile.id).origin, '导入文件：world.ini');
});

test('导入以游戏默认为基准创建独立配置，差异标记和恢复基准跨保存与加载保留', () => {
  const { service, storage } = setup();
  const original = structuredClone(service.active);
  const defaults = 'OptionSettings=(ServerName="Default",ExpRate=1,RESTAPIEnabled=True,AdminPassword="managed")';
  const imported = service.importConfiguration('导入世界', 'OptionSettings=(ExpRate=3,Future=(X,Y))', defaults, { origin: '导入文件：world.ini' });
  assert.equal(service.profiles.length, 2);
  assert.deepEqual(service.profiles[0], original);
  assert.equal(service.active.id, imported.id);
  assert.equal(imported.locked, undefined);
  assert.equal(imported.origin, '导入文件：world.ini');
  const values = new Map(parse(imported.source).entries.map(({ key, raw }) => [key, raw]));
  assert.equal(values.get('ExpRate'), '3');
  assert.equal(values.get('AdminPassword'), '"managed"');
  assert.equal(values.get('RESTAPIEnabled'), 'True');
  assert.equal(values.get('Future'), '(X,Y)');
  assert.equal(imported.initialSource, defaults);
  const editor = new EditorSession(imported.source, { baselineSource: imported.initialSource });
  assert.deepEqual(editor.changedKeys(), ['ExpRate', 'Future']);
  assert.equal(editor.restoreField('ExpRate'), true);
  assert.equal(editor.raw('ExpRate'), '1');
  service.persist();
  const restored = new WorkspaceService({ repository: createRepository(() => storage), template });
  assert.equal(restored.initialSource, defaults);
  assert.equal(restored.active.source, imported.source);
  restored.saveSource(restored.initialSource);
  assert.equal(restored.active.source, defaults);
  assert.deepEqual(restored.profiles[0], original);
});

test('导入修改覆盖当前配置的同名参数，保持 REST 开启且不采用导入密码', () => {
  const source = 'OptionSettings=(ServerName="当前",ExpRate=1,RESTAPIEnabled=False,AdminPassword="kept-secret",DayTimeSpeedRate=1)';
  const { service } = setup({ version: 1, activeId: 'initial', profiles: [{ id: 'initial', name: '我的帕鲁世界', source, initialSource: source }] });
  const merged = service.mergeImportedChanges('initial', 'OptionSettings=(RESTAPIEnabled=False,AdminPassword="imported-secret",ExpRate=8)');
  const values = new Map(parse(merged).entries.map(({ key, raw }) => [key, raw]));
  assert.equal(values.get('RESTAPIEnabled'), 'True');
  assert.equal(values.get('AdminPassword'), '"kept-secret"');
  assert.notEqual(values.get('AdminPassword'), '"imported-secret"');
  assert.equal(values.get('ExpRate'), '8');
  assert.equal(values.get('ServerName'), '"当前"');
  assert.equal(values.get('DayTimeSpeedRate'), '1');
  assert.equal(service.active.id, 'initial');
  assert.equal(service.active.source, source);
  assert.equal(service.profiles.length, 1);
});

test('文件和粘贴导入不采用导入的 REST API 开关和管理员密码', () => {
  const { service } = setup();
  const defaults = 'OptionSettings=(ServerName="Default",ExpRate=1,RESTAPIEnabled=True,AdminPassword="managed")';
  const imported = service.importConfiguration('覆盖管理项', 'OptionSettings=(RESTAPIEnabled=False,AdminPassword="imported-secret",ExpRate=8)', defaults);
  const values = new Map(parse(imported.source).entries.map(({ key, raw }) => [key, raw]));
  assert.equal(values.get('RESTAPIEnabled'), 'True');
  assert.equal(values.get('AdminPassword'), '"managed"');
  assert.notEqual(values.get('AdminPassword'), '"imported-secret"');
  assert.equal(values.get('ExpRate'), '8');
  assert.equal(values.get('ServerName'), '"Default"');
});

test('导入语法错误或配置数量超限时不新增配置或改变当前选择', () => {
  const { service } = setup();
  assert.throws(() => service.importConfiguration('错误', 'OptionSettings=(A=1,A=2)', template));
  assert.throws(() => service.importConfiguration('错误默认', 'OptionSettings=(A=1)', 'invalid'));
  assert.equal(service.profiles.length, 1);
  while (service.profiles.length < 10) service.add('其他配置', template, { select: false });
  const before = structuredClone(service.profiles);
  const activeId = service.active.id;
  assert.throws(() => service.importConfiguration('超限', 'OptionSettings=(A=1)', template), /最多保留/);
  assert.deepEqual(service.profiles, before);
  assert.equal(service.active.id, activeId);
});

test('合并后超过服务端保存上限时保留当前配置，不能先添加再保存失败', () => {
  const { service, data } = setup();
  const before = structuredClone(service.profiles);
  const activeId = service.active.id;
  const saved = data.get(KEY);
  const defaults = 'OptionSettings=(DefaultOnly="' + 'x'.repeat(MAX_CONFIGURATION_SOURCE_LENGTH - 100) + '")';
  const imported = 'OptionSettings=(ImportedOnly="' + 'y'.repeat(100) + '")';
  assert.ok(defaults.length < MAX_CONFIGURATION_SOURCE_LENGTH);
  assert.ok(imported.length < MAX_CONFIGURATION_SOURCE_LENGTH);
  assert.throws(() => service.importConfiguration('合并超限', imported, defaults), /合并后的配置内容过长/);
  assert.deepEqual(service.profiles, before);
  assert.equal(service.active.id, activeId);
  assert.equal(data.get(KEY), saved);
  assert.equal(service.persisted, true);
});

test('保存失败回滚已保存源文件，不影响可供复制的编辑结果', () => {
  const { service, data, fail } = setup();
  const before = service.active.source;
  const saved = data.get(KEY);
  fail();
  assert.equal(service.saveSource(before.replace('ExpRate=1.000000', 'ExpRate=3')), false);
  assert.equal(service.active.source, before);
  assert.equal(data.get(KEY), saved);
  assert.equal(service.persisted, false);
  assert.match(service.message, /复制/);
});

test('空配置库不会自动创建配置，删除最后一条后保持为空', () => {
  const { service, data } = setup({ version: 1, activeId: null, profiles: [] });
  assert.equal(service.active, undefined);
  assert.equal(service.initialSource, undefined);
  assert.equal(service.profiles.length, 0);
  const created = service.add('手动新建', 'OptionSettings=(ServerName="Manual")');
  assert.equal(service.active.id, created.id);
  service.remove(created.id);
  service.persist();
  assert.deepEqual(JSON.parse(data.get(KEY)), { version: 1, activeId: null, profiles: [] });
});

test('列表可按 ID 管理其他配置，复制、重命名和删除均保留当前选择', () => {
  const { service, data } = setup();
  const current = service.active;
  const source = 'OptionSettings=(ServerName="Other",ExpRate=3)';
  const other = service.add('其他配置', source, { select: false });
  assert.equal(service.active.id, current.id);
  service.rename('列表重命名', other.id);
  assert.equal(other.name, '列表重命名');
  assert.equal(current.name, '我的帕鲁世界');
  const copy = service.add('其他配置副本', other.source, { select: false });
  assert.equal(copy.source, source);
  assert.equal(copy.initialSource, source);
  service.remove(other.id);
  assert.equal(service.active.id, current.id);
  assert.equal(service.active.source, current.source);
  assert.deepEqual(service.profiles.map(profile => profile.id), [current.id, copy.id]);
  assert.equal(service.persist(), true);
  const saved = JSON.parse(data.get(KEY));
  assert.equal(saved.activeId, current.id);
  assert.equal(saved.profiles[1].source, source);
  assert.throws(() => service.rename('不存在', 'missing'), /不存在/);
  assert.throws(() => service.remove('missing'), /不存在/);
  service.remove(current.id);
  assert.equal(service.active.id, copy.id);
  service.remove(copy.id);
  assert.equal(service.profiles.length, 0);
  assert.equal(service.active, undefined);
});

test('损坏的仓库记录进入临时空间，禁止后续操作覆盖原始数据', () => {
  const data = new Map([[KEY, '{broken']]);
  const repository = createRepository(() => ({ getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) }));
  const service = new WorkspaceService({ repository, template });
  assert.equal(service.active.source, template);
  assert.equal(service.persisted, false);
  service.add('临时配置');
  assert.throws(() => service.persist());
  assert.equal(data.get(KEY), '{broken');
  assert.throws(() => service.saveSource('OptionSettings=(A=1)'));
  assert.equal(service.active.source, template);
});

test('仓库实现和身份生成可独立替换，无浏览器 API 依赖', () => {
  let snapshot = null;
  const repository = { load: () => null, save: value => { snapshot = structuredClone(value); } };
  const service = new WorkspaceService({ repository, template, id: () => 'injected', now: () => 'fixed-time' });
  assert.equal(service.profiles.length, 0);
  service.add('手动创建');
  service.persist();
  assert.equal(service.active.id, 'injected');
  assert.equal(snapshot.profiles[0].updatedAt, 'fixed-time');
  assert.throws(() => service.select('missing'), /不存在/);
  assert.throws(() => service.add('broken', 'OptionSettings=("'));
  assert.equal(service.profiles.length, 1);
});

test('输入基准跨连续保存与重新加载保留，复制配置使用独立基准', () => {
  const { service, storage } = setup();
  const input = '; 原始配置\r\n[/Script/Pal.PalGameWorldSettings]\r\nOptionSettings=(ExpRate=2,Future=(A=1,B="中文"))\r\n';
  const imported = service.add('导入', input);
  service.persist();
  service.saveSource(input.replace('ExpRate=2', 'ExpRate=3'));
  service.saveSource('OptionSettings=(ExpRate=4,New=5)');
  assert.equal(service.initialSource, input);
  const restored = new WorkspaceService({ repository: createRepository(() => storage), template });
  assert.equal(restored.initialSource, input);
  assert.equal(restored.saveSource(restored.initialSource), true);
  assert.equal(restored.active.source, input);
  assert.equal(restored.active.id, imported.id);
  const copy = service.add('副本', 'OptionSettings=(ExpRate=4,New=5)');
  assert.equal(service.initialSource, copy.source);
  service.select(imported.id);
  assert.equal(service.initialSource, input);
});

test('旧配置首次保存前捕获输入基准，保存失败与重试不会覆盖基准', () => {
  const old = { version: 1, activeId: 'old', profiles: [{ id: 'old', name: '旧配置', source: 'OptionSettings=(ExpRate=2)', updatedAt: '2026-01-01' }] };
  const { service, data, fail } = setup(old);
  assert.equal(service.initialSource, old.profiles[0].source);
  assert.equal(data.get(KEY), JSON.stringify(old));
  service.saveSource('OptionSettings=(ExpRate=3)');
  assert.equal(service.initialSource, old.profiles[0].source);
  fail();
  assert.equal(service.saveSource('OptionSettings=(ExpRate=4)'), false);
  assert.equal(service.active.source, 'OptionSettings=(ExpRate=3)');
  assert.equal(service.initialSource, old.profiles[0].source);
  const loaded = new WorkspaceService({ repository: { load: () => JSON.parse(data.get(KEY)) }, template });
  assert.equal(loaded.initialSource, old.profiles[0].source);
});

test('有官方默认配置时，保存参数仍以该默认文件为恢复基准', () => {
  const official = 'OptionSettings=(ServerName="Default",ExpRate=1,RESTAPIEnabled=True,AdminPassword="managed")';
  const custom = official.replace('ExpRate=1', 'ExpRate=4');
  const { service } = setup({
    version: 1,
    activeId: 'editable',
    profiles: [
      { id: 'editable', name: '我的世界', source: custom, initialSource: custom, updatedAt: '2026-01-01' },
      { id: 'locked', name: '游戏默认配置', source: official, initialSource: official, updatedAt: '2026-01-01', origin: OFFICIAL_DEFAULT_ORIGIN, locked: true }
    ]
  });
  assert.equal(service.updateSource('editable', custom.replace('ExpRate=4', 'ExpRate=6')), true);
  assert.equal(service.profiles.find(profile => profile.id === 'editable').initialSource, official);
  assert.match(service.profiles.find(profile => profile.id === 'editable').source, /ExpRate=6/);
  assert.equal(service.profiles.find(profile => profile.id === 'locked').initialSource, official);
});

test('游戏默认配置可选择并修改参数，但不能重命名或删除', () => {
  const lockedSource = 'OptionSettings=(ExpRate=1)';
  const initial = {
    version: 1,
    activeId: 'editable',
    profiles: [
      { id: 'editable', name: '我的世界', source: 'OptionSettings=(ExpRate=2)', initialSource: 'OptionSettings=(ExpRate=2)', updatedAt: '2026-01-01' },
      { id: 'locked', name: '游戏默认配置', source: lockedSource, initialSource: lockedSource, updatedAt: '2026-01-01', origin: OFFICIAL_DEFAULT_ORIGIN, locked: true }
    ]
  };
  const { service, data } = setup(initial);
  service.select('locked');
  assert.equal(service.active.id, 'locked');
  assert.equal(service.updateSource('locked', 'OptionSettings=(ExpRate=9)'), true);
  const locked = service.profiles.find(profile => profile.id === 'locked');
  assert.equal(locked.source, 'OptionSettings=(ExpRate=9)');
  assert.equal(locked.initialSource, lockedSource);
  assert.equal(JSON.parse(data.get(KEY)).profiles.find(profile => profile.id === 'locked').source, 'OptionSettings=(ExpRate=9)');
  assert.throws(() => service.rename('改名', 'locked'), /不能重命名/);
  assert.throws(() => service.remove('locked'), /不能删除/);
  assert.equal(service.active.id, 'locked');
});

test('删除最后一个可编辑配置时保留并选中游戏默认配置', () => {
  const lockedSource = 'OptionSettings=(ExpRate=1)';
  const initial = {
    version: 1,
    activeId: 'editable',
    profiles: [
      { id: 'editable', name: '我的世界', source: 'OptionSettings=(ExpRate=2)', initialSource: 'OptionSettings=(ExpRate=2)', updatedAt: '2026-01-01' },
      { id: 'locked', name: '游戏默认配置', source: lockedSource, initialSource: lockedSource, updatedAt: '2026-01-01', origin: OFFICIAL_DEFAULT_ORIGIN, locked: true }
    ]
  };
  const { service } = setup(initial);
  service.remove('editable');
  assert.equal(service.profiles.length, 1);
  assert.equal(service.profiles[0].id, 'locked');
  assert.equal(service.active.id, 'locked');
  assert.equal(service.active.source, lockedSource);
  assert.equal(service.active.origin, OFFICIAL_DEFAULT_ORIGIN);
  assert.equal(service.persisted, false);
});

test('游戏默认配置存在时删除最后一个可编辑配置不会新建副本', () => {
  const initial = {
    version: 1,
    activeId: 'editable',
    profiles: [
      { id: 'editable', name: '我的世界', source: 'OptionSettings=(ExpRate=2)', initialSource: 'OptionSettings=(ExpRate=2)', updatedAt: '2026-01-01' },
      { id: 'locked', name: '游戏默认配置', source: 'OptionSettings=(ExpRate=1)', initialSource: 'OptionSettings=(ExpRate=1)', updatedAt: '2026-01-01', origin: OFFICIAL_DEFAULT_ORIGIN, locked: true }
    ]
  };
  const { service } = setup(initial);
  service.remove('editable', { fallbackSource: 'OptionSettings=(ExpRate=9)', fallbackOrigin: '基于官方默认配置（DefaultPalWorldSettings.ini）' });
  assert.equal(service.profiles.length, 1);
  assert.equal(service.active.id, 'locked');
  assert.equal(service.active.source, 'OptionSettings=(ExpRate=1)');
  assert.equal(service.profiles.some(profile => profile.source.includes('ExpRate=9')), false);
});

test('损坏的输入基准不能用于覆盖已有记录', () => {
  for (const initialSource of [7, 'OptionSettings=(A="broken)']) {
    const initial = { version: 1, activeId: 'bad', profiles: [{ id: 'bad', name: '损坏', source: template, initialSource }] };
    const { service, data } = setup(initial);
    assert.equal(service.persisted, false);
    assert.throws(() => service.persist());
    assert.equal(data.get(KEY), JSON.stringify(initial));
  }
});
