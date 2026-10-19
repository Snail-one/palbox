import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeSecret, totpCode, verifyTotp, verifyFactor, newSecret, newRecoveryCodes, recoveryHash, validTotpRecord } from '../../backend/management/totp.js';

const secret = encodeSecret(Buffer.from('12345678901234567890'));
test('TOTP 符合 RFC 4226 与 RFC 6238 的 SHA-1 测试向量', () => {
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  const hotp = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  hotp.forEach((code, counter) => assert.equal(totpCode(secret, counter), code));
  for (const [seconds, expected] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']]) {
    assert.equal(totpCode(secret, Math.floor(seconds / 30)), expected);
  }
});

test('验证码只接受 6 位、有限时钟偏差，并拒绝同一步重复使用', () => {
  const now = 1234567890000;
  const counter = Math.floor(now / 30000);
  for (const offset of [-1, 0, 1]) {
    const code = totpCode(secret, counter + offset);
    assert.equal(verifyTotp(secret, code, { now }), counter + offset);
    assert.equal(verifyTotp(secret, code, { now, lastCounter: counter + offset }), null);
  }
  assert.equal(verifyTotp(secret, totpCode(secret, counter - 2), { now }), null);
  for (const code of [123456, '', '12345', '1234567', ' 005924 ', '005924\n', '１２３４５６']) assert.equal(verifyTotp(secret, code, { now }), null);
});

test('密钥和恢复码使用独立随机数，恢复码只以摘要存储且只能消费一次', () => {
  assert.match(newSecret(), /^[A-Z2-7]{32}$/);
  assert.notEqual(newSecret(), newSecret());
  const codes = newRecoveryCodes();
  assert.equal(new Set(codes).size, 10);
  const record = { secret, lastCounter: -1, recoveryHashes: codes.map(recoveryHash) };
  assert.equal(validTotpRecord(record), true);
  const consumed = verifyFactor(record, codes[0].toLowerCase());
  assert.equal(consumed.recoveryHashes.length, 9);
  assert.equal(verifyFactor(consumed, codes[0]), null);
  assert.equal(record.recoveryHashes.length, 10);
  assert.equal(recoveryHash(codes[0].replaceAll('-', '')), recoveryHash(codes[0]));
  assert.equal(recoveryHash('bad'), null);
  for (const broken of [{ ...record, secret: [secret] }, { ...record, secret: '' }, { ...record, secret: secret + '\n' }, { ...record, lastCounter: '1' }, { ...record, recoveryHashes: [codes[0]] }, { ...record, recoveryHashes: [record.recoveryHashes[0], record.recoveryHashes[0]] }]) assert.equal(validTotpRecord(broken), false);
});
