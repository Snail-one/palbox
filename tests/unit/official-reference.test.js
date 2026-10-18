import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCatalog } from '../../shared/domain/catalog.js';
import { parse } from '../../shared/domain/config.js';
import { EditorSession } from '../../shared/domain/editor-session.js';

const reference = JSON.parse(await readFile(new URL('../fixtures/official-parameters.json', import.meta.url), 'utf8'));
const catalog = createCatalog();
const officialKeys = Object.values(reference.sections).flat();
const templateKeys = new Set(parse(catalog.template).entries.map(entry => entry.key));

test('用户提供的 96 项官方参数全部收录，没有误标为社区或未知', () => {
  assert.equal(new Set(officialKeys).size, 96);
  for (const key of officialKeys) {
    assert.equal(catalog.isUnknown({ key }), false, key);
    assert.equal(catalog.fields[key].verification.status, 'verified', key);
  }
  assert.deepEqual(officialKeys.filter(key => !templateKeys.has(key)), reference.unavailable);
});

test('默认配置 99 项官方说明来自配置清单 95 项与 PvP 补充 4 项', () => {
  for (const key of reference.pvpOnly) {
    assert.ok(templateKeys.has(key));
    assert.equal(officialKeys.includes(key), false);
    assert.equal(catalog.fields[key].verification.source, 'https://docs.palworldgame.com/settings-and-operation/pvp/');
  }
  const documented = new Set([...officialKeys, ...reference.pvpOnly]);
  const classified = Object.values(catalog.fields).filter(field => field.verification.status === 'verified').map(field => field.key);
  assert.deepEqual(new Set(classified), documented);
  assert.deepEqual(catalog.summarize(parse(catalog.template).entries), { official: 99, community: 23, unknown: 0 });
});

test('旧平台字段说明当前不可用，但导入和复制不自动迁移或删除原值', () => {
  assert.equal(catalog.fields.AllowConnectPlatform.deprecated, true);
  const source = '; keep\r\n[/Script/Pal.PalGameWorldSettings]\r\nOptionSettings=(AllowConnectPlatform=Steam,ServerName="old",Future=(X,Y))\r\n';
  const editor = new EditorSession(source, { validate: catalog.validate });
  assert.equal(editor.toIni(), source);
  editor.update('ServerName', '"new"');
  assert.equal(editor.toIni(), source.replace('ServerName="old"', 'ServerName="new"'));
  assert.equal(editor.entries.some(entry => entry.key === 'CrossplayPlatforms'), false);
  assert.equal(templateKeys.has('AllowConnectPlatform'), false);
});

test('官方注明的单位与范围保持明确，未注明的单位继续保留未知', () => {
  assert.equal(catalog.fields.ItemContainerForceMarkDirtyInterval.unit, '秒');
  assert.equal(catalog.fields.PalEggDefaultHatchingTime.unit, '小时');
  assert.equal(catalog.fields.GuildRejoinCooldownMinutes.unit, '分钟');
  assert.equal(catalog.fields.ServerReplicatePawnCullDistance.unit, '厘米');
  assert.equal(catalog.fields.ServerReplicatePawnCullDistance.min, 5000);
  assert.equal(catalog.fields.ServerReplicatePawnCullDistance.max, 15000);
  for (const key of ['AutoResetGuildTimeNoOnlinePlayers', 'VoiceChatMaxVolumeDistance', 'VoiceChatZeroVolumeDistance']) {
    assert.equal(catalog.fields[key].unit, undefined, key);
  }
});
