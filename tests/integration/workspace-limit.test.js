import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { managementFixture } from '../helpers/management-fixture.js';

function fill(workspace, count) {
  const source = workspace.profiles.find(profile => !profile.locked);
  while (workspace.profiles.length < count) {
    const id = `limit-${workspace.profiles.length}`;
    workspace.profiles.push({ ...source, id, name: id });
  }
}

test('配置 API 总数上限为 10，不能通过遗漏游戏默认配置绕过限制', async t => {
  const f = await managementFixture();
  t.after(() => f.close());
  await f.login();
  const initial = f.manager.store.snapshot();
  fill(initial.workspace, 10);
  const saved = await f.request('/api/workspace', { method: 'PUT', body: initial });
  assert.equal(saved.status, 200);
  const baseline = await saved.json();
  const overflow = structuredClone(baseline);
  fill(overflow.workspace, 11);
  const rejected = await f.request('/api/workspace', { method: 'PUT', body: overflow });
  assert.equal(rejected.status, 400);
  assert.match(await rejected.text(), /最多保留 10 套配置/);
  overflow.workspace.profiles = overflow.workspace.profiles.filter(profile => !profile.locked);
  assert.equal(overflow.workspace.profiles.length, 10);
  assert.equal((await f.request('/api/workspace', { method: 'PUT', body: overflow })).status, 400);
  assert.deepEqual(f.manager.store.snapshot(), baseline);
  const reduced = structuredClone(baseline);
  reduced.workspace.profiles.pop();
  assert.equal((await f.request('/api/workspace', { method: 'PUT', body: reduced })).status, 200);
  const next = f.manager.store.snapshot();
  fill(next.workspace, 10);
  assert.equal((await f.request('/api/workspace', { method: 'PUT', body: next })).status, 200);
});

test('旧配置库超过 10 套仍可加载、编辑和逐步删除，但不能继续增加', async t => {
  const f = await managementFixture();
  t.after(() => f.close());
  const legacy = f.manager.store.snapshot();
  fill(legacy.workspace, 12);
  await writeFile(f.manager.store.file, JSON.stringify(legacy));
  await f.manager.store.initialize();
  const editing = f.manager.store.snapshot();
  assert.equal(editing.workspace.profiles.length, 12);
  editing.workspace.profiles[0].name = '旧配置仍可编辑';
  await f.manager.store.update(editing.workspace, editing.revision);
  const overflow = f.manager.store.snapshot();
  fill(overflow.workspace, 13);
  await assert.rejects(f.manager.store.update(overflow.workspace, overflow.revision), /最多保留 10 套配置/);
  const reduced = f.manager.store.snapshot();
  reduced.workspace.profiles.pop();
  await f.manager.store.update(reduced.workspace, reduced.revision);
  assert.equal(f.manager.store.snapshot().workspace.profiles.length, 11);
});
