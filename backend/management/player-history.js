import path from 'node:path';
import { createReadStream } from 'node:fs';
import { readdir, lstat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { isIP } from 'node:net';
import { stripVTControlCharacters } from 'node:util';
import { jsonWrite, readJson, failure } from './files.js';

const PAGE_SIZE = 10;
const text = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) : '';
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

function identity(player) {
  if (!player || typeof player !== 'object' || typeof player.userId !== 'string') return null;
  let userId = player.userId.trim().split(',', 1)[0].trim();
  if (/^\d{17}$/.test(userId)) userId = `steam_${userId}`;
  if (!userId || userId.length > 200 || /[\u0000-\u0020\u007f]/.test(userId)) return null;
  return {
    userId, name: text(player.name), ip: typeof player.ip === 'string' && isIP(player.ip) ? player.ip : ''
  };
}

/** Read game connection/join events, never REST access or chat messages. */
export function parsePlayerConnection(raw, fallbackAt) {
  let line = stripVTControlCharacters(raw).trim();
  let at = fallbackAt;
  let receivedAt = fallbackAt;
  for (let index = 0; index < 4; index++) {
    if (line.startsWith('[game]')) { line = line.slice(6).trimStart(); continue; }
    const stamp = line.match(/^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)(?: UTC([+-]\d{2}:\d{2})?)?\]\s*/);
    if (!stamp) break;
    const timestamp = `${stamp[1]}T${stamp[2]}${stamp[3] || 'Z'}`;
    if (!validDate(timestamp)) return null;
    at = new Date(timestamp).toISOString();
    receivedAt ||= at;
    line = line.slice(stamp[0].length);
  }
  const connection = line.match(/^\[LOG\]\s+(.+)\s+(\S+) connected the server\.\s+\(User id:\s*([A-Za-z0-9_:-]+)\)\s*$/);
  const joined = line.match(/^\[LOG\]\s+(.+) joined the server\.\s+\(User id:\s*([A-Za-z0-9_:-]+)(?:, Player id:\s*[A-Fa-f0-9]{32})?\)\s*$/);
  if (!validDate(at) || (!connection && !joined) || (connection && !isIP(connection[2]))) return null;
  const player = identity(connection ? { name: connection[1], ip: connection[2], userId: connection[3] } : { name: joined[1], userId: joined[2] });
  return player ? { ...player, type: connection ? 'connected' : 'joined', at: new Date(at).toISOString(), receivedAt: new Date(receivedAt).toISOString() } : null;
}

/** One durable record per game account, outside the replaceable world directory. */
export class PlayerHistory {
  constructor(directory) {
    this.file = path.join(directory, 'palbox/player-history.json');
    this.players = new Map();
    this.clearedAt = null;
    this.pending = Promise.resolve();
  }
  async initialize() {
    const value = await readJson(this.file, { version: 1, players: [] });
    if (value?.version !== 1 || !Array.isArray(value.players)) throw new Error('玩家历史记录格式无效，请检查 player-history.json。');
    if (value.clearedAt != null && !validDate(value.clearedAt)) throw new Error('玩家历史清理时间无效。');
    this.clearedAt = value.clearedAt || null;
    for (const player of value.players) {
      const normalized = identity(player);
      if (!normalized || normalized.userId !== player.userId || !validDate(player.firstSeenAt) || !validDate(player.lastSeenAt) || player.firstSeenAt > player.lastSeenAt || this.players.has(player.userId)) {
        throw new Error('玩家历史记录损坏，请检查 player-history.json。');
      }
      if (player.lastLoginAt != null && !validDate(player.lastLoginAt)) throw new Error('玩家历史记录的登录时间无效。');
      const loginStatus = player.loginStatus === 'succeeded' || player.loginStatus === 'connected' ? player.loginStatus : player.lastLoginAt && player.lastLoginAt >= player.lastSeenAt ? 'succeeded' : 'connected';
      this.players.set(player.userId, { ...normalized, firstSeenAt: player.firstSeenAt, lastSeenAt: player.lastSeenAt, lastLoginAt: player.lastLoginAt || null, loginStatus });
    }
  }
  record(players, at = new Date().toISOString()) {
    if (!Array.isArray(players) || !validDate(at)) return Promise.reject(new Error('玩家列表格式无效。'));
    return this.recordEvents(players.map(player => ({ ...player, at })));
  }
  recordEvents(events) {
    const entries = events.map(event => ({ player: identity(event), type: event.type || 'connected', at: validDate(event.at) ? new Date(event.at).toISOString() : null, receivedAt: validDate(event.receivedAt) ? new Date(event.receivedAt).toISOString() : event.at })).filter(event => event.player && event.at && ['connected', 'joined'].includes(event.type));
    const pending = this.pending.then(async () => {
      if (!entries.length) return;
      const next = new Map(this.players);
      let changed = false;
      for (const { player, at, type, receivedAt } of entries) {
        if (this.clearedAt && receivedAt <= this.clearedAt) continue;
        const previous = next.get(player.userId);
        const latest = !previous || at >= (previous.lastLoginAt && previous.lastLoginAt > previous.lastSeenAt ? previous.lastLoginAt : previous.lastSeenAt);
        const value = {
          userId: player.userId, name: latest ? player.name || previous?.name || '' : previous.name,
          ip: type === 'connected' && (!previous || at >= previous.lastSeenAt) ? player.ip || previous?.ip || '' : previous?.ip || '',
          firstSeenAt: previous && previous.firstSeenAt < at ? previous.firstSeenAt : at,
          lastSeenAt: previous && (type === 'joined' || previous.lastSeenAt > at) ? previous.lastSeenAt : at,
          lastLoginAt: type === 'joined' && (!previous?.lastLoginAt || at > previous.lastLoginAt) ? at : previous?.lastLoginAt || null,
          loginStatus: type === 'joined' && (!previous || at >= previous.lastSeenAt) ? 'succeeded' : type === 'connected' && latest ? 'connected' : previous?.loginStatus || 'connected'
        };
        if (JSON.stringify(previous) === JSON.stringify(value)) continue;
        changed = true; next.set(player.userId, value);
      }
      if (!changed) return false;
      await jsonWrite(this.file, { version: 1, clearedAt: this.clearedAt, players: [...next.values()] });
      this.players = next;
      return true;
    });
    this.pending = pending.catch(() => {});
    return pending;
  }
  clear({ authorize = () => {}, at = new Date().toISOString() } = {}) {
    const pending = this.pending.then(async () => {
      authorize();
      const count = this.players.size;
      await jsonWrite(this.file, { version: 1, clearedAt: at, players: [] }, { beforeCommit: authorize });
      this.players = new Map(); this.clearedAt = at;
      return { cleared: count };
    });
    this.pending = pending.catch(() => {});
    return pending;
  }
  list({ query = '', page = '1' } = {}) {
    if (typeof query !== 'string' || query.length > 200 || !/^[1-9]\d{0,6}$/.test(String(page))) throw failure('玩家历史查询参数无效。');
    const search = query.trim().toLocaleLowerCase();
    const matches = [...this.players.values()].filter(player => !search || [player.name, player.userId, player.ip].some(value => value.toLocaleLowerCase().includes(search)));
    matches.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt) || a.userId.localeCompare(b.userId));
    const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
    const currentPage = Math.min(Number(page), pageCount);
    return {
      players: matches.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map(player => ({ ...player })),
      total: matches.length, recorded: this.players.size, page: currentPage, pageCount, pageSize: PAGE_SIZE
    };
  }
}

