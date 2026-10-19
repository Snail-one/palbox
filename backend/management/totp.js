import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_PERIOD = 30;

export function encodeSecret(bytes) {
  let bits = 0, value = 0, result = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { bits -= 5; result += ALPHABET[(value >>> bits) & 31]; }
  }
  if (bits) result += ALPHABET[(value << (5 - bits)) & 31];
  return result;
}

function decodeSecret(secret) {
  if (typeof secret !== 'string' || secret.length !== 32 || !/^[A-Z2-7]{32}$/.test(secret)) throw new Error('TOTP 密钥无效');
  let bits = 0, value = 0;
  const bytes = [];
  for (const char of secret) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 255); }
  }
  return Buffer.from(bytes);
}

// RFC 4226 dynamic truncation; RFC 6238 uses the 30-second time step as counter.
export function totpCode(secret, counter) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', decodeSecret(secret)).update(message).digest();
  const offset = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}

export function verifyTotp(secret, code, { now = Date.now(), lastCounter = -1 } = {}) {
  if (typeof code !== 'string' || code.length !== 6 || !/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 1000 / TOTP_PERIOD);
  let matched = null;
  for (const counter of [current, current - 1, current + 1]) {
    if (counter < 0) continue;
    if (timingSafeEqual(Buffer.from(code), Buffer.from(totpCode(secret, counter))) && counter > lastCounter && matched === null) matched = counter;
  }
  return matched;
}

export const newSecret = () => encodeSecret(randomBytes(20));
export function recoveryHash(code) {
  const normalized = typeof code === 'string' ? code.trim().replaceAll('-', '').toUpperCase() : '';
  if (!/^[A-F0-9]{20}$/.test(normalized)) return null;
  return createHash('sha256').update(normalized).digest('hex');
}
export function newRecoveryCodes() {
  return Array.from({ length: 10 }, () => randomBytes(10).toString('hex').toUpperCase().match(/.{5}/g).join('-'));
}
export function verifyFactor(totp, code, now = Date.now()) {
  const counter = verifyTotp(totp.secret, code, { now, lastCounter: totp.lastCounter });
  if (counter !== null) return { ...totp, lastCounter: counter };
  const hash = recoveryHash(code);
  if (hash && totp.recoveryHashes.includes(hash)) return { ...totp, recoveryHashes: totp.recoveryHashes.filter(value => value !== hash) };
  return null;
}
export function validTotpRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && typeof value.secret === 'string' && value.secret.length === 32 && /^[A-Z2-7]{32}$/.test(value.secret)
    && Number.isSafeInteger(value.lastCounter) && value.lastCounter >= -1
    && Array.isArray(value.recoveryHashes) && value.recoveryHashes.length <= 10
    && new Set(value.recoveryHashes).size === value.recoveryHashes.length
    && value.recoveryHashes.every(hash => typeof hash === 'string' && hash.length === 64 && /^[a-f0-9]{64}$/.test(hash)));
}
