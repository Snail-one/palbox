import path from 'node:path';
import { readFile, mkdir, readdir, stat, rename, rm, rmdir, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Runtime } from './runtime.js';
import { NativeBackups } from './native-backups.js';
import { SaveImports } from './save-imports.js';
import { ManagementStore } from './store.js';
import { atomicWrite, readJson, jsonWrite, failure } from './files.js';
import { normalizeUsername, passwordRecord, validUsername } from './auth.js';
import { EditorSession } from '../../src/domain/editor-session.js';
import { createCatalog } from '../../src/domain/catalog.js';
import { parse, decodeString } from '../../src/domain/config.js';

const catalog = createCatalog();
const output = source => new EditorSession(source, { formatOutput: catalog.formatOutput }).toIni();
const categories = ['manual', 'scheduled', 'before-update'];
const backupId = /^[a-z0-9-]+\.tar\.gz$/;
const MISSING = Symbol('missing');
const MAX_GAME_ARGS = 32;
const MAX_GAME_ARG_LENGTH = 200;
const MAX_GAME_ARGS_BYTES = 1800;
const PORT_ARGUMENT = /(?:^|\s)-port(?:=|\s|$)/i;

function gameArgsError(value) {
  if (!Array.isArray(value)) return '启动参数必须是字符串数组。';
  if (value.length > MAX_GAME_ARGS) return `启动参数不能超过 ${MAX_GAME_ARGS} 项。`;
  let bytes = 0;
  for (const arg of value) {
    if (typeof arg !== 'string') return '启动参数必须是字符串数组。';
    if (arg.trim().length === 0) return '启动参数不能包含空行。';
    if (arg.length > MAX_GAME_ARG_LENGTH) return `单个启动参数不能超过 ${MAX_GAME_ARG_LENGTH} 个字符。`;
    if (/[\u0000-\u001f\u007f]/.test(arg)) return '启动参数不能包含控制字符。';
    if (PORT_ARGUMENT.test(arg)) return '不能通过启动参数设置 -port；游戏端口由 PALBOX_GAME_PORT 控制。';
    bytes += Buffer.byteLength(arg, 'utf8');
  }
  if (bytes > MAX_GAME_ARGS_BYTES) return `启动参数总长度不能超过 ${MAX_GAME_ARGS_BYTES} 字节。`;
  return null;
}

