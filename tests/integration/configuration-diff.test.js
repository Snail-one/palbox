import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse, serialize } from '../../shared/domain/config.js';
import { managementFixture } from '../helpers/management-fixture.js';

test('配置差异要求登录，按需读取且不调用游戏接口，应用后差异清空', async t => {
  const f = await managementFixture(); t.after(() => f.close());
  assert.equal((await f.request('/api/configuration-diff', { authenticated: false })).status, 401);
  await f.login(); await f.task('install'); await f.task('start');
  const snapshot = f.manager.store.snapshot();
  const active = snapshot.workspace.profiles.find(profile => profile.id === snapshot.workspace.activeId);
  active.source = serialize(parse(active.source), new Map([['ExpRate', '2.5']]));
  await f.manager.store.update(snapshot.workspace, snapshot.revision);
  const before = await readFile(f.runtime.config, 'utf8');
  const rest = f.runtime.rest;
  f.runtime.rest = () => { throw new Error('不应请求游戏接口'); };
  let value;
  try {
    const response = await f.request('/api/configuration-diff');
    assert.equal(response.status, 200);
    value = await response.json();
    assert.equal(value.running, true);
    assert.deepEqual(value.changes.map(change => change.key), ['ExpRate']);
    assert.equal(value.changes[0].runningValue, '1.000000');
    assert.equal(value.changes[0].desiredValue, '2.500000');
    assert.equal(await readFile(f.runtime.config, 'utf8'), before);
  } finally { f.runtime.rest = rest; }
  const applied = await f.task('apply', { revision: value.revision, profileId: active.id });
  assert.equal(applied.state, 'succeeded');
  const latest = await (await f.request('/api/configuration-diff')).json();
  assert.deepEqual(latest.changes, []);
  assert.equal(latest.formatOnly, false);
});
