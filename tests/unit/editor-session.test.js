import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorSession } from '../../src/domain/editor-session.js';
import { createCatalog } from '../../src/domain/catalog.js';
import { parse } from '../../src/domain/config.js';
import template from '../../src/domain/template.js';

const catalog = createCatalog();
const session = (source = template) => new EditorSession(source, { validate: catalog.validate, formatOutput: catalog.formatOutput });

test('官方说明、社区解释与完全未识别分开统计，社区说明不冒充官方', () => {
  const community = [
    'Difficulty', 'BuildObjectHpRate', 'bEnableFriendlyFire', 'bActiveUNKO', 'bEnableAimAssistKeyboard',
    'DropItemMaxNum', 'DropItemMaxNum_UNKO', 'DropItemAliveMaxHours', 'WorkSpeedRate', 'AutoSaveSpan',
    'bIsMultiplay', 'bEnableNonLoginPenalty', 'CoopPlayerMaxNum', 'Region', 'bUseAuth', 'BanListURL',
    'EnablePredatorBossPal', 'MaxBuildingLimitNumPerPlayer', 'PlayerDataPalStorageUpdateCheckTickInterval',
    'AutoTransferMasterCheckIntervalSeconds', 'AutoTransferMasterThresholdDays', 'MaxGuildsPerFrame', 'BuildingNameDisplayCacheTTLSeconds'
  ];
  assert.deepEqual(parse(template).entries.filter(catalog.isCommunity).map(e => e.key), community);
  assert.deepEqual(catalog.summarize(parse(template).entries), { official: 99, community: 23, unknown: 0 });
  for (const key of ['DenyTechnologyList', 'ServerName', 'bEnableAimAssistPad', 'RespawnPenaltyTimeScale']) assert.equal(catalog.isUnknown({ key }), false);
  for (const key of ['FutureField', '__proto__', 'constructor']) assert.equal(catalog.isUnknown({ key }), true);
  for (const field of Object.values(catalog.fields)) {
    assert.ok(field.label && field.description);
    if (field.verification.status === 'verified') assert.match(field.verification.source, /^https:\/\/docs\.palworldgame\.com\//);
    else {
      assert.equal(field.verification.status, 'community');
      assert.ok(field.verification.source === 'user-provided' || field.verification.source.startsWith('https://github.com/'));
    }
    assert.equal(field.verification.checkedAt, '2026-10-17');
  }
});

test('社区解释必须同时有模板字段、中文用途和来源，不能由模板名称自动识别', () => {
  const field = catalog.fields.AutoSaveSpan;
  const custom = createCatalog({ source: 'OptionSettings=(AutoSaveSpan=30,TemplateOnly=1)', metadata: {
    AutoSaveSpan: field,
    NotInTemplate: { ...field, key: 'NotInTemplate' },
    TemplateOnly: { ...field, description: '' }
  }});
  assert.equal(custom.isCommunity({ key: 'AutoSaveSpan' }), true);
  assert.equal(custom.isUnknown({ key: 'AutoSaveSpan' }), false);
  assert.equal(custom.isUnknown({ key: 'NotInTemplate' }), true);
  assert.equal(custom.isUnknown({ key: 'TemplateOnly' }), true);
  assert.equal(Object.values(catalog.fields).filter(f => f.group === 'advanced').length, 11);
  assert.equal(catalog.fields.PlayerDataPalStorageUpdateCheckTickInterval.unit, '秒*');
});

test('仅列入模板、只有标签或没有核实依据的元数据均不能变为已识别', () => {
  const verified = catalog.fields.ServerName;
  const custom = createCatalog({
    source: 'OptionSettings=(TemplateOnly=1,LabelOnly=2,NoSource=3,NoMeaning=4,Verified="ok")',
    metadata: {
      LabelOnly: { label: '仅有名称' },
      NoSource: { ...verified, verification: { status: 'verified' } },
      NoMeaning: { ...verified, description: '' },
      Verified: verified
    },
    validateField: () => 'verified validation'
  });
  for (const key of ['TemplateOnly', 'LabelOnly', 'NoSource', 'NoMeaning']) {
    assert.equal(custom.isUnknown({ key }), true);
    assert.equal(custom.fields[key], undefined);
    assert.equal(custom.validate(key, 'any raw value'), null);
  }
  assert.equal(custom.isUnknown({ key: 'Verified' }), false);
  assert.equal(custom.validate('Verified', '"ok"'), 'verified validation');
});

test('社区解释不改变原值、注释或顺序，编辑复制也不会补入默认值', () => {
  const source = '; keep\r\n[/Script/Pal.PalGameWorldSettings]\r\nOptionSettings=(Difficulty=None,ServerName="世界",AutoSaveSpan=30.000000,bIsMultiplay=False)\r\n';
  const editor = session(source);
  assert.equal(editor.entries.filter(catalog.isCommunity).length, 3);
  assert.equal(editor.entries.filter(catalog.isUnknown).length, 0);
  assert.equal(editor.toIni(), source);
  editor.update('AutoSaveSpan', '45.000000');
  assert.equal(editor.toIni(), source.replace('AutoSaveSpan=30.000000', 'AutoSaveSpan=45.000000'));
});

test('已核实字段可按中文用途搜索，并使用正确的建筑限制说明', () => {
  assert.equal(catalog.matches({ key: 'MaxBuildingLimitNum' }, '每位玩家'), true);
  assert.match(catalog.fields.MaxBuildingLimitNum.description, /每位玩家/);
  assert.equal(catalog.fields.AutoResetGuildTimeNoOnlinePlayers.unit, undefined);
  assert.equal(catalog.isCommunity({ key: 'MaxBuildingLimitNumPerPlayer' }), true);
});

test('编辑状态可脱离 DOM 工作，并保留注释、顺序和其他参数', () => {
  const source = '; original\r\n' + template.replaceAll('\n', '\r\n');
  const editor = session(source);
  assert.equal(editor.dirty, false);
  assert.equal(editor.update('ExpRate', '3'), null);
  assert.deepEqual(editor.changedKeys(), ['ExpRate']);
  assert.equal(editor.source(), source.replace('ExpRate=1.000000', 'ExpRate=3'));
  assert.deepEqual(parse(editor.toIni()).entries.map(e => e.key), parse(source).entries.map(e => e.key));
  assert.equal(editor.isModified('ExpRate'), true);
  editor.reset(editor.source());
  assert.equal(editor.dirty, false);
  assert.deepEqual(editor.changedKeys(), []);
});

test('无效输入保留草稿和上次有效值，修复后清除错误', () => {
  const editor = session();
  editor.update('ServerPlayerMaxNum', '16');
  assert.ok(editor.update('ServerPlayerMaxNum', '1.5'));
  assert.equal(editor.raw('ServerPlayerMaxNum'), '16');
  assert.equal(editor.draft('ServerPlayerMaxNum'), '1.5');
  assert.equal(editor.errorCount, 1);
  assert.ok(editor.blockReason);
  editor.update('ServerPlayerMaxNum', '32');
  assert.equal(editor.errorCount, 0);
  assert.equal(editor.draft('ServerPlayerMaxNum'), undefined);
  assert.equal(editor.dirty, false);
});

test('源码草稿与已应用状态分离，错误应用不破坏已应用参数', () => {
  const editor = session();
  const source = editor.source();
  editor.setSourceDraft('OptionSettings=(A="broken)');
  assert.equal(editor.dirty, true);
  assert.throws(() => editor.applySource(editor.sourceDraft));
  assert.equal(editor.source(), source);
  editor.discardSourceDraft();
  assert.equal(editor.dirty, false);
  const next = source.replace('ExpRate=1.000000', 'ExpRate=5');
  editor.setSourceDraft(next);
  editor.applySource(next);
  assert.equal(editor.raw('ExpRate'), '5');
  assert.equal(editor.sourceDraft, null);
  assert.equal(editor.dirty, true);
});

test('源码按现有规则验证修改过的字段，未知字段完整往返', () => {
  const editor = session('OptionSettings=(ServerPlayerMaxNum=32,Future=(X=1,Y="a,b"))');
  assert.throws(() => editor.applySource('OptionSettings=(ServerPlayerMaxNum=1.5,Future=)'), /整数/);
  editor.update('Future', '(X=2,Y="中文,值")');
  assert.equal(parse(editor.toIni()).entries[1].raw, '(X=2,Y="中文,值")');
  assert.equal(editor.entries.filter(catalog.isUnknown).length, 1);
  assert.throws(() => editor.update('Missing', '1'), /不存在/);
});

test('新增或删除源码字段会影响修改计数，失败验证不影响原顺序', () => {
  const editor = session('OptionSettings=(A=1,B=2)');
  editor.applySource('OptionSettings=(B=2,C=3)');
  assert.deepEqual(editor.changedKeys(), ['A', 'C']);
  assert.deepEqual(parse(editor.toIni()).entries.map(e => e.key), ['B', 'C']);
});

test('表单修改、导入与应用源码输出时自动补齐模板小数位，输入保持原样', () => {
  const editor = session();
  editor.update('ExpRate', '2');
  editor.update('AutoSaveSpan', '45.5');
  const output = new Map(parse(editor.toIni()).entries.map(e => [e.key, e.raw]));
  assert.equal(output.get('ExpRate'), '2.000000');
  assert.equal(output.get('AutoSaveSpan'), '45.500000');
  assert.equal(editor.raw('ExpRate'), '2');
  assert.match(editor.source(), /ExpRate=2,/);
  assert.deepEqual(editor.changedKeys(), ['ExpRate', 'AutoSaveSpan']);

  const imported = session('OptionSettings=(ExpRate=2,PalCaptureRate=2.5)');
  assert.equal(imported.dirty, false);
  assert.match(imported.toIni(), /ExpRate=2\.000000,PalCaptureRate=2\.500000/);
  assert.equal(imported.dirty, false);
  imported.applySource('OptionSettings=(ExpRate=3,PalCaptureRate=0)');
  assert.match(imported.toIni(), /ExpRate=3\.000000,PalCaptureRate=0\.000000/);
  assert.equal(imported.source(), 'OptionSettings=(ExpRate=3,PalCaptureRate=0)');
});

test('补零不改变整数、未知参数、文本、列表、注释、段落或参数顺序', () => {
  const source = '; keep\r\n[/Script/Pal.PalGameWorldSettings]\r\nOptionSettings=(ExpRate=2,ServerPlayerMaxNum=16,PublicPort=8211,SupplyDropSpan=180,CoopPlayerMaxNum=4,FutureRate=2,ServerName="2.5",Future=(A=2,B=3.5)) ; tail\r\n[Other]\r\nValue=2\r\n';
  const editor = session(source);
  assert.equal(editor.toIni(), source.replace('ExpRate=2,', 'ExpRate=2.000000,'));
  assert.equal(editor.source(), source);
  assert.deepEqual(editor.changedKeys(), []);
});

test('补零保留高精度小数，科学计数法展开时不舍入，非法原值不改写', () => {
  const editor = session('OptionSettings=(ExpRate=1)');
  for (const [input, expected] of [
    ['2.1234567890123456789', '2.1234567890123456789'],
    ['.5', '0.500000'], ['2.', '2.000000'], ['+2', '+2.000000'],
    ['2e0', '2.000000'], ['2.5e1', '25.000000'], ['2e-2', '0.020000'],
    ['2e-7', '0.0000002'], ['2e3', '2000.000000'], ['0e999999', '0.000000'],
    ['2e-999999', '2e-999999']
  ]) {
    assert.equal(editor.update('ExpRate', input), null);
    assert.equal(parse(editor.toIni()).entries[0].raw, expected, input);
    assert.equal(editor.raw('ExpRate'), input);
  }
  const invalid = session('OptionSettings=(ExpRate=NaN,PalCaptureRate=-1)');
  assert.match(invalid.toIni(), /ExpRate=NaN,PalCaptureRate=-1/);
});

test('输出补零仍使用有效值，排除非法编辑和未应用的源码草稿', () => {
  const editor = session('OptionSettings=(ExpRate=2)');
  editor.update('ExpRate', 'broken');
  editor.setSourceDraft('OptionSettings=(ExpRate=5)');
  assert.match(editor.toIni(), /ExpRate=2\.000000/);
  assert.equal(editor.draft('ExpRate'), 'broken');
  assert.equal(editor.sourceDraft, 'OptionSettings=(ExpRate=5)');
  assert.ok(editor.blockReason);
});
