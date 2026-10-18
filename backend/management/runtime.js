import { spawn } from 'node:child_process';
import { mkdir, readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import path from 'node:path';
import { decodeString, parse } from '../../shared/domain/config.js';
import { failure } from './files.js';
import { appendLog, appendCombinedLog, initializeCombinedLog, readCombinedLog, readLogTail } from './logs.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export class Runtime {
  constructor(directory, { steamcmd = '/opt/steamcmd/steamcmd.sh', port = 8211, readyTimeout = 180000, stopTimeout = 60000, args = [], installArgs = null } = {}) {
    this.directory = directory;
    this.server = path.join(directory, 'server');
    this.saved = path.join(this.server, 'Pal/Saved');
    this.config = path.join(this.saved, 'Config/LinuxServer/PalWorldSettings.ini');
    this.steamcmd = steamcmd;
    this.port = port;
    this.readyTimeout = readyTimeout;
    this.stopTimeout = stopTimeout;
    this.args = args;
    this.installArgs = installArgs;
    this.game = null;
    this.command = null;
    this.ready = false;
    this.runningSource = null;
    this.startedAt = null;
    this.lastExit = null;
    this.closing = false;
    this.logDecoders = new Map();
  }
  async initialize() {
    await mkdir(path.join(this.directory, 'logs'), { recursive: true, mode: 0o700 });
    await initializeCombinedLog(this.directory);
  }
  log(channel, value) {
    const file = path.join(this.directory, 'logs', `${channel}.log`);
    try {
      appendLog(file, Buffer.isBuffer(value) ? value : String(value));
      let text = String(value);
      if (Buffer.isBuffer(value)) {
        if (!this.logDecoders.has(channel)) this.logDecoders.set(channel, new StringDecoder('utf8'));
        text = this.logDecoders.get(channel).write(value);
      }
      appendCombinedLog(this.directory, channel, text);
      this.logError = null;
    } catch (error) {
      // A full or read-only log volume must not crash the process supervising a live world.
      if (this.logError !== error.code) console.error(`无法写入 ${channel} 日志：${error.message}`);
      this.logError = error.code;
    }
  }
  async installed() {
    try {
      await access(path.join(this.server, 'PalServer.sh'), constants.R_OK);
      await access(path.join(this.server, 'Pal/Binaries/Linux/PalServer-Linux-Shipping'), constants.X_OK);
      return true;
    } catch { return false; }
  }
  kill(child, signal) {
    if (!child?.pid) return;
    try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  run(command, args, channel = 'palbox', { captureLimit = 65536, ...options } = {}) {
    if (this.closing) return Promise.reject(failure('面板正在关闭。', 503));
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { shell: false, detached: true, env: this.childEnvironment(), stdio: ['ignore', 'pipe', 'pipe'], ...options });
      this.command = child;
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      let output = '';
      const collect = data => { output = (output + data.toString()).slice(-captureLimit); this.log(channel, data); };
      child.stdout.on('data', collect); child.stderr.on('data', collect);
      child.once('error', error => { if (this.command === child) this.command = null; reject(error); });
      child.once('close', (code, signal) => {
        if (this.command === child) this.command = null;
        code === 0 ? resolve(output) : reject(failure(`${path.basename(command)} 执行失败（${signal || code}），请查看日志。`, 500));
      });
    });
  }
  childEnvironment() {
    const env = { ...process.env };
    delete env.PALBOX_ADMIN_PASSWORD;
    delete env.PALBOX_ADMIN_PASSWORD_FILE;
    return env;
  }
  async install() {
    if (this.game) throw failure('请先停止游戏服再安装或更新。', 409);
    await mkdir(this.server, { recursive: true });
    const args = this.installArgs || ['+force_install_dir', this.server, '+login', 'anonymous', '+app_update', '2394010', 'validate', '+quit'];
    const result = await this.run(this.steamcmd, args, 'steamcmd');
    if (!/Success!.*App\s+'2394010'.*(?:fully installed|up to date)/i.test(result) || !(await this.installed())) throw failure('SteamCMD 未确认安装完成或启动文件不完整，请检查安装日志。', 500);
  }
  async rest(endpoint, body) {
    const source = await readFile(this.config, 'utf8');
    const values = new Map(parse(source).entries.map(e => [e.key, e.raw]));
    const port = Number(values.get('RESTAPIPort') || 8212);
    if (!Number.isInteger(port) || port < 1 || port > 65535 || values.get('RESTAPIEnabled') !== 'True') throw failure('请在配置中启用 REST API 后应用配置。', 409);
    const password = decodeString(values.get('AdminPassword') || '""');
    if (!password) throw failure('请先设置游戏管理员密码。', 409);
    const response = await fetch(`http://127.0.0.1:${port}/v1/api/${endpoint}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw failure(`游戏 REST API 请求失败（${response.status}）。`, 502);
    const text = await response.text();
    try { return text ? JSON.parse(text) : {}; } catch { return {}; }
  }
  async start() {
    if (this.closing) throw failure('面板正在关闭。', 503);
    if (this.game) throw failure('游戏服已在运行。', 409);
    if (!(await this.installed())) throw failure('请先安装帕鲁服务端。', 409);
    const source = await readFile(this.config, 'utf8');
    const values = new Map(parse(source).entries.map(e => [e.key, e.raw]));
    if (values.get('RESTAPIEnabled') !== 'True' || !decodeString(values.get('AdminPassword') || '""')) throw failure('启动管理模式需要启用 REST API 并设置管理员密码，请先应用配置。', 409);
    const child = spawn('/bin/bash', [path.join(this.server, 'PalServer.sh'), `-port=${this.port}`, ...this.args], { cwd: this.server, shell: false, detached: true, env: this.childEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] });
    this.game = child; this.ready = false; this.runningSource = source; this.startedAt = new Date().toISOString();
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', data => this.log('game', data));
    child.stderr.on('data', data => this.log('game', data));
    child.on('error', error => { this.log('palbox', `游戏进程错误：${error.message}\n`); });
    child.once('close', (code, signal) => {
      this.lastExit = { code, signal, at: new Date().toISOString() };
      if (this.game === child) { this.game = null; this.ready = false; this.runningSource = null; }
      this.log('palbox', `游戏进程退出：${signal || code}\n`);
    });
    const until = Date.now() + this.readyTimeout;
    while (Date.now() < until && !this.closing) {
      if (this.game !== child) throw failure('游戏进程启动失败，请查看游戏日志。', 500);
      try { await this.rest('info'); this.ready = true; return; } catch { await delay(1000); }
    }
    throw failure('游戏已启动，但 REST API 未就绪，请检查日志、密码和端口。', 504);
  }
  async stop({ requireSave = false, force = false } = {}) {
    const child = this.game;
    if (!child) return;
    const wasReady = this.ready;
    this.ready = false;
    if (force) this.kill(child, 'SIGKILL');
    else {
      try { await this.rest('save', {}); await this.rest('shutdown', { waittime: 5, message: 'Palbox 正在维护服务器' }); }
      catch (error) {
        if (requireSave) { this.ready = wasReady; throw error; }
        this.log('palbox', `API 关服失败，发送 SIGTERM：${error.message}\n`);
        this.kill(child, 'SIGTERM');
      }
    }
    const until = Date.now() + this.stopTimeout;
    while (this.game === child && Date.now() < until) await delay(100);
    if (this.game === child) throw failure('游戏进程尚未退出，已中止后续文件操作。', 504);
  }
  async forceStop() {
    const child = this.game;
    if (!child) return;
    this.ready = false;
    try { await this.rest('stop', {}); }
    catch (error) {
      this.log('palbox', `API 强制停止失败，发送 SIGKILL：${error.message}\n`);
      this.kill(child, 'SIGKILL');
    }
    const until = Date.now() + Math.min(this.stopTimeout, 10000);
    while (this.game === child && Date.now() < until) await delay(100);
    if (this.game === child) this.kill(child, 'SIGKILL');
    const killedAt = Date.now() + 5000;
    while (this.game === child && Date.now() < killedAt) await delay(100);
    if (this.game === child) throw failure('游戏进程尚未退出，请检查系统进程。', 504);
  }
  async logs(channel) {
    if (channel === 'all') return readCombinedLog(this.directory);
    if (!['palbox', 'game', 'steamcmd'].includes(channel)) throw failure('日志类型不存在。', 404);
    return readLogTail(path.join(this.directory, 'logs', channel + '.log'));
  }
  async close() {
    this.closing = true;
    this.kill(this.command, 'SIGTERM');
    try { await this.stop(); } catch { this.kill(this.game, 'SIGKILL'); }
  }
}
