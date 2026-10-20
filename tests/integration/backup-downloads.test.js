import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { managementFixture } from '../helpers/management-fixture.js';
import { nativeBackupFixture } from '../helpers/native-backup-fixture.js';
import { BACKUP_CATEGORIES } from '../../backend/management/backup-paths.js';

test('所有世界备份分类按本地时间-Full World-归档世界 ID 下载，归档内容保持一致', async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  await f.manager.ensureConfig();
  await nativeBackupFixture(f.runtime.saved, { worldId: 'SAVED_WORLD' });
  const ids = [];
  const at = new Date('2026-10-18T23:01:02Z');
  for (const category of BACKUP_CATEGORIES) {
    const id = await f.manager.backup(category);
    await utimes(f.manager.backupFile(id), at, at);
    ids.push(id);
  }
  // Downloads must identify the archived world, even after the active world changes.
  await writeFile(path.join(f.runtime.saved, 'Config/LinuxServer/GameUserSettings.ini'), 'DedicatedServerName=CURRENT_WORLD\n');
  for (const id of ids) {
    const response = await f.request('/api/backup?' + new URLSearchParams({ id, timeZone: 'Asia/Shanghai' }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="2026.10.19-07.01.02-Full World-SAVED_WORLD.tar.gz"');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(f.manager.backupFile(id)));
  }
  const utc = await f.request('/api/backup?' + new URLSearchParams({ id: ids[0] }));
  assert.equal(utc.headers.get('content-disposition'), 'attachment; filename="2026.10.18-23.01.02-Full World-SAVED_WORLD.tar.gz"');
  await utc.arrayBuffer();
  const invalid = await f.request('/api/backup?' + new URLSearchParams({ id: ids[0], timeZone: 'invalid-zone' }));
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /时区无效/);
});

test('没有可识别世界的保护备份仍可下载，文件名世界 ID 使用 unknown', async t => {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  await f.manager.ensureConfig();
  const id = await f.manager.backup('before-reset');
  const at = new Date('2026-10-18T23:01:02Z');
  await utimes(f.manager.backupFile(id), at, at);
  const response = await f.request('/api/backup?' + new URLSearchParams({ id, timeZone: 'Asia/Shanghai' }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="2026.10.19-07.01.02-Full World-unknown.tar.gz"');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(f.manager.backupFile(id)));
});
