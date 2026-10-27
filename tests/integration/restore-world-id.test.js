import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { managementFixture } from '../helpers/management-fixture.js';
import { nativeBackupFixture } from '../helpers/native-backup-fixture.js';

async function fixture(t, action = 'restore') {
  const f = await managementFixture(); t.after(() => f.close()); await f.login();
  assert.equal((await f.task('install')).state, 'succeeded');
  const source = await nativeBackupFixture(f.runtime.saved, { worldId: 'SOURCE' });
  let id = action === 'restore-native' ? source.id : await f.manager.backup('manual');
  if (action === 'import-save') {
    const upload = await f.upload('/api/save-import', await fs.readFile(f.manager.backupFile(id)));
    assert.equal(upload.status, 201); id = (await upload.json()).id;
  }
  await fs.writeFile(path.join(source.world, 'Level.sav'), 'previous-source-data');
  const current = await nativeBackupFixture(f.runtime.saved, { worldId: 'CURRENT' });
  await fs.writeFile(path.join(current.world, 'Level.sav'), 'keep-current-data');
  const settings = path.join(f.runtime.saved, 'Config/LinuxServer/GameUserSettings.ini');
  await fs.appendFile(settings, 'OtherSetting=keep\n');
  return { f, id, source, current, settings, action };
}

test('按备份世界 ID 恢复、导入及官方快照：保护被覆盖世界、切换加载 ID、保留其他世界及运行状态', async t => {
  for (const action of ['restore', 'import-save', 'restore-native']) {
    await t.test(action, async t => {
      const { f, id, source, current, settings } = await fixture(t, action);
      const running = action !== 'import-save';
      if (running) assert.equal((await f.task('start')).state, 'succeeded');
      const response = await f.request('/api/restore-preview', { method: 'POST', body: { action, id, mode: 'source-world' } });
      assert.equal(response.status, 200);
      const preview = await response.json();
      assert.equal(preview.targetWorldId, 'SOURCE');
      assert.equal(preview.targetExists, true);
      assert.equal(preview.mode, 'source-world');
      assert.equal(preview.targetDirectory, source.world);
      assert.equal(await f.manager.targetWorld(), 'CURRENT');
      const task = await f.task(action, { id, mode: 'source-world', targetWorldId: preview.targetWorldId });
      assert.equal(task.state, 'succeeded', task.message);
      assert.equal(await f.manager.targetWorld(), 'SOURCE');
      assert.match(await fs.readFile(settings, 'utf8'), /OtherSetting=keep/);
      assert.equal(await fs.readFile(path.join(source.world, 'Level.sav'), 'utf8'), action === 'restore-native' ? 'official-world' : 'current-world');
      assert.equal(await fs.readFile(path.join(current.world, 'Level.sav'), 'utf8'), 'keep-current-data');
      assert.equal(Boolean(f.runtime.game), running);
      const category = action === 'import-save' ? 'before-import' : 'before-restore';
      const [backup] = (await f.manager.backups({ includeWorldId: true })).filter(backup => backup.category === category);
      assert.equal(backup.worldId, 'SOURCE');
      const result = await f.runtime.run('tar', ['-xOzf', f.manager.backupFile(backup.id), '--', 'SOURCE/Level.sav']);
      assert.equal(result, 'previous-source-data');
      if (action === 'restore-native') assert.equal(await fs.readFile(path.join(source.snapshot, 'Level.sav'), 'utf8'), 'official-world');
    });
  }
});

test('世界 ID 相同时不重写设置文件，仍恢复存档及包内游戏配置', async t => {
  for (const action of ['restore', 'import-save', 'restore-native']) {
    await t.test(action, async t => {
      const { f, id, source, current, settings } = await fixture(t, action);
      const original = '[/Script/Pal.PalGameLocalSettings]\r\n  DedicatedServerName = "SOURCE"\r\nOtherSetting=keep\r\n';
      await fs.writeFile(settings, original);
      const info = await fs.stat(settings);
      await fs.writeFile(f.runtime.config, (await fs.readFile(f.runtime.config, 'utf8')).replace('ExpRate=1.000000', 'ExpRate=9.000000'));
      const task = await f.task(action, { id, mode: 'source-world', targetWorldId: 'SOURCE' });
      assert.equal(task.state, 'succeeded', task.message);
      assert.equal(await fs.readFile(settings, 'utf8'), original);
      const after = await fs.stat(settings);
      assert.equal(after.ino, info.ino);
      assert.equal(after.mtimeMs, info.mtimeMs);
      assert.equal(await fs.readFile(path.join(source.world, 'Level.sav'), 'utf8'), action === 'restore-native' ? 'official-world' : 'current-world');
      assert.equal(await fs.readFile(path.join(current.world, 'Level.sav'), 'utf8'), 'keep-current-data');
      assert.match(await fs.readFile(f.runtime.config, 'utf8'), action === 'restore-native' ? /ExpRate=9\.000000/ : /ExpRate=1\.000000/);
    });
  }
});

