import * as C from '../../shared/domain/config.js';
import template from '../../shared/domain/template.js';
import * as Schema from '../../shared/domain/schema.js';
import { validateWorkspace } from '../../shared/domain/workspace.js';

export function coreCases() {
  const cases = [];
  const equal = (actual, expected) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`期望 ${JSON.stringify(expected)}，得到 ${JSON.stringify(actual)}`);
  };
  const throws = (fn, text) => {
    let error;
    try { fn(); } catch (caught) { error = caught; }
    if (!error || (text && !error.message.includes(text))) throw new Error(`应抛出包含「${text || ''}」的错误，得到 ${error?.message || '无错误'}`);
  };
  const test = (name, run) => cases.push({ name, run });
  const values = source => C.parse(source).entries.map(e => [e.key, e.raw]);
  const value = (source, key) => C.parse(source).entries.find(e => e.key === key)?.raw;
  const workspace = () => ({ version: 1, activeId: 'one', profiles: [{ id: 'one', name: '我的世界', source: template, updatedAt: '2026-10-17T00:00:00Z' }] });

  test('用户模板包含完整的 122 项参数', () => {
    const doc = C.parse(template);
    equal(doc.entries.length, 122);
    equal(doc.entries[0].key, 'Difficulty');
    equal(doc.entries.at(-1).key, 'bAllowEnemyCampSpawnNearBaseCamp');
    equal(value(template, 'DenyTechnologyList'), '');
    equal(value(template, 'PhysicsActiveDropItemMaxNum'), '-1');
    equal(value(template, 'MaxBuildingLimitNumPerPlayer'), '0');
    equal(value(template, 'AdditionalDropItemWhenPlayerKillingInPvPMode'), '"PlayerDropItem"');
  });
  test('不编辑时逐字保留原始模板', () => equal(C.serialize(C.parse(template)), template));
  test('完整模板导出再导入保持顺序、值和数量', () => equal(values(C.serialize(C.parse(template), new Map(), { download: true })), values(template)));
  test('单独 OptionSettings 导出时补充目标段落', () => {
    const source = 'OptionSettings=(ServerName="中文世界",ExpRate=1.000000)';
    const exported = C.serialize(C.parse(source), new Map(), { download: true });
    equal(exported.startsWith('[/Script/Pal.PalGameWorldSettings]\n'), true);
    equal(values(exported), values(source));
  });
  test('仅修改经验倍率，其他 121 项保持原始值', () => {
    const result = C.serialize(C.parse(template), new Map([['ExpRate', '3.5']]));
    equal(result, template.replace('ExpRate=1.000000', 'ExpRate=3.5'));
    equal(values(result).filter(([k]) => k !== 'ExpRate'), values(template).filter(([k]) => k !== 'ExpRate'));
  });
  test('正确解析嵌套列表、空值、中文与字符串内逗号', () => {
    equal(values('OptionSettings=(Name="世界,一号",CrossplayPlatforms=(Steam,Xbox,PS5,Mac),Nested=(A=(B=1,C=2),D="x,y"),Empty=,Negative=-1)'), [
      ['Name', '"世界,一号"'], ['CrossplayPlatforms', '(Steam,Xbox,PS5,Mac)'], ['Nested', '(A=(B=1,C=2),D="x,y")'], ['Empty', ''], ['Negative', '-1']
    ]);
  });
  test('字符串转义引号和反斜杠可往返', () => {
    const text = '帕鲁 "甲", 路径 C:\\Pal\\Saved';
    const encoded = C.encodeString(text);
    equal(C.decodeString(encoded), text);
    equal(value(`OptionSettings=(ServerName=${encoded},Empty=)`, 'ServerName'), encoded);
  });
  test('新增版本的未知参数完整保留', () => {
    const source = 'OptionSettings=(FutureFlag=FutureEnum,FutureList=(A=(B=2,C=3)),ServerName="old")';
    const result = C.serialize(C.parse(source), new Map([['ServerName', '"新世界"']]));
    equal(result, source.replace('"old"', '"新世界"'));
  });
  test('未知参数与对象原型同名时仍作为普通参数处理', () => {
    const source = 'OptionSettings=(constructor=Future,__proto__=(A=1),toString="ok")';
    equal(C.serialize(C.parse(source)), source);
    equal(Schema.fields.constructor, undefined);
    equal(Schema.fields.__proto__, undefined);
    equal(Schema.validate('constructor', 'Future'), null);
  });
  test('其他 INI 段落、相似配置项和注释逐字保留', () => {
    const source = '; header\r\n[Other]\r\nOptionSettings=(Other=1)\r\n[/Script/Pal.PalGameWorldSettings]\r\n; keep\r\nOptionSettings = ( ServerName = "old", ExpRate=1.000000 ) ; tail\r\nOtherKey=keep\r\n[Footer]\r\nFlag=True\r\n';
    const result = C.serialize(C.parse(source), new Map([['ServerName', '"新"']]));
    equal(result, source.replace('"old"', '"新"'));
    const exported = C.serialize(C.parse(result), new Map(), { download: true });
    equal(exported.includes('[Other]\r\nOptionSettings=(Other=1)'), true);
    equal(exported.includes('; keep\r\nOptionSettings=(ServerName="新",ExpRate=1.000000) ; tail'), true);
    equal(exported.endsWith('[Footer]\r\nFlag=True\r\n'), true);
  });
  test('支持 UTF-8 BOM，导出不重复段落', () => {
    const source = '\uFEFF[/Script/Pal.PalGameWorldSettings]\r\nOptionSettings=(A=1)\r\n';
    equal(C.parse(source).hasSection, true);
    equal(C.serialize(C.parse(source), new Map(), { download: true }), source);
  });
  test('多行参数和列表导出为单行 OptionSettings', () => {
    const source = '[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(\n A=1,\n Platforms=(Steam,\n Xbox),\n Empty=\n)\n';
    const result = C.serialize(C.parse(source), new Map(), { download: true });
    equal(result.split('\n').filter(l => l.startsWith('OptionSettings=')).length, 1);
    equal(result.trim().split('\n').length, 2);
    equal(value(result, 'Platforms'), '(Steam, Xbox)');
  });
  test('修改空值、末尾值、不同长度值时位置正确', () => {
    const source = 'OptionSettings=(A=,B="a",C=1.000000)';
    equal(C.serialize(C.parse(source), new Map([['A', '(X,Y)'], ['B', '"长文本"'], ['C', '0']])), 'OptionSettings=(A=(X,Y),B="长文本",C=0)');
  });
  test('拒绝重复参数', () => throws(() => C.parse('OptionSettings=(A=1,A=2)'), '重复'));
  test('拒绝多个目标 OptionSettings，包括错误格式的重复项', () => {
    throws(() => C.parse('OptionSettings=(A=1)\nOptionSettings=(B=2)'), '多个');
    throws(() => C.parse('OptionSettings=bad\nOptionSettings=(B=2)'), '多个');
  });
  test('拒绝重复目标段落', () => throws(() => C.parse('[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(A=1)\n[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(A=2)'), '段落重复'));
  test('拒绝错误段落中的 OptionSettings', () => throws(() => C.parse('[Unrelated]\nOptionSettings=(A=1)'), '未找到'));
  test('拒绝括号、引号不闭合和多余内容', () => {
    throws(() => C.parse('OptionSettings=(A=(X,Y)'), '未闭合');
    throws(() => C.parse('OptionSettings=(A="x)'), '引号');
    throws(() => C.parse('OptionSettings=(A=1))'), '无效内容');
    throws(() => C.parse('OptionSettings=(A=(X,Y])'), '括号');
    throws(() => C.parse('OptionSettings=oops'), '括号');
  });
  test('拒绝多余逗号和非法参数名', () => {
    throws(() => C.parse('OptionSettings=(A=1,)'), '参数格式');
    throws(() => C.parse('OptionSettings=(A=1,,B=2)'), '参数格式');
    throws(() => C.parse('OptionSettings=(123=1)'), '参数格式');
  });
  test('拒绝空输入及字符串内换行', () => {
    throws(() => C.parse('  '), '为空');
    throws(() => C.parse('OptionSettings=(A="x\ny")'), '换行');
    throws(() => C.parse('OptionSettings=(A=("x\ny"))'), '换行');
    throws(() => C.encodeString('x\ny'), '单行');
  });
  test('错误导入和无效替换不改变旧文档', () => {
    const doc = C.parse(template);
    throws(() => C.parse('OptionSettings=(X="'), '引号');
    throws(() => C.serialize(doc, new Map([['ServerName', '"broken']])));
    equal(C.serialize(doc), template);
  });
  test('原始值拒绝未包裹逗号和尾随字符串内容', () => {
    throws(() => C.validateRaw('a,b'), '逗号');
    throws(() => C.validateRaw('"a"junk'), '字符串格式');
    equal(C.validateRaw(''), '');
    equal(C.validateRaw('(Steam,Xbox)'), '(Steam,Xbox)');
  });
  test('数值检查允许零值和字段允许的负值', () => {
    equal(Schema.validate('PalEggDefaultHatchingTime', '0'), null);
    equal(Schema.validate('PhysicsActiveDropItemMaxNum', '-1'), null);
    equal(Schema.validate('ExpRate', '0'), null);
    equal(Schema.validate('SomeFutureNumber', '-999'), null);
    equal(Boolean(Schema.validate('ServerPlayerMaxNum', '1.5')), true);
    equal(Boolean(Schema.validate('PublicPort', '65536')), true);
    equal(Boolean(Schema.validate('ExpRate', 'NaN')), true);
    equal(Boolean(Schema.validate('ExpRate', 'Infinity')), true);
    equal(Boolean(Schema.validate('ExpRate', '')), true);
  });
  test('检查布尔与字符串，保留未知枚举', () => {
    equal(Schema.validate('bIsPvP', 'True'), null);
    equal(Boolean(Schema.validate('bIsPvP', 'oops')), true);
    equal(Schema.validate('ServerName', '"名字"'), null);
    equal(Boolean(Schema.validate('ServerName', '名字')), true);
    equal(Schema.validate('RandomizerType', 'FutureMode'), null);
  });
  test('模板所有已知字段均通过类型和范围检查', () => {
    for (const e of C.parse(template).entries) equal([e.key, Schema.validate(e.key, e.raw)], [e.key, null]);
  });
  test('拒绝重复 ID、不完整记录和无效 activeId', () => {
    const data = workspace();
    data.profiles.push({ ...data.profiles[0] });
    throws(() => validateWorkspace(data), '不完整');
    throws(() => validateWorkspace({ ...workspace(), activeId: 'missing' }), '不存在');
    throws(() => validateWorkspace({ version: 1, profiles: [{ id: 'x' }], activeId: 'x' }), '不完整');
  });
  return cases;
}
