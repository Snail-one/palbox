import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { managementFixture } from '../helpers/management-fixture.js';
import { nativeBackupFixture } from '../helpers/native-backup-fixture.js';
import { MAX_CONFIGURATION_SOURCE_LENGTH } from '../../shared/domain/config.js';

async function fixture(t, action = 'restore') {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  assert.equal((await f.task('install')).state, 'succeeded');
  const world = await nativeBackupFixture(f.runtime.saved, { worldId: 'CURRENT' });
  let id = await f.manager.backup('manual');
  if (action === 'import-saved') {
    const file = path.join(f.directory, 'full.tar.gz');
    await f.runtime.run('tar', ['-czf', file, '-C', f.runtime.server, '--', 'Pal/Saved']);
    const uploaded = await f.upload('/api/save-import', await fs.readFile(file));
    assert.equal(uploaded.status, 201); id = (await uploaded.json()).id;
  } else if (action === 'import-save') {
    const uploaded = await f.upload('/api/save-import', await fs.readFile(f.manager.backupFile(id)));
    assert.equal(uploaded.status, 201); id = (await uploaded.json()).id;
  }
  await fs.writeFile(path.join(world.world, 'Level.sav'), 'original-world');
  await fs.writeFile(path.join(world.world, 'old-only.txt'), 'original-extra');
  await fs.writeFile(f.runtime.config, (await fs.readFile(f.runtime.config, 'utf8')).replace('ExpRate=1.000000', 'ExpRate=9.000000'));
  const before = {
    config: await fs.readFile(f.runtime.config),
    workspace: await fs.readFile(f.manager.store.file),
    snapshot: f.manager.store.snapshot()
  };
  async function unchanged() {
    assert.equal(await fs.readFile(path.join(world.world, 'Level.sav'), 'utf8'), 'original-world');
    assert.equal(await fs.readFile(path.join(world.world, 'old-only.txt'), 'utf8'), 'original-extra');
    assert.deepEqual(await fs.readFile(f.runtime.config), before.config);
    assert.deepEqual(await fs.readFile(f.manager.store.file), before.workspace);
    assert.deepEqual(f.manager.store.snapshot(), before.snapshot);
  }
  return { f, world, id, before, unchanged, action: action === 'import-saved' ? 'import-save' : action };
}

test('恢复和导入在配置库写入失败时回滚世界、游戏配置和配置选择，含写入后报错', async t => {
  for (const action of ['restore', 'import-save', 'import-saved']) for (const afterWrite of [false, true]) {
    await t.test(`${action} / ${afterWrite ? '配置库替换后报错' : '配置库写入失败'}`, async t => {
      const { f, world, id, before, unchanged, action: operation } = await fixture(t, action);
      const persist = f.manager.store.persist.bind(f.manager.store);
      let attempted = false;
      f.manager.store.persist = async candidate => {
        attempted = true;
        assert.equal(await fs.readFile(path.join(world.world, 'Level.sav'), 'utf8'), 'current-world');
        assert.notDeepEqual(await fs.readFile(f.runtime.config), before.config);
        if (afterWrite) await persist(candidate);
        throw new Error('模拟配置库提交失败');
      };
      const failed = await f.task(operation, { id });
      assert.equal(attempted, true);
      assert.equal(failed.state, 'failed');
      assert.match(failed.message, /模拟配置库提交失败/);
      await unchanged();
      assert.equal(f.runtime.game, null);
      assert.equal((await fs.readdir(path.dirname(world.world))).some(name => name.startsWith('.import-')), false);
      assert.equal((await fs.readdir(path.join(f.directory, 'palbox'))).some(name => name.startsWith('.configuration-')), false);
      f.manager.store.persist = persist;
      // The failed transaction must leave the write queue usable.
      if (operation === 'restore') assert.equal((await f.task('restore', { id })).state, 'succeeded');
    });
  }
});

test('游戏配置写入失败时恢复旧存档，恢复前运行的游戏重新启动', async t => {
  const { f, world, id, unchanged } = await fixture(t);
  assert.equal((await f.task('start')).state, 'succeeded');
  const pid = f.runtime.game.pid;
  const rename = fs.rename;
  let attempted = false;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (to === f.runtime.config && !attempted) {
      attempted = true;
      assert.equal(await fs.readFile(path.join(world.world, 'Level.sav'), 'utf8'), 'current-world');
      throw new Error('模拟游戏配置写入失败');
    }
    return rename(from, to);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const failed = await f.task('restore', { id });
  assert.equal(attempted, true);
  assert.equal(failed.state, 'failed');
  assert.match(failed.message, /模拟游戏配置写入失败/);
  await unchanged();
  assert.ok(f.runtime.game);
  assert.notEqual(f.runtime.game.pid, pid);
});

