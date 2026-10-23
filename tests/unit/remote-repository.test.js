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

test('保存收尾期间到达的新修改自动继续提交，flush 等待最后一次确认', async () => {
  const writes = [], releases = [];
  const repository = createRemoteRepository({ workspace: { name: 'old' }, revision: 1, api: {
    request: (route, { body }) => {
      writes.push(body);
      return new Promise(resolve => releases.push(() => resolve({ revision: body.revision + 1 })));
    }
  } });
  repository.save({ name: 'one' });
  await tick();
  releases.shift()();
  let flushed = false, flushing;
  // Run after drain's last loop iteration, before its worker is cleared.
  queueMicrotask(() => {
    repository.save({ name: 'latest' });
    flushing = repository.flush().then(value => { flushed = true; return value; });
  });
  await tick();
  assert.equal(writes.length, 2);
  assert.equal(writes[1].revision, 2);
  assert.equal(writes[1].workspace.name, 'latest');
  assert.equal(flushed, false);
  releases.shift()();
  assert.equal(await flushing, true);
  assert.equal(repository.pending, false);
  assert.equal(repository.load().name, 'latest');
  assert.equal(repository.revision, 3);
});

test('自动保存失败后不循环重试，flush 明确返回失败并允许手动恢复', async () => {
  let calls = 0, fail = true;
  const repository = createRemoteRepository({ workspace: { name: 'old' }, revision: 1, api: {
    request: async () => { calls++; if (fail) throw new Error('offline'); return { revision: 2 }; }
  } });
  repository.save({ name: 'latest' });
  await tick(); await tick();
  assert.equal(calls, 1);
  assert.equal(await repository.flush(), false);
  assert.equal(calls, 2);
  fail = false;
  assert.equal(await repository.flush(), true);
  assert.equal(repository.load().name, 'latest');
});
