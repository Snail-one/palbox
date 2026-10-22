import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertNonRoot } from '../../shared/runtime-user.js';

test('真实 UID 或有效 UID 为 0 均拒绝启动', () => {
  for (const [uid, euid] of [[0, 0], [0, 1000], [1000, 0]]) {
    assert.throws(() => assertNonRoot({ getuid: () => uid, geteuid: () => euid }), /禁止以 root/);
  }
});

test('普通用户和没有 Unix UID 接口的平台可以启动', () => {
  assert.doesNotThrow(() => assertNonRoot({ getuid: () => 1000, geteuid: () => 1000 }));
  assert.doesNotThrow(() => assertNonRoot({}));
});