export class Manager {
  constructor({ directory, runtime, webPort = 8080, importLimits = {}, ...options }) {
    this.directory = path.resolve(directory);
    this.settings = null;
    this.setupRequired = true;
    this.setupPending = false;
    this.settingsUpdates = Promise.resolve();
    this.settingsFile = path.join(this.directory, 'palbox/settings.json');
    this.tasksFile = path.join(this.directory, 'palbox/tasks.json');
    this.store = new ManagementStore(this.directory, options.port || runtime?.port || 8211);
    this.webPort = webPort;
    this.runtime = runtime || new Runtime(this.directory, options);
    this.native = new NativeBackups(this.runtime.saved, this.directory);
    this.imports = new SaveImports({ directory: this.directory, runtime: this.runtime, native: this.native, limits: importLimits });
    this.tasks = [];
    this.busy = null;
    this.closing = false;
  }
  async initialize() {
    for (const sub of ['palbox', 'server', 'logs', ...categories.map(c => `backups/${c}`)]) await mkdir(path.join(this.directory, sub), { recursive: true, mode: 0o700 });
    let settings;
    try { settings = await readJson(this.settingsFile, MISSING); }
    catch (error) { throw new Error(`settings.json 无法读取或解析。请先备份数据目录，再删除 ${this.settingsFile} 后重新启动，并在网页中重新初始化管理员。`, { cause: error }); }
    if (settings === MISSING) {
      this.settings = null;
      this.setupRequired = true;
    } else {
      this.validateSettings(settings);
      let write = false;
      if (!Object.hasOwn(settings, 'gameArgs')) { settings.gameArgs = []; write = true; }
      if (Object.hasOwn(settings, 'backupIntervalHours')) { delete settings.backupIntervalHours; write = true; }
      this.settings = settings;
      this.setupRequired = false;
      if (write) await jsonWrite(this.settingsFile, settings);
    }
    this.syncRuntimeArgs();
    await this.store.initialize();
    await this.runtime.initialize();
    try { await this.imports.initialize(); }
    catch (error) { this.runtime.log('palbox', `导入暂存目录初始化失败：${error.message}\n`); }
    this.tasks = await readJson(this.tasksFile, []);
    if (!Array.isArray(this.tasks)) throw new Error('任务记录损坏，请检查 tasks.json。');
    for (const task of this.tasks) if (task.state === 'running') { task.state = 'interrupted'; task.message = '面板重启，任务已中断，请检查日志后重试。'; }
    await this.saveTasks();
  }
  settingsError() {
    return `settings.json 中的管理员记录或备份设置损坏。请先备份数据目录，再删除 ${this.settingsFile} 后重新启动，并在网页中重新初始化管理员。`;
  }
  validateSettings(settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error(this.settingsError());
    const admin = settings.admin;
    if (admin && typeof admin === 'object' && !Array.isArray(admin) && !Object.hasOwn(admin, 'username')) {
      throw new Error(`旧版 settings.json 缺少管理员用户名，无法安全迁移。请先备份数据目录，再删除 ${this.settingsFile} 后重新启动，并在网页中重新初始化管理员。`);
    }
    if (!admin || typeof admin !== 'object' || Array.isArray(admin)
      || admin.username !== normalizeUsername(admin.username) || !validUsername(admin.username)
      || !/^[a-f0-9]{128}$/.test(admin.hash || '') || !/^[a-f0-9]+$/.test(admin.salt || '')) throw new Error(this.settingsError());
    if (!Number.isInteger(settings.backupRetention) || settings.backupRetention < 1 || settings.backupRetention > 100) throw new Error(this.settingsError());
    if (Object.hasOwn(settings, 'gameArgs')) {
      const message = gameArgsError(settings.gameArgs);
      if (message) throw new Error(`settings.json 中的启动参数无效：${message}请编辑 ${this.settingsFile} 修正 gameArgs 后重新启动。`);
    }
  }
  needsSetup() { return this.setupRequired; }
  get backupRetention() { return this.settings?.backupRetention ?? 10; }
  get gameArgs() { return this.settings?.gameArgs ?? []; }
  syncRuntimeArgs() { this.runtime.args = [...this.gameArgs]; }
  async setupAdmin(username, password) {
    if (!this.setupRequired) throw failure('管理员已初始化，请直接登录。', 409);
    if (this.setupPending) throw failure('管理员初始化正在进行，请稍后重试。', 409);
    this.setupPending = true;
    try {
      const name = normalizeUsername(username);
      if (!validUsername(name)) throw failure('管理员用户名须为 1 到 64 个字符，且不能包含控制字符。', 400);
      if (typeof password !== 'string' || password.length < 12) throw failure('管理密码至少需要 12 位。', 400);
      if (password.length > 1024) throw failure('管理密码不能超过 1024 位。', 400);
      const next = { admin: { username: name, ...passwordRecord(password) }, backupRetention: 10, gameArgs: [] };
      await jsonWrite(this.settingsFile, next);
      this.settings = next;
      this.setupRequired = false;
      return next.admin;
    } finally { this.setupPending = false; }
  }
  saveTasks() { return jsonWrite(this.tasksFile, this.tasks.slice(0, 40)); }
  async submit(action, payload = {}) {
    const allowed = ['install', 'update', 'start', 'stop', 'restart', 'apply', 'backup', 'restore', 'restore-native', 'import-save', 'save-world', 'announce', 'kick'];
    if (!allowed.includes(action)) throw failure('管理操作不存在。', 404);
    if (action === 'backup' && payload.category && payload.category !== 'manual') throw failure('定时备份已交由游戏官方机制，面板仅支持手动完整备份。');
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
      case 'restart': await this.requireRunning(); await this.runtime.stop({ requireSave: true }); await this.runtime.start(); break;
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
        try { task.backup = await this.backup('manual'); }
        finally { if (running && !this.closing) await this.runtime.start(); }
        break;
      }
      case 'restore': await this.restore(payload.id); break;
      case 'restore-native': {
        const running = Boolean(this.runtime.game);
        await this.native.restore(payload.id, async () => {
          if (running) await this.runtime.stop({ requireSave: true });
          await this.backup('manual');
        });
        if (running) await this.runtime.start();
        break;
      }
      case 'import-save': await this.restoreImported(payload.id, task); break;
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
  async targetWorld(imported) {
    const configured = await this.native.configuredWorld();
    if (configured) return configured;
    const worlds = await this.native.worlds();
    if (worlds.length === 1) return worlds[0];
    if (!worlds.length) return imported.worldId || randomUUID().replaceAll('-', '').toUpperCase();
    throw failure('无法确定当前世界，请先设置 DedicatedServerName 或只保留一个世界。', 409);
  }
  async restoreImported(id, task) {
    const imported = await this.imports.get(id);
    if (!(await this.runtime.installed())) throw failure('请先安装帕鲁服务端。', 409);
    const wasRunning = Boolean(this.runtime.game);
    let created = null;
    let swapped = false;
    let rollbackFailed = false;
    let failureError = null;
    try {
      if (wasRunning) { task.message = '保存世界并停服，准备导入存档'; await this.runtime.stop({ requireSave: true }); }
      const target = await this.targetWorld(imported);
      task.message = '正在创建恢复前完整备份';
      task.backup = await this.backup('manual');
      const ensured = await this.native.ensureWorld(target);
      if (ensured.created) created = ensured.directory;
      task.message = '正在替换世界与玩家存档';
      await this.native.replaceWorld(target, imported.snapshot, { beforeSwap: async () => {
        if (await this.targetWorld(imported) !== target) throw failure('当前世界已改变，请刷新后重试。', 409);
      } });
      swapped = true;
    } catch (error) {
      failureError = error;
      rollbackFailed = Boolean(error.rollbackFailed);
    } finally {
      await this.imports.remove(id).catch(error => this.runtime.log('palbox', `导入临时文件清理失败：${error.message}\n`));
      if (created && !swapped && !rollbackFailed) await rmdir(created).catch(error => {
        if (!['ENOTEMPTY', 'EEXIST', 'ENOENT'].includes(error.code)) this.runtime.log('palbox', `空世界目录清理失败：${error.message}\n`);
      });
    }
    if (rollbackFailed) throw failureError;
    if (failureError) {
      if (wasRunning && !this.runtime.game && !this.closing) {
        try { await this.runtime.start(); }
        catch (error) { this.runtime.log('palbox', `导入失败后启动游戏服失败：${error.message}\n`); }
      }
      throw failureError;
    }
    if (wasRunning && !this.runtime.game && !this.closing) {
      try { task.message = '存档已导入，正在启动游戏服'; await this.runtime.start(); }
      catch (error) { throw failure(`存档已导入，但游戏服启动失败：${error.message}`, 500); }
    }
  }
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
    for (const old of list.slice(this.backupRetention)) if (old.id !== protectedId) await rm(this.backupFile(old.id));
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
  async nativeBackups() {
    let source = this.runtime.game ? this.runtime.runningSource : null;
    if (!source) {
      try { source = await readFile(this.runtime.config, 'utf8'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const setting = source ? parse(source).entries.find(entry => entry.key === 'bIsUseBackupSaveData') : null;
    const enabled = setting ? setting.raw === 'True' : null;
    return { enabled, ...await this.native.list() };
  }
  publicSettings() { return { backupRetention: this.backupRetention, gameArgs: [...this.gameArgs] }; }
  updateSettings(value) {
    const update = this.settingsUpdates.then(() => this.applySettings(value));
    this.settingsUpdates = update.catch(() => {});
    return update;
  }
  async applySettings(value) {
    if (this.setupRequired) throw failure('请先完成管理员初始化。', 409);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('设置格式不正确。');
    if (Object.hasOwn(value, 'backupIntervalHours')) throw failure('面板定时备份已移除，请使用游戏官方自动备份。');
    const hasRetention = Object.hasOwn(value, 'backupRetention');
    const hasArgs = Object.hasOwn(value, 'gameArgs');
    if (!hasRetention && !hasArgs) throw failure('请提供要保存的设置。');
    const next = { ...this.settings, gameArgs: [...this.gameArgs] };
    if (hasRetention) {
      if (!Number.isInteger(value.backupRetention) || value.backupRetention < 1 || value.backupRetention > 100) throw failure('完整备份保留数量须为 1 到 100。');
      next.backupRetention = value.backupRetention;
    }
    if (hasArgs) {
      const message = gameArgsError(value.gameArgs);
      if (message) throw failure(message);
      next.gameArgs = [...value.gameArgs];
    }
    await jsonWrite(this.settingsFile, next);
    this.settings = next;
    this.syncRuntimeArgs();
    return this.publicSettings();
  }
  async close() {
    this.closing = true;
    await this.runtime.close();
    await this.operation;
    await this.settingsUpdates;
  }
}
