import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { isIP } from 'node:net';
import { isLoopbackOrPrivate } from '../../shared/domain/network.js';
import { failure } from './files.js';
import { newSecret, newRecoveryCodes, recoveryHash, verifyTotp, verifyFactor } from './totp.js';

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
    log = () => {},
    updateAdmin = async () => { throw new Error('账号存储未配置'); }
  } = {}) {
    this.record = record;
    this.secureCookie = secureCookie;
    this.sessionMs = sessionMs;
    this.windowMs = windowMs;
    this.maxFailures = maxFailures;
    this.cooldownMs = cooldownMs;
    this.maxEntries = maxEntries;
    this.log = log;
    this.updateAdmin = updateAdmin;
    this.challenges = new Map();
    this.enrollments = new Map();
    this.sessions = new Map();
    this.attempts = new Map();
  }
  get adminRecord() { return typeof this.record === 'function' ? this.record() : this.record; }
  signature(record = this.adminRecord) { return digest(`${record?.hash}:${record?.totp?.secret || ''}`); }
  session(request) {
    const token = request.headers.cookie?.split(';').map(p => p.trim()).find(p => p.startsWith('palbox_session='))?.slice(15);
    if (!token) return null;
    const key = digest(token);
    const session = this.sessions.get(key);
    if (!session || session.expires <= Date.now() || session.signature !== this.signature()) { this.sessions.delete(key); return null; }
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
    if (!isLoopbackOrPrivate(peer)) return peer;
    const forwarded = request.headers?.['x-palbox-client-ip'];
    if (forwarded !== undefined) return typeof forwarded === 'string' && isIP(forwarded) ? forwarded : '';
    return peer;
  }
  attempt(request, response) {
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
    return { ip, attempts };
  }
  failed(request, attempts, message, detail = '') {
    const now = Date.now();
    attempts.count++;
    attempts.expires = now + this.windowMs;
    if (attempts.count >= this.maxFailures) attempts.blockedUntil = Math.max(attempts.blockedUntil, now + this.cooldownMs);
    this.log(`登录失败（${this.clientAddress(request)}${detail ? `，${detail}` : ''}）\n`);
    throw failure(message, 401);
  }
  async passwordMatches(password, record) {
    return typeof password === 'string' && password.length <= 1024
      && timingSafeEqual(await hashPassword(password, record.salt), Buffer.from(record.hash, 'hex'));
  }
  async login(request, username, password, response) {
    const record = this.adminRecord;
    if (!record) throw failure('管理面板尚未初始化，请先设置管理员账号。', 409);
    const { attempts } = this.attempt(request, response);
    const nameMatches = normalizeUsername(username) === record.username;
    const passwordMatches = await this.passwordMatches(password, record);
    if (!nameMatches || !passwordMatches || this.signature(record) !== this.signature()) {
      this.failed(request, attempts, '用户名或密码不正确。', `用户名 ${JSON.stringify(normalizeUsername(username)).slice(0, 80)}`);
    }
    if (record.totp) {
      this.prune(this.challenges);
      const challenge = randomBytes(32).toString('hex');
      this.challenges.set(digest(challenge), { ip: this.clientAddress(request), signature: this.signature(), expires: Date.now() + 5 * 60 * 1000, failures: 0, pending: false });
      return { totpRequired: true, challenge };
    }
    return this.issueSession(request, response);
  }
  issueSession(request, response) {
    const ip = this.clientAddress(request);
    const now = Date.now();
    this.attempts.delete(ip);
    for (const [key, value] of this.sessions) if (value.expires <= now) this.sessions.delete(key);
    if (this.sessions.size >= 100) this.sessions.delete(this.sessions.keys().next().value);
    const token = randomBytes(32).toString('hex');
    const csrf = randomBytes(24).toString('hex');
    this.sessions.set(digest(token), { csrf, expires: now + this.sessionMs, signature: this.signature() });
    response.setHeader('Set-Cookie', `palbox_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(this.sessionMs / 1000)}${this.secureCookie ? '; Secure' : ''}`);
    this.log(`登录成功（${ip}）\n`);
    return { csrf };
  }
  prune(map) {
    for (const [key, value] of map) if (value.expires <= Date.now()) map.delete(key);
    if (map.size >= this.maxEntries) map.delete(map.keys().next().value);
  }
  async completeLogin(request, input, response) {
    const { attempts } = this.attempt(request, response);
    const key = typeof input.challenge === 'string' ? digest(input.challenge) : '';
    const challenge = this.challenges.get(key);
    if (!challenge || challenge.expires <= Date.now() || challenge.ip !== this.clientAddress(request) || challenge.signature !== this.signature()) {
      this.challenges.delete(key);
      this.failed(request, attempts, '二次验证已失效，请重新输入用户名和密码。', '二次验证已失效');
    }
    if (challenge.pending) throw failure('二次验证正在进行，请稍后重试。', 409);
    challenge.pending = true;
    try {
      await this.updateAdmin(admin => {
        if (this.challenges.get(key) !== challenge || challenge.expires <= Date.now() || challenge.signature !== this.signature(admin) || !admin.totp) throw failure('二次验证已失效，请重新登录。', 401);
        const next = verifyFactor(admin.totp, input.code);
        if (!next) {
          challenge.failures++;
          if (challenge.failures >= 5) this.challenges.delete(key);
          this.failed(request, attempts, '动态验证码或恢复码不正确、已使用或已过期。', '二次验证失败');
        }
        return { ...admin, totp: next };
      });
      this.challenges.delete(key);
      if (challenge.signature !== this.signature()) throw failure('账号验证设置已变化，请重新登录。', 401);
      return this.issueSession(request, response);
    } finally { challenge.pending = false; }
  }
  securityStatus() {
    return { enabled: Boolean(this.adminRecord?.totp), recoveryCodesRemaining: this.adminRecord?.totp?.recoveryHashes.length ?? 0 };
  }
  async reauthenticate(request, password, response) {
    const { attempts } = this.attempt(request, response);
    const record = this.adminRecord;
    if (!record || !(await this.passwordMatches(password, record)) || this.signature(record) !== this.signature()) {
      this.failed(request, attempts, '管理员密码不正确。', '账号安全验证失败');
    }
    return { attempts, signature: this.signature(record) };
  }
  async beginEnrollment(request, password, response) {
    const checked = await this.reauthenticate(request, password, response);
    const session = this.require(request, true);
    if (this.adminRecord.totp) throw failure('二次验证已启用，请先关闭后再绑定新的验证器。', 409);
    const secret = newSecret();
    this.prune(this.enrollments);
    this.enrollments.set(session.key, { secret, signature: checked.signature, expires: Date.now() + 10 * 60 * 1000 });
    return { secret, account: this.adminRecord.username, issuer: 'PalBox', period: 30, digits: 6 };
  }
  retainSession(session) {
    for (const key of this.sessions.keys()) if (key !== session.key) this.sessions.delete(key);
    const current = this.sessions.get(session.key);
    if (current) current.signature = this.signature();
    this.challenges.clear();
    this.enrollments.clear();
  }
  async confirmEnrollment(request, code, response) {
    const session = this.require(request, true);
    const { attempts } = this.attempt(request, response);
    const pending = this.enrollments.get(session.key);
    if (!pending || pending.expires <= Date.now() || pending.signature !== this.signature()) throw failure('绑定已过期，请重新开始。', 409);
    const codes = newRecoveryCodes();
    await this.updateAdmin(admin => {
      this.require(request, true);
      if (this.enrollments.get(session.key) !== pending || pending.expires <= Date.now() || admin.totp || pending.signature !== this.signature(admin)) throw failure('绑定或账号验证设置已变化，请重新开始。', 409);
      const counter = verifyTotp(pending.secret, code);
      if (counter === null) this.failed(request, attempts, '动态验证码不正确或已过期。', '绑定二次验证失败');
      return { ...admin, totp: { secret: pending.secret, lastCounter: counter, recoveryHashes: codes.map(recoveryHash) } };
    });
    this.retainSession(session);
    this.attempts.delete(this.clientAddress(request));
    this.log(`二次验证已启用（${this.clientAddress(request)}）\n`);
    return { ...this.securityStatus(), recoveryCodes: codes };
  }
  async changeSecurity(request, input, response, disable = false) {
    const session = this.require(request, true);
    const checked = await this.reauthenticate(request, input.password, response);
    const codes = disable ? null : newRecoveryCodes();
    await this.updateAdmin(admin => {
      this.require(request, true);
      if (checked.signature !== this.signature(admin) || !admin.totp) throw failure('账号验证设置已变化，请重新打开账号安全。', 409);
      const verified = verifyFactor(admin.totp, input.code);
      if (!verified) this.failed(request, checked.attempts, '动态验证码或恢复码不正确、已使用或已过期。', '账号安全二次验证失败');
      const next = { ...admin };
      if (disable) delete next.totp;
      else next.totp = { ...verified, recoveryHashes: codes.map(recoveryHash) };
      return next;
    });
    this.retainSession(session);
    this.attempts.delete(this.clientAddress(request));
    this.log(`二次验证${disable ? '已关闭' : '恢复码已重新生成'}（${this.clientAddress(request)}）\n`);
    return { ...this.securityStatus(), ...(codes ? { recoveryCodes: codes } : {}) };
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
