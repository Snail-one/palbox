import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceService } from '../../frontend/src/application/workspace-service.js';
import template from '../../shared/domain/template.js';

const KEY = 'workspace';
const createRepository = getStorage => ({
  load() { const raw = getStorage().getItem(KEY); return raw == null ? null : JSON.parse(raw); },
  save(value) {
    try { getStorage().setItem(KEY, JSON.stringify(value)); }
    catch { throw new Error('保存失败，请复制配置备份。'); }
  }
});

function setup(initial = null) {
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
  service.removeActive();
  assert.equal(service.active.id, original.id);
  service.removeActive();
  assert.equal(service.profiles.length, 1);
  assert.equal(service.active.source, template);
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

test('损坏的输入基准不能用于覆盖已有记录', () => {
  for (const initialSource of [7, 'OptionSettings=(A="broken)']) {
    const initial = { version: 1, activeId: 'bad', profiles: [{ id: 'bad', name: '损坏', source: template, initialSource }] };
    const { service, data } = setup(initial);
    assert.equal(service.persisted, false);
    assert.throws(() => service.persist());
    assert.equal(data.get(KEY), JSON.stringify(initial));
  }
});
