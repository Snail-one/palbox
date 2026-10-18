import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes } from '../../frontend/src/ui/format.js';

test('备份大小按 B/KB/MB/GB 自适应显示', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(undefined), '0 B');
  assert.equal(formatBytes(-1), '0 B');
  assert.equal(formatBytes(999), '999 B');
  assert.equal(formatBytes(1024), '1.00 KB');
  assert.equal(formatBytes(3698), '3.61 KB');
  assert.equal(formatBytes(52428), '51.2 KB');
  assert.equal(formatBytes(1024 ** 2), '1.00 MB');
  assert.equal(formatBytes(12.5 * 1024 ** 2), '12.5 MB');
  assert.equal(formatBytes(123 * 1024 ** 2), '123 MB');
  assert.equal(formatBytes(1024 ** 3), '1.00 GB');
});