test('按世界 ID 恢复只读取和更新世界配置段，不改其他段的同名参数', async t => {
  for (const action of ['restore', 'import-save', 'restore-native']) {
    await t.test(action, async t => {
      const { f, id, settings } = await fixture(t, action);
      const original = '\uFEFF[Other]\r\nDedicatedServerName=SOURCE\r\n[/Script/Pal.PalGameLocalSettings]\r\n  DedicatedServerName = "CURRENT"  \r\nOtherSetting=keep\r\n';
      await fs.writeFile(settings, original);
      const preview = await f.manager.previewRestore(action, id, 'source-world');
      assert.equal(preview.targetWorldId, 'SOURCE');
      assert.equal(await f.manager.targetWorld(), 'CURRENT');
      const restored = await f.task(action, { id, mode: 'source-world', targetWorldId: 'SOURCE' });
      assert.equal(restored.state, 'succeeded', restored.message);
      assert.equal(await fs.readFile(settings, 'utf8'), original.replace('"CURRENT"', '"SOURCE"'));
      assert.equal(await f.manager.targetWorld(), 'SOURCE');
    });
  }
});

test('其他段的同名参数、重复参数和无效值在替换存档前拒绝恢复', async t => {
  for (const [name, configuration, expected] of [
    ['其他配置段', '[Other]\nDedicatedServerName=CURRENT\n', /未找到配置/],
    ['重复参数', '[/Script/Pal.PalGameLocalSettings]\nDedicatedServerName=CURRENT\nDedicatedServerName=SOURCE\n', /参数重复/],
    ['空值', '[/Script/Pal.PalGameLocalSettings]\nDedicatedServerName=\n', /世界 ID 无效/]
  ]) await t.test(name, async t => {
    const { f, id, source, current, settings } = await fixture(t);
    await fs.writeFile(settings, configuration);
    const preview = await f.request('/api/restore-preview', { method: 'POST', body: { action: 'restore', id, mode: 'source-world' } });
    assert.equal(preview.status, 409);
    assert.match(await preview.text(), expected);
    const restored = await f.task('restore', { id, mode: 'source-world', targetWorldId: 'SOURCE' });
    assert.equal(restored.state, 'failed');
    assert.match(restored.message, expected);
    assert.equal(await fs.readFile(settings, 'utf8'), configuration);
    assert.equal(await fs.readFile(path.join(source.world, 'Level.sav'), 'utf8'), 'previous-source-data');
    assert.equal(await fs.readFile(path.join(current.world, 'Level.sav'), 'utf8'), 'keep-current-data');
    assert.equal((await f.manager.backups()).some(backup => backup.category === 'before-restore'), false);
  });
});

test('按来源 ID 创建目标世界时只更新已有参数，保留其他设置及换行格式', async t => {
  for (const action of ['restore', 'import-save']) {
    await t.test(action, async t => {
      const { f, id, source, current, settings } = await fixture(t, action);
      await fs.rm(source.world, { recursive: true });
      await fs.writeFile(settings, '[/Script/Pal.PalGameLocalSettings]\r\nDedicatedServerName=CURRENT\r\nOtherSetting=keep\r\n');
      const response = await f.request('/api/restore-preview', { method: 'POST', body: { action, id, mode: 'source-world' } });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).targetExists, false);
      const task = await f.task(action, { id, mode: 'source-world', targetWorldId: 'SOURCE' });
      assert.equal(task.state, 'succeeded', task.message);
      assert.equal(await f.manager.targetWorld(), 'SOURCE');
      assert.equal(await fs.readFile(path.join(source.world, 'Level.sav'), 'utf8'), 'current-world');
      assert.equal(await fs.readFile(settings, 'utf8'), '[/Script/Pal.PalGameLocalSettings]\r\nDedicatedServerName=SOURCE\r\nOtherSetting=keep\r\n');
      assert.equal(await fs.readFile(path.join(current.world, 'Level.sav'), 'utf8'), 'keep-current-data');
      assert.equal(f.runtime.game, null);
    });
  }
});

