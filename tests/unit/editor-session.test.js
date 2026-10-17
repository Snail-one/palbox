import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorSession } from '../../src/domain/editor-session.js';
import { createCatalog } from '../../src/domain/catalog.js';
import { parse } from '../../src/domain/config.js';
import template from '../../src/domain/template.js';

const catalog = createCatalog();
const session = (source = template) => new EditorSession(source, { validate: catalog.validate });

test('模板字段与暂无控件字段均已识别，陌生字段才计为未知', () => {
  assert.equal(parse(template).entries.filter(catalog.isUnknown).length, 0);
  for (const key of ['Difficulty', 'DenyTechnologyList', 'ServerName']) assert.equal(catalog.isUnknown({ key }), false);
  for (const key of ['FutureField', '__proto__', 'constructor']) assert.equal(catalog.isUnknown({ key }), true);
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
