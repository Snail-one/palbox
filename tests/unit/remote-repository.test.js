import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRemoteRepository } from '../../frontend/src/services/management-api.js';

const tick = () => new Promise(resolve => setImmediate(resolve));

test('远程保存串行提交最新编辑，服务器确认前保持保存中', async () => {
  const writes = [];
  const releases = [];
  const repository = createRemoteRepository({ workspace: { name: 'old' }, revision: 1, api: { request: async (route, { body }) => { writes.push(body); await new Promise(resolve => releases.push(resolve)); return { revision: body.revision + 1 }; } } });
  repository.save({ name: 'one' });
  await tick();
  repository.save({ name: 'two' }); repository.save({ name: 'latest' });
  assert.equal(repository.pending, true); assert.equal(writes.length, 1);
  releases.shift()(); await tick();
  assert.equal(writes.length, 2); assert.equal(writes[1].workspace.name, 'latest'); assert.equal(writes[1].revision, 2);
  releases.shift()(); assert.equal(await repository.flush(), true);
  assert.equal(repository.pending, false); assert.equal(repository.revision, 3);
});

test('保存失败保留最新草稿，冲突不自动覆盖，重试失败后仍可恢复', async () => {
  let fail = true;
  const repository = createRemoteRepository({ workspace: { name: 'old' }, revision: 1, api: { request: async () => { if (fail) throw new Error('revision conflict'); return { revision: 2 }; } } });
  repository.save({ name: 'new' }); await tick();
  assert.equal(repository.error, 'revision conflict'); assert.equal(repository.pending, false);
  assert.equal(repository.load().name, 'old');
  fail = false;
  assert.equal(await repository.flush(), true); assert.equal(repository.error, ''); assert.equal(repository.load().name, 'new');
});
