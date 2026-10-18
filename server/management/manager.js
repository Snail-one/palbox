import path from 'node:path';
import { readFile, mkdir, readdir, stat, rename, rm, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Runtime } from './runtime.js';
import { ManagementStore } from './store.js';
import { atomicWrite, readJson, jsonWrite, failure } from './files.js';
import { passwordRecord } from './auth.js';
import { EditorSession } from '../../src/domain/editor-session.js';
import { createCatalog } from '../../src/domain/catalog.js';
import { parse, decodeString } from '../../src/domain/config.js';

const catalog = createCatalog();
const output = source => new EditorSession(source, { formatOutput: catalog.formatOutput }).toIni();
const categories = ['manual', 'scheduled', 'before-update'];
const backupId = /^[a-z0-9-]+\.tar\.gz$/;

export class Manager {
  constructor({ directory, password, runtime, webPort = 8080, ...options }) {
    this.directory = path.resolve(directory);
    this.password = password;
    this.settingsFile = path.join(this.directory, 'palbox/settings.json');
    this.tasksFile = path.join(this.directory, 'palbox/tasks.json');
    this.store = new ManagementStore(this.directory, options.port || runtime?.port || 8211);
    this.webPort = webPort;
    this.runtime = runtime || new Runtime(this.directory, options);
    this.tasks = [];
    this.busy = null;
    this.closing = false;
  }
  async initialize() {
    for (const sub of ['palbox', 'server', 'logs', ...categories.map(c => `backups/${c}`)]) await mkdir(path.join(this.directory, sub), { recursive: true, mode: 0o700 });
    this.settings = await readJson(this.settingsFile, null);
    if (!this.settings) {
      if (typeof this.password !== 'string' || this.password.length < 12) throw new Error('首次启动请设置至少 12 位的 PALBOX_ADMIN_PASSWORD。');
      if (this.password === 'replace-with-a-long-random-password') throw new Error('请将 .env 中的示例管理密码替换成自己的随机密码。');
      this.settings = { admin: passwordRecord(this.password), backupIntervalHours: 0, backupRetention: 10 };
      await jsonWrite(this.settingsFile, this.settings);
    }
    if (!/^[a-f0-9]{128}$/.test(this.settings.admin?.hash || '') || !/^[a-f0-9]+$/.test(this.settings.admin?.salt || '')) throw new Error('管理密码记录损坏，请检查 settings.json。');
    if (!Number.isInteger(this.settings.backupIntervalHours) || this.settings.backupIntervalHours < 0 || this.settings.backupIntervalHours > 168 || !Number.isInteger(this.settings.backupRetention) || this.settings.backupRetention < 1 || this.settings.backupRetention > 100) throw new Error('备份计划记录损坏，请检查 settings.json。');
    this.password = undefined;
    await this.store.initialize();
    await this.runtime.initialize();
    this.tasks = await readJson(this.tasksFile, []);
    if (!Array.isArray(this.tasks)) throw new Error('任务记录损坏，请检查 tasks.json。');
    for (const task of this.tasks) if (task.state === 'running') { task.state = 'interrupted'; task.message = '面板重启，任务已中断，请检查日志后重试。'; }
    await this.saveTasks();
    this.scheduler = setInterval(() => this.schedule().catch(error => this.runtime.log('palbox', `${error.message}\n`)), 60000);
    this.scheduler.unref();
  }
  saveTasks() { return jsonWrite(this.tasksFile, this.tasks.slice(0, 40)); }
  async submit(action, payload = {}) {
    const allowed = ['install', 'update', 'start', 'stop', 'restart', 'apply', 'backup', 'restore', 'save-world', 'announce', 'kick'];
    if (!allowed.includes(action)) throw failure('管理操作不存在。', 404);
    if (this.closing) throw failure('管理服务正在关闭。', 503);
    if (this.busy) throw failure('已有任务正在执行，请稍后再试。', 409);
    const task = { id: randomUUID(), action, state: 'running', message: '任务已开始', createdAt: new Date().toISOString() };
    this.busy = task;
    this.tasks.unshift(task); this.tasks = this.tasks.slice(0, 40);
    try { await this.saveTasks(); } catch (error) { this.busy = null; throw error; }
    this.operation = (async () => {
      try {
        await this.execute(action, payload, task);
        task.state = 'succeeded'; task.message = '执行完成';
      } catch (error) {
        task.state = 'failed'; task.message = error.message;
        this.runtime.log('palbox', `[${action}] ${error.message}\n`);
      } finally {
        task.finishedAt = new Date().toISOString();
        try { await this.saveTasks(); } catch (error) { this.runtime.log('palbox', `任务记录保存失败：${error.message}\n`); }
        if (this.busy === task) this.busy = null;
      }
    })();
    return { ...task };
  }
  async ensureConfig() {
    try { await stat(this.runtime.config); }
    catch (error) { if (error.code !== 'ENOENT') throw error; await atomicWrite(this.runtime.config, output(this.store.active().source)); }
  }
  async execute(action, payload, task) {
    switch (action) {
      case 'install':
        task.message = '正在通过 SteamCMD 下载服务端，请查看安装日志';
        await this.runtime.install(); await this.ensureConfig();
        if (payload.start) await this.runtime.start();
        break;
      case 'update': {
        const running = Boolean(this.runtime.game);
        if (running) { task.message = '保存世界并正常停服'; await this.runtime.stop({ requireSave: true }); }
        await this.backup('before-update');
        task.message = '正在更新并校验服务端文件';
        await this.runtime.install();
        if (running) await this.runtime.start();
        break;
      }
      case 'start': await this.ensureConfig(); await this.runtime.start(); break;
      case 'stop': await this.runtime.stop(); break;
      case 'restart': await this.runtime.stop({ requireSave: true }); await this.runtime.start(); break;
      case 'apply': {
        const snapshot = this.store.snapshot();
        if (payload.revision !== snapshot.revision || payload.profileId !== snapshot.workspace.activeId) throw failure('配置已变更，请等待自动保存完成后重新应用。', 409);
        const source = output(this.store.active().source);
        const values = new Map(parse(source).entries.map(e => [e.key, e.raw]));
        if (values.get('RESTAPIEnabled') !== 'True' || !decodeString(values.get('AdminPassword') || '""')) throw failure('管理模式需要 RESTAPIEnabled=True 和非空管理员密码。');
        const restPort = Number(values.get('RESTAPIPort') || 8212);
        if (!Number.isInteger(restPort) || restPort < 1 || restPort > 65535 || restPort === this.runtime.port || restPort === this.webPort) throw failure('REST API 端口无效或与现有服务端口冲突。');
        const running = Boolean(this.runtime.game);
        if (running) { task.message = '保存世界并正常停服'; await this.runtime.stop({ requireSave: true }); }
        await this.backup('manual');
        await atomicWrite(this.runtime.config, source);
        if (running) { task.message = '配置已写入，正在启动游戏服'; await this.runtime.start(); }
        break;
      }
      case 'backup': {
        const running = Boolean(this.runtime.game);
        if (running) { task.message = '保存世界并停服，准备一致性备份'; await this.runtime.stop({ requireSave: true }); }
        try { task.backup = await this.backup(payload.category === 'scheduled' ? 'scheduled' : 'manual'); }
        finally { if (running && !this.closing) await this.runtime.start(); }
        break;
      }
      case 'restore': await this.restore(payload.id); break;
      case 'save-world': await this.requireRunning(); await this.runtime.rest('save', {}); break;
      case 'announce':
        await this.requireRunning();
        if (typeof payload.message !== 'string' || !payload.message.trim() || payload.message.length > 500) throw failure('请输入 1 到 500 字的广播内容。');
        await this.runtime.rest('announce', { message: payload.message }); break;
      case 'kick':
        await this.requireRunning();
        if (typeof payload.userid !== 'string' || !payload.userid || payload.userid.length > 200) throw failure('玩家 ID 无效。');
        await this.runtime.rest('kick', { userid: payload.userid, message: '管理员已将你移出服务器' }); break;
    }
  }
  async requireRunning() { if (!this.runtime.game) throw failure('游戏服尚未运行。', 409); }
  async backup(category, protectedId = null) {
    // Stop the process before archiving so world/player files belong to one save.
    if (this.runtime.game) throw failure('创建备份前需要停止游戏服。', 409);
    try { await stat(this.runtime.saved); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const id = `${category}/${Date.now()}-${randomUUID()}.tar.gz`;
    const file = path.join(this.directory, 'backups', id);
    const temporary = file + '.partial';
    try {
      await this.runtime.run('tar', ['-czf', temporary, '-C', this.runtime.server, '--', 'Pal/Saved'], 'palbox');
      await rename(temporary, file);
    } catch (error) { await rm(temporary, { force: true }); throw error; }
    const list = (await this.backups()).filter(b => b.category === category);
    for (const old of list.slice(this.settings.backupRetention)) if (old.id !== protectedId) await rm(this.backupFile(old.id));
    return id;
  }
  backupFile(id) {
    if (typeof id !== 'string') throw failure('备份不存在。', 404);
    const [category, name, extra] = id.split('/');
    if (!categories.includes(category) || !backupId.test(name || '') || extra !== undefined) throw failure('备份路径无效。', 400);
    return path.join(this.directory, 'backups', category, name);
  }
  async backups() {
    const entries = [];
    for (const category of categories) for (const name of await readdir(path.join(this.directory, 'backups', category))) {
      if (!backupId.test(name)) continue;
      const file = path.join(this.directory, 'backups', category, name);
      const info = await lstat(file);
      if (info.isFile()) entries.push({ id: `${category}/${name}`, category, bytes: info.size, createdAt: info.mtime.toISOString() });
    }
    return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async restore(id) {
    const file = this.backupFile(id);
    if (!(await lstat(file)).isFile()) throw failure('备份文件无效。');
    const captureLimit = 32 * 1024 * 1024;
    const listing = await this.runtime.run('tar', ['-tzf', file], 'palbox', { captureLimit });
    if (listing.length >= captureLimit) throw failure('备份目录清单过长，无法安全校验。');
    for (const name of listing.trim().split('\n')) if (!/^Pal\/Saved(?:\/|$)/.test(name) || name.split('/').some(p => p === '..') || name.includes('\\')) throw failure('备份包含不允许的路径。');
    const types = await this.runtime.run('tar', ['-tvzf', file], 'palbox', { captureLimit });
    if (types.length >= captureLimit || types.trim().split('\n').some(line => !['-', 'd'].includes(line[0]))) throw failure('备份包含链接或不支持的文件类型。');
    const running = Boolean(this.runtime.game);
    if (running) await this.runtime.stop({ requireSave: true });
    await this.backup('manual', id);
    const stage = path.join(this.runtime.server, `.restore-${randomUUID()}`);
    const previous = path.join(this.runtime.server, `.saved-${randomUUID()}`);
    await mkdir(stage, { recursive: true });
    let moved = false;
    try {
      await this.runtime.run('tar', ['-xzf', file, '--no-same-owner', '--no-same-permissions', '-C', stage, '--', 'Pal/Saved']);
      parse(await readFile(path.join(stage, 'Pal/Saved/Config/LinuxServer/PalWorldSettings.ini'), 'utf8'));
      await mkdir(path.dirname(this.runtime.saved), { recursive: true });
      try { await rename(this.runtime.saved, previous); moved = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      try { await rename(path.join(stage, 'Pal/Saved'), this.runtime.saved); }
      catch (error) { if (moved) await rename(previous, this.runtime.saved); throw error; }
      if (moved) await rm(previous, { recursive: true });
    } finally { await rm(stage, { recursive: true, force: true }); }
    if (running) await this.runtime.start();
  }
  async status() {
    const installed = await this.runtime.installed();
    let disk = null;
    try { disk = await readFile(this.runtime.config, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const desired = output(this.store.active().source);
    let configuration = disk && output(disk) === desired ? 'applied' : 'pending';
    if (this.runtime.game && (!this.runtime.runningSource || output(this.runtime.runningSource) !== desired)) configuration = 'pending';
    const status = { installed, running: Boolean(this.runtime.game), ready: this.runtime.ready, configuration, startedAt: this.runtime.startedAt, lastExit: this.runtime.lastExit, task: this.busy, tasks: this.tasks, revision: this.store.revision, port: this.runtime.port, metrics: null, info: null, players: [] };
    if (this.runtime.game) {
      const results = await Promise.allSettled([this.runtime.rest('info'), this.runtime.rest('metrics'), this.runtime.rest('players')]);
      if (results[0].status === 'fulfilled') { status.info = results[0].value; status.ready = this.runtime.ready = true; }
      else status.ready = this.runtime.ready = false;
      if (results[1].status === 'fulfilled') status.metrics = results[1].value;
      if (results[2].status === 'fulfilled') status.players = results[2].value.players || [];
    }
    return status;
  }
  publicSettings() { return { backupIntervalHours: this.settings.backupIntervalHours, backupRetention: this.settings.backupRetention }; }
  async updateSettings(value) {
    if (!Number.isInteger(value.backupIntervalHours) || value.backupIntervalHours < 0 || value.backupIntervalHours > 168 || !Number.isInteger(value.backupRetention) || value.backupRetention < 1 || value.backupRetention > 100) throw failure('备份间隔须为 0 到 168 小时，保留数量为 1 到 100。');
    const next = { ...this.settings, ...this.publicSettings(), backupIntervalHours: value.backupIntervalHours, backupRetention: value.backupRetention };
    await jsonWrite(this.settingsFile, next); this.settings = next;
    return this.publicSettings();
  }
  async schedule() {
    if (this.closing || this.busy || !this.settings.backupIntervalHours || !this.runtime.game) return;
    const last = this.tasks.find(t => t.action === 'backup' && t.category === 'scheduled' && t.state === 'succeeded');
    const since = last?.finishedAt || this.runtime.startedAt;
    if (Date.now() - new Date(since).getTime() < this.settings.backupIntervalHours * 3600000) return;
    const task = await this.submit('backup', { category: 'scheduled' });
    const actual = this.tasks.find(t => t.id === task.id); actual.category = 'scheduled';
  }
  async close() {
    this.closing = true; clearInterval(this.scheduler);
    await this.runtime.close();
    await this.operation;
  }
}
