import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSnapshot } from '../../server/management/save-imports.js';

const file = (name, size = 16) => ({ name, type: 'file', size });
const dir = name => ({ name, type: 'directory', size: 0 });
const snapshot = root => {
  const prefix = root ? `${root}/` : '';
  return [dir(root ? prefix.slice(0, -1) : './'), file(`${prefix}Level.sav`, 32), file(`${prefix}LevelMeta.sav`, 16), dir(`${prefix}Players`), file(`${prefix}Players/player.sav`)];
};

test('识别根目录、SaveGames 和 Pal/Saved 三种布局', () => {
  assert.deepEqual(detectSnapshot(snapshot('')), {
    root: '', layout: 'root', worldId: null, copy: ['Level.sav', 'LevelMeta.sav', 'Players/player.sav']
  });
  assert.deepEqual(detectSnapshot(snapshot('SaveGames/0/WORLD1')).root, 'SaveGames/0/WORLD1');
  assert.deepEqual(detectSnapshot(snapshot('SaveGames/0/WORLD1')).layout, 'savegames');
  assert.deepEqual(detectSnapshot(snapshot('SaveGames/0/WORLD1')).worldId, 'WORLD1');
  assert.deepEqual(detectSnapshot(snapshot('Pal/Saved/SaveGames/0/WORLD2')).layout, 'pal-saved');
  assert.deepEqual(detectSnapshot(snapshot('Pal/Saved/SaveGames/0/WORLD2')).worldId, 'WORLD2');
});

test('规范化 ./ 前缀并允许缺少 Players', () => {
  const result = detectSnapshot([file('./Level.sav'), file('./LevelMeta.sav')]);
  assert.deepEqual(result, { root: '', layout: 'root', worldId: null, copy: ['Level.sav', 'LevelMeta.sav'] });
});

test('忽略世界目录中的 backup 历史与额外配置', () => {
  const entries = [
    file('SaveGames/0/WORLD1/Level.sav'), file('SaveGames/0/WORLD1/LevelMeta.sav'),
    dir('SaveGames/0/WORLD1/Players'), file('SaveGames/0/WORLD1/Players/a.sav'),
    dir('SaveGames/0/WORLD1/backup'), dir('SaveGames/0/WORLD1/backup/world'), dir('SaveGames/0/WORLD1/backup/world/2026.01.01-00.00.00'),
    file('SaveGames/0/WORLD1/backup/world/2026.01.01-00.00.00/Level.sav'),
    file('SaveGames/0/WORLD1/backup/world/2026.01.01-00.00.00/LevelMeta.sav'),
    file('SaveGames/0/WORLD1/WorldOption.sav'),
    file('SaveGames/0/WORLD1/Extra.log')
  ];
  const result = detectSnapshot(entries);
  assert.equal(result.root, 'SaveGames/0/WORLD1');
  assert.deepEqual(result.copy, ['Level.sav', 'LevelMeta.sav', 'Players/a.sav', 'WorldOption.sav']);
});

test('拒绝多个世界、缺少元数据与无效玩家文件', () => {
  assert.throws(() => detectSnapshot([
    ...snapshot('SaveGames/0/ONE'), ...snapshot('SaveGames/0/TWO')
  ]), /多个世界存档/);
  assert.throws(() => detectSnapshot([file('Level.sav')]), /没有可导入/);
  assert.throws(() => detectSnapshot([
    file('Level.sav'), file('LevelMeta.sav'), dir('Players'), file('Players/readme.txt')
  ]), /玩家文件无效/);
  assert.throws(() => detectSnapshot([
    file('Level.sav'), file('LevelMeta.sav'), dir('Players'), dir('Players/nested'), file('Players/nested/a.sav')
  ]), /玩家文件无效/);
});

test('拒绝穿越、绝对路径、反斜杠、重复路径和文件作为父路径', () => {
  const base = [file('Level.sav'), file('LevelMeta.sav')];
  assert.throws(() => detectSnapshot([...base, file('../Level.sav')]), /不允许的路径/);
  assert.throws(() => detectSnapshot([...base, file('/Level.sav')]), /无效路径/);
  assert.throws(() => detectSnapshot([...base, file('bad\\Level.sav')]), /无效路径/);
  assert.throws(() => detectSnapshot([...base, file('Level.sav')]), /重复路径/);
  assert.throws(() => detectSnapshot([...base, file('Players'), file('Players/a.sav')]), /不允许的路径/);
  assert.throws(() => detectSnapshot([...base, file(' Save.sav')]), /无效路径/);
});