test('缺少设置文件或世界参数时预览和执行均失败，不停服、不创建备份或修改数据', async t => {
  for (const action of ['restore', 'import-save', 'restore-native']) for (const mode of ['world', 'source-world']) for (const missingParameter of [false, true]) {
    await t.test(`${action} / ${mode} / ${missingParameter ? '缺少参数' : '缺少文件'}`, async t => {
      const { f, id, source, current, settings } = await fixture(t, action);
      const config = await fs.readFile(f.runtime.config);
      const workspace = f.manager.store.snapshot();
      assert.equal((await f.task('start')).state, 'succeeded');
      const pid = f.runtime.game.pid;
      const selection = await fs.readFile(settings);
      const incomplete = '[/Script/Pal.PalGameLocalSettings]\r\nOtherSetting=keep\r\n;DedicatedServerName=COMMENTED\r\n';
      const expected = missingParameter ? /未找到配置.*DedicatedServerName/ : /GameUserSettings.ini.*请先启动一次服务端/;
      if (missingParameter) await fs.writeFile(settings, incomplete);
      else await fs.rm(settings);
      const preview = await f.request('/api/restore-preview', { method: 'POST', body: { action, id, mode } });
      assert.equal(preview.status, 409);
      assert.match(await preview.text(), expected);
      // A previously generated file becoming available again unblocks detection.
      await fs.writeFile(settings, selection);
      const retry = await f.request('/api/restore-preview', { method: 'POST', body: { action, id, mode: 'source-world' } });
      assert.equal(retry.status, 200);
      // Execution must also recheck the file and parameter after a successful preview.
      if (missingParameter) await fs.writeFile(settings, incomplete);
      else await fs.rm(settings);
      const task = await f.task(action, { id, mode, targetWorldId: mode === 'source-world' ? 'SOURCE' : 'CURRENT' });
      assert.equal(task.state, 'failed');
      assert.match(task.message, expected);
      assert.equal(f.runtime.game.pid, pid);
      assert.equal(await fs.readFile(path.join(source.world, 'Level.sav'), 'utf8'), 'previous-source-data');
      assert.equal(await fs.readFile(path.join(current.world, 'Level.sav'), 'utf8'), 'keep-current-data');
      assert.deepEqual(await fs.readFile(f.runtime.config), config);
      assert.deepEqual(f.manager.store.snapshot(), workspace);
      if (missingParameter) assert.equal(await fs.readFile(settings, 'utf8'), incomplete);
      else await assert.rejects(fs.access(settings), { code: 'ENOENT' });
      assert.equal((await f.manager.backups()).some(backup => ['before-import', 'before-restore'].includes(backup.category)), false);
    });
  }
});

test('按世界 ID 恢复的配置提交失败时回滚加载 ID、目标存档、游戏配置及配置选择', async t => {
  for (const action of ['restore', 'import-save']) {
    await t.test(action, async t => {
      const { f, id, source, current, settings } = await fixture(t, action);
      const beforeSettings = await fs.readFile(settings);
      const beforeConfig = await fs.readFile(f.runtime.config);
      const beforeWorkspace = f.manager.store.snapshot();
      const persist = f.manager.store.persist.bind(f.manager.store);
      f.manager.store.persist = async candidate => {
        assert.equal(await f.manager.targetWorld(), 'SOURCE');
        await persist(candidate);
        throw new Error('模拟配置提交后失败');
      };
      const task = await f.task(action, { id, mode: 'source-world', targetWorldId: 'SOURCE' });
      assert.equal(task.state, 'failed');
      assert.match(task.message, /模拟配置提交后失败/);
      assert.deepEqual(await fs.readFile(settings), beforeSettings);
      assert.deepEqual(await fs.readFile(f.runtime.config), beforeConfig);
      assert.deepEqual(f.manager.store.snapshot(), beforeWorkspace);
      assert.equal(await fs.readFile(path.join(source.world, 'Level.sav'), 'utf8'), 'previous-source-data');
      assert.equal(await fs.readFile(path.join(current.world, 'Level.sav'), 'utf8'), 'keep-current-data');
    });
  }
});

test('世界 ID 写入失败时回滚目标世界，不改动游戏配置', async t => {
  for (const action of ['restore', 'import-save', 'restore-native']) {
    await t.test(action, async t => {
      const { f, id, source, settings } = await fixture(t, action);
      const before = await fs.readFile(settings);
      const config = await fs.readFile(f.runtime.config);
      const rename = fs.rename;
      let attempted = false;
      t.mock.method(fs, 'rename', async (from, to) => {
        if (to === settings && !attempted) { attempted = true; throw new Error('模拟世界 ID 写入失败'); }
        return rename(from, to);
      });
      syncBuiltinESMExports();
      t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
      const task = await f.task(action, { id, mode: 'source-world', targetWorldId: 'SOURCE' });
      assert.equal(task.state, 'failed');
      assert.match(task.message, /模拟世界 ID 写入失败/);
      assert.equal(attempted, true);
      assert.deepEqual(await fs.readFile(settings), before);
      assert.deepEqual(await fs.readFile(f.runtime.config), config);
      assert.equal(await fs.readFile(path.join(source.world, 'Level.sav'), 'utf8'), 'previous-source-data');
    });
  }
});

