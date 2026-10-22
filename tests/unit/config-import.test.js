import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeConfiguration, parse } from '../../shared/domain/config.js';

const values = source => Object.fromEntries(parse(source).entries.map(({ key, raw }) => [key, raw]));

test('导入覆盖同名参数，缺项沿用默认值，保留官方文件的顺序、注释和其他段落', () => {
  const defaults = '; official\r\n[/Script/Pal.PalGameWorldSettings]\r\nOptionSettings=(ServerName="Default",ExpRate=1.000000,RESTAPIEnabled=True,AdminPassword="managed",FutureDefault=(A=1,B=2))\r\n[Other]\r\nKeep=True\r\n';
  const source = mergeConfiguration(defaults, 'OptionSettings=(ExpRate=3,ServerName="导入, \\"世界\\"")');
  assert.deepEqual(values(source), {
    ServerName: '"导入, \\"世界\\""', ExpRate: '3', RESTAPIEnabled: 'True',
    AdminPassword: '"managed"', FutureDefault: '(A=1,B=2)'
  });
  assert.ok(source.startsWith('; official\r\n'));
  assert.ok(source.endsWith('[Other]\r\nKeep=True\r\n'));
  assert.equal(source.replace('ServerName="导入, \\"世界\\""', 'ServerName="Default"').replace('ExpRate=3', 'ExpRate=1.000000'), defaults);
});

test('导入独有参数追加一次，保留未知参数、嵌套列表及显式关闭和空值', () => {
  const source = mergeConfiguration('OptionSettings=(ExpRate=1,RESTAPIEnabled=True,AdminPassword="managed")',
    'OptionSettings=(Future=(A=(X,Y),B="中文,值"),ExpRate=0,RESTAPIEnabled=False,AdminPassword="")');
  assert.deepEqual(values(source), {
    ExpRate: '0', RESTAPIEnabled: 'False', AdminPassword: '""', Future: '(A=(X,Y),B="中文,值")'
  });
  assert.deepEqual(parse(source).entries.map(({ key }) => key), ['ExpRate', 'RESTAPIEnabled', 'AdminPassword', 'Future']);
});

test('空导入保留全部默认值，空默认参数列表可追加导入参数', () => {
  const defaults = 'OptionSettings=(ExpRate=1,ServerName="Default")';
  assert.equal(mergeConfiguration(defaults, 'OptionSettings=()'), defaults);
  assert.equal(mergeConfiguration('OptionSettings=()', 'OptionSettings=(Unknown=1)'), 'OptionSettings=(Unknown=1)');
});

test('导入和默认配置都必须通过语法校验', () => {
  const valid = 'OptionSettings=(ExpRate=1)';
  for (const invalid of ['not ini', 'OptionSettings=(ExpRate=1,ExpRate=2)', 'OptionSettings=(Future=(A=1)']) {
    assert.throws(() => mergeConfiguration(valid, invalid));
    assert.throws(() => mergeConfiguration(invalid, valid));
  }
});
