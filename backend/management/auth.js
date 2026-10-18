import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { isIP } from 'node:net';
import { isLoopbackOrPrivate } from '../../shared/domain/network.js';
import { failure } from './files.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const scryptAsync = promisify(scrypt);

// scrypt is deliberately expensive; cap concurrent hashes so unauthenticated
// requests cannot stall the event loop used by the game supervisor and logs.
const MAX_CONCURRENT_HASHES = 2;
const MAX_QUEUED_HASHES = 32;
let activeHashes = 0;
const hashWaiters = [];

async function hashPassword(password, salt) {
  if (activeHashes < MAX_CONCURRENT_HASHES) activeHashes++;
  else {
    if (hashWaiters.length >= MAX_QUEUED_HASHES) throw failure('尝试过于频繁，请稍后再试。', 429);
    // The releasing hash transfers its slot to this waiter.
    await new Promise(resolve => hashWaiters.push(resolve));
  }
  try { return await scryptAsync(password, salt, 64); }
  finally {
    const next = hashWaiters.shift();
    if (next) next();
    else activeHashes--;
  }
}

export const normalizeUsername = value => typeof value === 'string' ? value.trim() : '';
export const validUsername = value => typeof value === 'string' && value.length >= 1 && value.length <= 64 && !/[\p{Cc}\p{Cf}]/u.test(value);

export async function passwordRecord(password) {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: (await hashPassword(password, salt)).toString('hex') };
}

export class Authentication {
  constructor(record, {
    secureCookie = false,
    sessionMs = 12 * 60 * 60 * 1000,
    windowMs = 5 * 60 * 1000,
    maxFailures = 10,
    cooldownMs = 5000,
    maxEntries = 1000,
    log = () => {}
  } = {}) {
    this.record = record;
    this.secureCookie = secureCookie;
    this.sessionMs = sessionMs;
    this.windowMs = windowMs;
    this.maxFailures = maxFailures;
    this.cooldownMs = cooldownMs;
    this.maxEntries = maxEntries;
    this.log = log;
    this.sessions = new Map();
    this.attempts = new Map();
  }
  get adminRecord() { return typeof this.record === 'function' ? this.record() : this.record; }
  session(request) {
    const token = request.headers.cookie?.split(';').map(p => p.trim()).find(p => p.startsWith('palbox_session='))?.slice(15);
    if (!token) return null;
    const key = digest(token);
    const session = this.sessions.get(key);
    if (!session || session.expires <= Date.now()) { this.sessions.delete(key); return null; }
    return { ...session, key };
  }
  /**
   * The browser talks to the frontend proxy, so trust its dedicated client-IP
   * header only when the immediate peer is local/private. Direct public
   * connections always use the socket address, so the header cannot be spoofed
   * from the internet.
   */
  clientAddress(request) {
    const peer = request.socket?.remoteAddress || '';
    if (isLoopbackOrPrivate(peer)) {
      const forwarded = request.headers?.['x-palbox-client-ip'];
      if (typeof forwarded === 'string' && isIP(forwarded)) return forwarded;
    }
    return peer;
  }
  async login(request, username, password, response) {
    const record = this.adminRecord;
    if (!record) throw failure('管理面板尚未初始化，请先设置管理员账号。', 409);
    const ip = this.clientAddress(request);
    const now = Date.now();
    for (const [key, value] of this.attempts) if (value.expires <= now) this.attempts.delete(key);
    let attempts = this.attempts.get(ip);
    if (!attempts) {
      if (this.attempts.size >= this.maxEntries) {
        const oldest = this.attempts.keys().next().value;
        if (oldest !== undefined) this.attempts.delete(oldest);
      }
      attempts = { count: 0, expires: now + this.windowMs, blockedUntil: 0 };
      this.attempts.set(ip, attempts);
    }
    if (now < attempts.blockedUntil) {
      response.setHeader('Retry-After', String(Math.max(1, Math.ceil((attempts.blockedUntil - now) / 1000))));
      this.log(`登录尝试过于频繁（${ip}）\n`);
      throw failure('尝试过于频繁，请稍后再试。', 429);
    }
    const nameMatches = normalizeUsername(username) === record.username;
    const passwordMatches = typeof password === 'string' && password.length <= 1024
      && timingSafeEqual(await hashPassword(password, record.salt), Buffer.from(record.hash, 'hex'));
    if (!nameMatches || !passwordMatches) {
      attempts.count++;
      attempts.expires = now + this.windowMs;
      // Short cooldown instead of a long lockout: an attacker cannot keep the
      // administrator locked out, while online guessing stays rate limited.
      if (attempts.count >= this.maxFailures) attempts.blockedUntil = Math.max(attempts.blockedUntil, now + this.cooldownMs);
      this.log(`登录失败（${ip}，用户名 ${JSON.stringify(normalizeUsername(username)).slice(0, 80)}）\n`);
      throw failure('用户名或密码不正确。', 401);
    }
    this.attempts.delete(ip);
    for (const [key, value] of this.sessions) if (value.expires <= now) this.sessions.delete(key);
    if (this.sessions.size >= 100) this.sessions.delete(this.sessions.keys().next().value);
    const token = randomBytes(32).toString('hex');
    const csrf = randomBytes(24).toString('hex');
    this.sessions.set(digest(token), { csrf, expires: now + this.sessionMs });
    response.setHeader('Set-Cookie', `palbox_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(this.sessionMs / 1000)}${this.secureCookie ? '; Secure' : ''}`);
    this.log(`登录成功（${ip}）\n`);
    return { csrf };
  }
  verifyOrigin(request) {
    const origin = request.headers.origin;
    if (request.headers['sec-fetch-site'] === 'cross-site') throw failure('请求来源不正确。', 403);
    if (origin) {
      let url;
      try { url = new URL(origin); } catch { throw failure('请求来源不正确。', 403); }
      if (!['http:', 'https:'].includes(url.protocol) || url.host !== request.headers.host) throw failure('请求来源不正确。', 403);
    }
  }
  require(request, mutate = false) {
    const session = this.session(request);
    if (!session) throw failure('请先登录管理面板。', 401);
    if (mutate) {
      this.verifyOrigin(request);
      if (request.headers['x-palbox-csrf'] !== session.csrf) throw failure('登录验证已失效，请刷新页面。', 403);
    }
    return session;
  }
  logout(request, response) {
    const session = this.require(request, true);
    this.sessions.delete(session.key);
    response.setHeader('Set-Cookie', 'palbox_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  }
}
