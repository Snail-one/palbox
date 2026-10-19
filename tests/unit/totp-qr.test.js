import { test } from 'node:test';
import assert from 'node:assert/strict';
import { totpUri, totpQrImage } from '../../frontend/src/ui/totp-qr.js';

const setup = { secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', account: '管理员 & test?#', issuer: 'PalBox' };
test('绑定 URI 正确编码账号，保留验证器需要的密钥和算法参数', () => {
  const uri = new URL(totpUri(setup));
  assert.equal(uri.protocol, 'otpauth:');
  assert.equal(uri.hostname, 'totp');
  assert.equal(decodeURIComponent(uri.pathname), '/PalBox:管理员 & test?#');
  assert.equal(uri.searchParams.get('secret'), setup.secret);
  assert.equal(uri.searchParams.get('issuer'), 'PalBox');
  assert.equal(uri.searchParams.get('algorithm'), 'SHA1');
  assert.equal(uri.searchParams.get('digits'), '6');
  assert.equal(uri.searchParams.get('period'), '30');
  assert.equal(uri.hash, '');
});

test('二维码编码为独立 SVG 图片，无外部请求、脚本或明文密钥', () => {
  const image = totpQrImage(setup);
  assert.ok(image.startsWith('data:image/svg+xml;charset=utf-8,'));
  const svg = decodeURIComponent(image.slice(image.indexOf(',') + 1));
  assert.match(svg, /^<svg /);
  assert.match(svg, /<path d="M/);
  assert.doesNotMatch(svg, /<script|href=|style=|otpauth:|GEZDGNBVGY3TQOJQ/);
  assert.ok(image !== totpQrImage({ ...setup, secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' }));
});