test('缺少来源 ID、仅配置和非法恢复方式不能按世界 ID 恢复', async t => {
  const { f } = await fixture(t);
  const configOnly = await f.manager.backup('before-import', null, { configurationOnly: true });
  const loose = path.join(f.directory, 'loose');
  await fs.mkdir(loose);
  await fs.writeFile(path.join(loose, 'Level.sav'), 'level');
  await fs.writeFile(path.join(loose, 'LevelMeta.sav'), 'meta');
  const archive = path.join(f.directory, 'loose.tar.gz');
  await f.runtime.run('tar', ['-czf', archive, '-C', loose, '--', 'Level.sav', 'LevelMeta.sav']);
  const uploaded = await f.upload('/api/save-import', await fs.readFile(archive));
  const staged = await uploaded.json();
  for (const [action, id] of [['restore', configOnly], ['import-save', staged.id]]) {
    const preview = await f.request('/api/restore-preview', { method: 'POST', body: { action, id, mode: 'source-world' } });
    assert.equal(preview.status, 409);
    assert.match(await preview.text(), /来源世界 ID/);
    assert.equal((await f.task(action, { id, mode: 'source-world', targetWorldId: 'SOURCE' })).state, 'failed');
  }
  for (const action of ['restore', 'import-save', 'restore-native']) {
    const preview = await f.request('/api/restore-preview', { method: 'POST', body: { action, id: configOnly, mode: 'full' } });
    assert.equal(preview.status, 400);
    const task = await f.request('/api/tasks', { method: 'POST', body: { action, id: configOnly, mode: 'full' } });
    assert.equal(task.status, 400);
  }
  assert.equal(await f.manager.targetWorld(), 'CURRENT');
});

test('新建世界恢复失败时移除新目录并还原已有的世界设置文件', async t => {
  const { f, id, source, settings } = await fixture(t);
  await fs.rm(source.world, { recursive: true });
  const original = await fs.readFile(settings);
  f.manager.store.persist = async () => { throw new Error('模拟配置提交失败'); };
  const task = await f.task('restore', { id, mode: 'source-world', targetWorldId: 'SOURCE' });
  assert.equal(task.state, 'failed');
  assert.match(task.message, /模拟配置提交失败/);
  assert.deepEqual(await fs.readFile(settings), original);
  await assert.rejects(fs.access(source.world), { code: 'ENOENT' });
});

test('世界 ID 回滚失败时保留设置副本、回滚存档并保持停服', async t => {
  const { f, id, source, settings } = await fixture(t);
  const original = await fs.readFile(settings);
  assert.equal((await f.task('start')).state, 'succeeded');
  f.manager.store.persist = async () => { throw new Error('模拟配置提交失败'); };
  const rename = fs.rename;
  let writes = 0;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (to === settings && ++writes > 1) throw new Error('模拟设置回滚失败');
    return rename(from, to);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const task = await f.task('restore', { id, mode: 'source-world', targetWorldId: 'SOURCE' });
  assert.equal(task.state, 'failed');
  assert.match(task.message, /世界 ID 回滚失败.*原文件副本已保留在/);
  assert.equal(f.runtime.game, null);
  assert.equal(await fs.readFile(path.join(source.world, 'Level.sav'), 'utf8'), 'previous-source-data');
  const transactions = path.join(f.directory, 'palbox/transactions');
  const stage = (await fs.readdir(transactions)).find(name => name.startsWith('.world-settings-'));
  assert.ok(stage);
  assert.deepEqual(await fs.readFile(path.join(transactions, stage, 'GameUserSettings.ini')), original);
});

test('官方快照恢复完成后启动失败时明确提示数据已恢复', async t => {
  const { f, id, source } = await fixture(t, 'restore-native');
  assert.equal((await f.task('start')).state, 'succeeded');
  f.manager.startGame = async () => { throw new Error('模拟启动失败'); };
  const task = await f.task('restore-native', { id, mode: 'source-world', targetWorldId: 'SOURCE' });
  assert.equal(task.state, 'failed');
  assert.match(task.message, /官方存档已恢复，但游戏服启动失败.*模拟启动失败/);
  assert.equal(await fs.readFile(path.join(source.world, 'Level.sav'), 'utf8'), 'official-world');
  assert.equal(await f.manager.targetWorld(), 'SOURCE');
  assert.equal(f.runtime.game, null);
});
