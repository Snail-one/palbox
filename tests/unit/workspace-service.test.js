import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceService } from '../../src/application/workspace-service.js';
import { createRepository, KEY } from '../../src/services/storage.js';
import template from '../../src/domain/template.js';

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

test('兼容现有 v1 存储键与记录，加载不会覆盖源文件', () => {
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

test('损坏本地记录进入临时空间，禁止后续操作覆盖原始数据', () => {
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
