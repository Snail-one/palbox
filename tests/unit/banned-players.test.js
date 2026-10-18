import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseBanList, readBanList } from '../../backend/management/banned-players.js';

test('封禁名单识别平台 ID 和旧版 Steam ID，忽略注释并报告未知格式', () => {
  assert.deepEqual(parseBanList('\uFEFF# comment\r\n76561198000000000\r\nsteam_76561198000000000\nps5_ABC123\ngdk_42\n; comment\n// comment\nsteam_test\n<script>bad</script>\nsteam_\n'), {
    players: [{ userId: 'steam_76561198000000000' }, { userId: 'ps5_ABC123' }, { userId: 'gdk_42' }, { userId: 'steam_test' }], skipped: 2
  });
});

test('封禁名单从当前存档读取，拒绝越界链接和过大文件', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-ban-list-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const saved = path.join(directory, 'Saved');
  assert.deepEqual(await readBanList(saved), { players: [], skipped: 0 });
  await mkdir(path.join(saved, 'SaveGames'), { recursive: true });
  const file = path.join(saved, 'SaveGames/banlist.txt');
  await writeFile(file, 'steam_existing\n');
  assert.deepEqual((await readBanList(saved)).players, [{ userId: 'steam_existing' }]);
  await writeFile(file, 'x'.repeat(1024 * 1024 + 1));
  await assert.rejects(readBanList(saved), { status: 413 });
  await rm(file);
  const outside = path.join(directory, 'outside.txt');
  await writeFile(outside, 'steam_private\n');
  await symlink(outside, file);
  await assert.rejects(readBanList(saved), { status: 403 });
});
