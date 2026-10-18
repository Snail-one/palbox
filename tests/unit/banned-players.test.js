import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseBanList, parseBanListJson, readBanList } from '../../backend/management/banned-players.js';

test('封禁名单识别平台 ID 和旧版 Steam ID，忽略注释并报告未知格式', () => {
  assert.deepEqual(parseBanList('\uFEFF# comment\r\n76561198000000000\r\nsteam_76561198000000000\nps5_ABC123\ngdk_42\n; comment\n// comment\nsteam_test\nsteam_76561198273575064,4F9368D8000000000000000000000000\n76561198273575065,ABC\n<script>bad</script>\nsteam_\n'), {
    players: [
      { userId: 'steam_76561198000000000' },
      { userId: 'ps5_ABC123' },
      { userId: 'gdk_42' },
      { userId: 'steam_test' },
      { userId: 'steam_76561198273575064' },
      { userId: 'steam_76561198273575065' }
    ], skipped: 2
  });
});

test('新版 JSON 名单识别数组、去重并报告无效项', () => {
  assert.deepEqual(parseBanListJson('\uFEFF["steam_76561198000000000", "76561198000000001", "ps5_ABC", "steam_76561198273575064,4F9368D8000000000000000000000000", 42, "", "bad"]'), {
    players: [
      { userId: 'steam_76561198000000000' },
      { userId: 'steam_76561198000000001' },
      { userId: 'ps5_ABC' },
      { userId: 'steam_76561198273575064' }
    ], skipped: 3
  });
  assert.deepEqual(parseBanListJson('  '), { players: [], skipped: 0 });
  assert.throws(() => parseBanListJson('{'), error => error.status === 400);
  assert.throws(() => parseBanListJson('{"bans":[]}'), error => error.status === 400);
});

test('封禁名单优先读取新版 JSON，缺失时回退旧版文本文件', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-ban-list-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const saved = path.join(directory, 'Saved');
  assert.deepEqual(await readBanList(saved), { players: [], skipped: 0, updatedAt: null });

  await mkdir(path.join(saved, 'SaveGames/Config'), { recursive: true });
  const jsonFile = path.join(saved, 'SaveGames/Config/banlist.json');
  const textFile = path.join(saved, 'SaveGames/banlist.txt');
  await writeFile(textFile, 'ps5_legacy\n');
  await writeFile(jsonFile, '["steam_current", "bad"]');
  const current = await readBanList(saved);
  assert.deepEqual(current.players, [{ userId: 'steam_current' }]);
  assert.equal(current.skipped, 1);
  assert.ok(current.updatedAt);

  await rm(jsonFile);
  const legacy = await readBanList(saved);
  assert.deepEqual(legacy.players, [{ userId: 'ps5_legacy' }]);
  assert.equal(legacy.skipped, 0);
  assert.ok(legacy.updatedAt);
});

test('封禁名单拒绝越界链接、过大文件和损坏 JSON', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-ban-list-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const saved = path.join(directory, 'Saved');
  await mkdir(path.join(saved, 'SaveGames/Config'), { recursive: true });
  const jsonFile = path.join(saved, 'SaveGames/Config/banlist.json');
  const textFile = path.join(saved, 'SaveGames/banlist.txt');

  await writeFile(jsonFile, '{"broken":true}');
  await assert.rejects(readBanList(saved), { status: 400 });

  await writeFile(jsonFile, 'x'.repeat(1024 * 1024 + 1));
  await assert.rejects(readBanList(saved), { status: 413 });

  await rm(jsonFile);
  await writeFile(textFile, 'steam_existing\n');
  assert.deepEqual((await readBanList(saved)).players, [{ userId: 'steam_existing' }]);
  const outside = path.join(directory, 'outside.txt');
  await writeFile(outside, 'steam_private\n');
  await rm(textFile);
  await symlink(outside, textFile);
  await assert.rejects(readBanList(saved), { status: 403 });

  await rm(textFile);
  await writeFile(textFile, 'x'.repeat(1024 * 1024 + 1));
  await assert.rejects(readBanList(saved), { status: 413 });
});
