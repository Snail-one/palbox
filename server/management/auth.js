import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { failure } from './files.js';

const digest = value => createHash('sha256').update(value).digest('hex');

export const normalizeUsername = value => typeof value === 'string' ? value.trim() : '';
export const validUsername = value => typeof value === 'string' && value.length >= 1 && value.length <= 64 && !/[\p{Cc}\p{Cf}]/u.test(value);

export function passwordRecord(password) {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}

export class Authentication {
  constructor(record, { secureCookie = false, sessionMs = 12 * 60 * 60 * 1000 } = {}) {
    this.record = record;
    this.secureCookie = secureCookie;
    this.sessionMs = sessionMs;
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
  login(request, username, password, response) {
    const record = this.adminRecord;
    if (!record) throw failure('管理面板尚未初始化，请先设置管理员账号。', 409);
    const ip = request.socket.remoteAddress;
    const now = Date.now();
    for (const [key, value] of this.attempts) if (value.until <= now) this.attempts.delete(key);
    const attempts = this.attempts.get(ip) || { count: 0, until: now + 5 * 60 * 1000 };
    if (attempts.count >= 10 || this.attempts.size > 1000) throw failure('尝试过于频繁，请稍后再试。', 429);
    attempts.count++;
    this.attempts.set(ip, attempts);
    const nameMatches = normalizeUsername(username) === record.username;
    const passwordMatches = typeof password === 'string' && password.length <= 1024 && timingSafeEqual(scryptSync(password, record.salt, 64), Buffer.from(record.hash, 'hex'));
    if (!nameMatches || !passwordMatches) throw failure('用户名或密码不正确。', 401);
    this.attempts.delete(ip);
    for (const [key, value] of this.sessions) if (value.expires <= now) this.sessions.delete(key);
    if (this.sessions.size >= 100) this.sessions.delete(this.sessions.keys().next().value);
    const token = randomBytes(32).toString('hex');
    const csrf = randomBytes(24).toString('hex');
    this.sessions.set(digest(token), { csrf, expires: now + this.sessionMs });
    response.setHeader('Set-Cookie', `palbox_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(this.sessionMs / 1000)}${this.secureCookie ? '; Secure' : ''}`);
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
