import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configuredWorldId } from '../../backend/management/native-backups.js';

for (const [name, source, expected] of [
  ['读取世界配置段，忽略其他段的同名参数', '[Other]\nDedicatedServerName=DECOY\n[/Script/Pal.PalGameLocalSettings]\nDedicatedServerName=CURRENT\n', 'CURRENT'],
  ['其他段中的参数不能冒充世界配置', '[Other]\nDedicatedServerName=DECOY\n', null],
  ['重复世界参数不能确认当前世界', '[/Script/Pal.PalGameLocalSettings]\nDedicatedServerName=FIRST\nDedicatedServerName=LAST\n', null],
  ['参数值不能跨行读取', 'DedicatedServerName=\nOTHER\n', null],
  ['参数值必须正确配对引号', 'DedicatedServerName="BROKEN\n', null],
  ['兼容旧版无段落头的配置', 'DedicatedServerName=CURRENT\n', 'CURRENT'],
  ['保留对 BOM、空格、引号及 CRLF 的支持', '\uFEFF[/Script/Pal.PalGameLocalSettings]\r\n  DedicatedServerName = "CURRENT"  \r\n', 'CURRENT'],
  ['注释中的世界参数无效', '[/Script/Pal.PalGameLocalSettings]\n;DedicatedServerName=COMMENTED\n', null]
]) test(name, () => assert.equal(configuredWorldId(source), expected));