test('配置回滚自身失败时保留原文件副本并保持停服，世界目录仍回滚', async t => {
  const { f, world, id, before } = await fixture(t);
  assert.equal((await f.task('start')).state, 'succeeded');
  const rename = fs.rename;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (to === f.runtime.config) throw new Error('模拟持续磁盘故障');
    return rename(from, to);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const failed = await f.task('restore', { id });
  assert.equal(failed.state, 'failed');
  assert.match(failed.message, /配置回滚失败.*原文件副本已保留在/);
  assert.equal(f.runtime.game, null);
  assert.equal(await fs.readFile(path.join(world.world, 'Level.sav'), 'utf8'), 'original-world');
  assert.deepEqual(f.manager.store.snapshot(), before.snapshot);
  const stage = (await fs.readdir(path.join(f.directory, 'palbox'))).find(name => name.startsWith('.configuration-'));
  assert.ok(stage);
  assert.deepEqual(await fs.readFile(path.join(f.directory, 'palbox', stage, 'PalWorldSettings.ini')), before.config);
  assert.deepEqual(await fs.readFile(path.join(f.directory, 'palbox', stage, 'workspace.json')), before.workspace);
});

test('配置合并超限时在停服和替换前拒绝恢复，保留当前游戏与数据', async t => {
  const { f, before, unchanged } = await fixture(t);
  await fs.writeFile(f.runtime.config, `OptionSettings=(Extra="${'x'.repeat(MAX_CONFIGURATION_SOURCE_LENGTH - 100)}")`);
  const id = await f.manager.backup('manual');
  await fs.writeFile(f.runtime.config, before.config);
  assert.equal((await f.task('start')).state, 'succeeded');
  const pid = f.runtime.game.pid;
  const failed = await f.task('restore', { id });
  assert.equal(failed.state, 'failed');
  assert.match(failed.message, /合并后的配置内容过长/);
  assert.equal(f.runtime.game.pid, pid);
  await unchanged();
  assert.equal((await f.manager.backups()).filter(backup => backup.category === 'before-restore').length, 0);
});

test('恢复和两种导入在预览及执行时拒绝无效或冲突 REST 端口，保持原游戏和数据', async t => {
  for (const [action, port] of [['restore', -1], ['import-save', 8080], ['import-saved', 8081]]) {
    await t.test(action, async t => {
      const { f, before, unchanged } = await fixture(t);
      const invalid = before.config.toString().replace(`RESTAPIPort=${f.restPort}`, `RESTAPIPort=${port}`);
      assert.notEqual(invalid, before.config.toString());
      await fs.writeFile(f.runtime.config, invalid);
      let id = await f.manager.backup('manual');
      if (action !== 'restore') {
        let archive = f.manager.backupFile(id);
        if (action === 'import-saved') {
          archive = path.join(f.directory, 'invalid-full.tar.gz');
          await f.runtime.run('tar', ['-czf', archive, '-C', f.runtime.server, '--', 'Pal/Saved']);
        }
        const uploaded = await f.upload('/api/save-import', await fs.readFile(archive));
        assert.equal(uploaded.status, 201);
        id = (await uploaded.json()).id;
      }
      await fs.writeFile(f.runtime.config, before.config);
      assert.equal((await f.task('start')).state, 'succeeded');
      const pid = f.runtime.game.pid;
      const operation = action === 'import-saved' ? 'import-save' : action;
      const preview = await f.request('/api/restore-preview', { method: 'POST', body: { action: operation, id } });
      assert.equal(preview.status, 400);
      assert.match(await preview.text(), /REST API 端口无效/);
      const failed = await f.task(operation, { id });
      assert.equal(failed.state, 'failed');
      assert.match(failed.message, /REST API 端口无效/);
      assert.equal(f.runtime.game.pid, pid);
      await unchanged();
      assert.equal((await f.manager.backups()).some(backup => ['before-restore', 'before-import'].includes(backup.category)), false);
    });
  }
});