/** Consume game output as it arrives, and replay retained game logs on startup. */
export class PlayerHistoryRecorder {
  constructor({ history, runtime, onChange }) {
    this.history = history;
    this.runtime = runtime;
    this.onChange = onChange;
    this.revision = 0;
    this.error = null;
    this.pending = Promise.resolve();
    this.closed = false;
    this.buffer = '';
    this.discardLine = false;
    this.listener = ({ text, at }) => this.ingest(text, at);
  }
  async start() {
    if (this.started || this.closed) return;
    this.started = true;
    this.runtime.on('game-log', this.listener);
    const directory = path.join(this.runtime.directory, 'logs');
    try {
      const files = (await readdir(directory)).filter(file => /^game\.log(?:\.\d+)?$/.test(file));
      files.sort((a, b) => Number(b.split('.')[2] || 0) - Number(a.split('.')[2] || 0));
      for (const file of files) {
        const name = path.join(directory, file);
        try {
          if (!(await lstat(name)).isFile()) continue;
          const input = createReadStream(name, { encoding: 'utf8' });
          const lines = createInterface({ input, crlfDelay: Infinity });
          const streamError = error => lines.close();
          input.on('error', streamError);
          let readError;
          input.once('error', error => { readError = error; });
          let batch = [];
          try {
            for await (const line of lines) {
              if (line.length > 65536) continue;
              const event = parsePlayerConnection(line);
              if (event) batch.push(event);
              if (batch.length >= 250) { await this.commit(batch); batch = []; }
            }
            if (readError) throw readError;
            if (batch.length) await this.commit(batch);
          } finally { lines.close(); input.destroy(); }
        } catch (error) { if (error.code !== 'ENOENT') this.report(error); }
      }
    } catch (error) { if (error.code !== 'ENOENT') this.report(error); }
  }
  report(error) {
    const detail = error.code || error.message;
    if (this.error !== detail) this.runtime.log('palbox', `无法记录玩家历史：${error.message}\n`);
    this.error = detail;
  }
  commit(events) {
    this.pending = this.pending.then(async () => {
      try {
        const changed = await this.history.recordEvents(events); this.error = null;
        if (changed) { this.revision++; this.onChange?.(); }
      }
      catch (error) { this.report(error); }
    });
    return this.pending;
  }
  ingest(text, at) {
    if (this.closed) return;
    const lines = (this.buffer + text).split('\n'); this.buffer = lines.pop();
    const events = [];
    for (const line of lines) {
      if (this.discardLine) { this.discardLine = false; continue; }
      if (line.length > 65536) continue;
      const event = parsePlayerConnection(line, at);
      if (event) events.push(event);
    }
    if (this.buffer.length > 65536) { this.buffer = ''; this.discardLine = true; }
    if (events.length) void this.commit(events);
  }
  async close() {
    if (!this.discardLine && this.buffer) this.ingest('\n', new Date().toISOString());
    this.closed = true;
    this.runtime.off('game-log', this.listener);
    await this.pending;
    await this.history.pending;
  }
}
