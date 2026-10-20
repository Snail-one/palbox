import path from 'node:path';
import { readFile, mkdir, mkdtemp, open, readdir, stat, rename, rm, rmdir, lstat, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import { Runtime, DEFAULT_SHUTDOWN_MESSAGE } from './runtime.js';
import { NativeBackups } from './native-backups.js';
import { SaveImports } from './save-imports.js';
import { replaceDirectory } from './replace-directory.js';
import { readBanList } from './banned-players.js';
import { PlayerHistory, PlayerHistoryRecorder } from './player-history.js';
import { ManagementStore } from './store.js';
import { atomicWrite, readJson, jsonWrite, failure } from './files.js';
import { normalizeUsername, passwordRecord, validUsername } from './auth.js';
import { validTotpRecord } from './totp.js';
import { backupDirectory, BACKUP_CATEGORIES as categories } from './backup-paths.js';
import { readBackupWorld, recordBackupWorld, removeBackupMetadata } from './backup-metadata.js';
import { EditorSession } from '../../shared/domain/editor-session.js';
import { createCatalog } from '../../shared/domain/catalog.js';
import { parse, decodeString } from '../../shared/domain/config.js';

const exec = promisify(execFile);
const shellQuote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
const catalog = createCatalog();
const output = source => new EditorSession(source, { formatOutput: catalog.formatOutput }).toIni();
const backupId = /^[a-z0-9-]+\.tar\.gz$(?![\s\S])/;
const MISSING = Symbol('missing');
const MAX_GAME_ARGS = 32;
const MAX_BACKUP_RETENTION = 20;
const MAX_GAME_ARG_LENGTH = 200;
const MAX_GAME_ARGS_BYTES = 1800;
const PORT_ARGUMENT = /(?:^|\s)-port(?:=|\s|$)/i;
const DEFAULT_INSTALL_ARGS = Object.freeze(['+force_install_dir', '{server}', '+login', 'anonymous', '+app_update', '2394010', 'validate', '+quit']);

function validBackupRetentions(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
    && Object.entries(value).every(([category, count]) => categories.includes(category) && Number.isInteger(count) && count >= 1 && count <= MAX_BACKUP_RETENTION);
}

// Accept a raw banlist line such as "steam_<ID>,<PlayerUID>" or a bare
// 17-digit SteamID64 and reduce it to the UserID used by the REST API.
function normalizeActionUserId(value) {
  let userId = value.trim().split(',', 1)[0].trim();
  if (/^\d{17}$/.test(userId)) userId = `steam_${userId}`;
  if (!userId) throw failure('玩家 ID 无效。');
  return userId;
}

/** Extract the public branch build from a SteamCMD.net API response. */
export function steamCmdApiBuild(value) {
  const build = value?.data?.['2394010']?.depots?.branches?.public?.buildid;
  const text = typeof build === 'number' ? String(build) : build;
  return typeof text === 'string' && /^\d+$/.test(text) ? text : null;
}

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

function normalizeInstallArgs(value, server) {
  if (!Array.isArray(value)) throw failure('安装参数必须是字符串数组。');
  if (value.length > 64) throw failure('安装参数不能超过 64 项。');
  const args = value.map(arg => {
    if (typeof arg !== 'string' || !arg.trim()) throw failure('安装参数不能包含空行。');
    if (arg.length > 512) throw failure('单个安装参数不能超过 512 个字符。');
    if (/[\u0000-\u001f\u007f]/.test(arg)) throw failure('安装参数不能包含控制字符。');
    return arg;
  });
  const directories = args.map((arg, index) => arg.toLowerCase() === '+force_install_dir' ? index : -1).filter(index => index >= 0);
  if (!directories.length) throw failure('安装参数必须包含 +force_install_dir。');
  if (directories.length > 1) throw failure('安装参数只能包含一个 +force_install_dir。');
  const directory = args[directories[0] + 1];
  if (directory !== '{server}' && directory !== server) throw failure('+force_install_dir 必须使用面板的安装目录，不能修改。');
  args[directories[0] + 1] = '{server}';
  let updates = 0;
  for (let index = 0; index < args.length; index++) {
    if (args[index].toLowerCase() !== '+app_update') continue;
    updates++;
    if (args[index + 1] !== '2394010') throw failure('+app_update 必须是帕鲁专用服务端 App 2394010。');
  }
  if (!updates) throw failure('安装参数必须包含 +app_update 2394010。');
  if (args.at(-1).toLowerCase() !== '+quit') throw failure('安装参数最后一项必须是 +quit。');
  return args;
}

export class Manager extends EventEmitter {
  constructor({ directory, runtime, webPort = 8080, importLimits = {}, ...options }) {
    super();
    this.setMaxListeners(0);
    this.stateInstance = randomUUID();
    this.stateRevision = 0;
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
    this.runtime.on?.('state', () => this.changed());
    this.playerHistory = new PlayerHistory(this.directory);
    this.playerHistoryRecorder = new PlayerHistoryRecorder({ history: this.playerHistory, runtime: this.runtime, onChange: () => this.changed() });
    this.native = new NativeBackups(this.runtime.saved, this.directory);
    this.imports = new SaveImports({ directory: this.directory, runtime: this.runtime, native: this.native, limits: importLimits });
    this.tasks = [];
    this.busy = null;
    this.closing = false;
    this.updateCache = null;
    this.versionCache = null;
  }
  async initialize() {
    for (const sub of ['palbox', 'server', 'logs']) await mkdir(path.join(this.directory, sub), { recursive: true, mode: 0o700 });
    for (const category of categories) await backupDirectory(this.directory, category, { create: true });
    let settings;
    try { settings = await readJson(this.settingsFile, MISSING); }
    catch (error) { throw new Error(`settings.json 无法读取或解析。请先备份数据目录，再删除 ${this.settingsFile} 后重新启动，并在网页中重新初始化管理员。`, { cause: error }); }
    if (settings === MISSING) {
      this.settings = null;
      this.setupRequired = true;
    } else {
      let write = false;
      if (settings?.backupRetentions && typeof settings.backupRetentions === 'object' && !Array.isArray(settings.backupRetentions)) {
        for (const category of ['scheduled', 'before-update']) {
          if (Object.hasOwn(settings.backupRetentions, category)) { delete settings.backupRetentions[category]; write = true; }
        }
        if (write && !Object.keys(settings.backupRetentions).length) delete settings.backupRetentions;
      }
      this.validateSettings(settings);
      if (settings.backupRetention > MAX_BACKUP_RETENTION) { settings.backupRetention = MAX_BACKUP_RETENTION; write = true; }
      if (!Object.hasOwn(settings, 'autoStart')) { settings.autoStart = false; write = true; }
      if (!Object.hasOwn(settings, 'gameArgs')) { settings.gameArgs = []; write = true; }
      if (!Object.hasOwn(settings, 'installArgs')) { settings.installArgs = [...DEFAULT_INSTALL_ARGS]; write = true; }
      if (!Object.hasOwn(settings, 'shutdownWait')) { settings.shutdownWait = 5; write = true; }
      if (!Object.hasOwn(settings, 'shutdownMessage')) { settings.shutdownMessage = DEFAULT_SHUTDOWN_MESSAGE; write = true; }
      if (Object.hasOwn(settings, 'backupIntervalHours')) { delete settings.backupIntervalHours; write = true; }
      this.settings = settings;
      this.setupRequired = false;
      if (write) await jsonWrite(this.settingsFile, settings);
    }
    this.syncRuntimeArgs();
    this.syncRuntimeInstallArgs();
    await this.store.initialize();
    await this.playerHistory.initialize();
    await this.runtime.initialize();
    try { await this.imports.initialize(); }
    catch (error) { this.runtime.log('palbox', `导入暂存目录初始化失败：${error.message}\n`); }
    this.tasks = await readJson(this.tasksFile, []);
    if (!Array.isArray(this.tasks)) throw new Error('任务记录损坏，请检查 tasks.json。');
    for (const task of this.tasks) if (task.state === 'running') { task.state = 'interrupted'; task.message = '面板重启，任务已中断，请检查日志后重试。'; }
    await this.saveTasks();
    await this.playerHistoryRecorder.start();
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
      || !/^[a-f0-9]{128}$(?![\s\S])/.test(admin.hash || '') || !/^[a-f0-9]+$(?![\s\S])/.test(admin.salt || '')) throw new Error(this.settingsError());
    if (Object.hasOwn(admin, 'totp') && !validTotpRecord(admin.totp)) throw new Error(this.settingsError());
    // Accept the previous limit on disk, then migrate it to the current cap.
    if (!Number.isInteger(settings.backupRetention) || settings.backupRetention < 1 || settings.backupRetention > 100) throw new Error(this.settingsError());
    if (Object.hasOwn(settings, 'backupRetentions') && !validBackupRetentions(settings.backupRetentions)) throw new Error(this.settingsError());
    if (Object.hasOwn(settings, 'autoStart') && typeof settings.autoStart !== 'boolean') throw new Error(this.settingsError());
    if (Object.hasOwn(settings, 'shutdownWait') && (!Number.isInteger(settings.shutdownWait) || settings.shutdownWait < 0 || settings.shutdownWait > 300)) {
      throw new Error(`settings.json 中的关服倒计时须为 0 到 300 的整数秒。请编辑 ${this.settingsFile} 修正 shutdownWait 后重新启动。`);
    }
    if (Object.hasOwn(settings, 'shutdownMessage') && (typeof settings.shutdownMessage !== 'string' || !settings.shutdownMessage.trim() || settings.shutdownMessage.length > 500 || /\p{Cc}/u.test(settings.shutdownMessage))) {
      throw new Error(`settings.json 中的关服提示须为 1 到 500 个字符，且不能包含控制字符。请编辑 ${this.settingsFile} 修正 shutdownMessage 后重新启动。`);
    }
    if (Object.hasOwn(settings, 'gameArgs')) {
      const message = gameArgsError(settings.gameArgs);
      if (message) throw new Error(`settings.json 中的启动参数无效：${message}请编辑 ${this.settingsFile} 修正 gameArgs 后重新启动。`);
    }
    if (Object.hasOwn(settings, 'installArgs')) {
      try { settings.installArgs = normalizeInstallArgs(settings.installArgs, this.runtime.server); }
      catch (error) { throw new Error(`settings.json 中的安装参数无效：${error.message}请编辑 ${this.settingsFile} 修正 installArgs 后重新启动。`); }
    }
  }
  needsSetup() { return this.setupRequired; }
  get backupRetention() { return this.settings?.backupRetention ?? 5; }
  get backupRetentions() { return Object.fromEntries(categories.map(category => [category, this.settings?.backupRetentions?.[category] ?? this.backupRetention])); }
  get autoStart() { return this.settings?.autoStart === true; }
  get gameArgs() { return this.settings?.gameArgs ?? []; }
  get installArgs() { return this.settings?.installArgs ?? DEFAULT_INSTALL_ARGS; }
  get shutdownWait() { return this.settings?.shutdownWait ?? 5; }
  get shutdownMessage() { return this.settings?.shutdownMessage ?? DEFAULT_SHUTDOWN_MESSAGE; }
  syncRuntimeArgs() { this.runtime.args = [...this.gameArgs]; this.runtime.shutdownWait = this.shutdownWait; this.runtime.shutdownMessage = this.shutdownMessage; }
  syncRuntimeInstallArgs() { this.runtime.installArgs = this.installArgs.map(arg => arg === '{server}' ? this.runtime.server : arg); }
  async setupAdmin(username, password) {
    if (!this.setupRequired) throw failure('管理员已初始化，请直接登录。', 409);
    if (this.setupPending) throw failure('管理员初始化正在进行，请稍后重试。', 409);
    this.setupPending = true;
    try {
      const name = normalizeUsername(username);
      if (!validUsername(name)) throw failure('管理员用户名须为 1 到 64 个字符，且不能包含控制字符。', 400);
      if (typeof password !== 'string' || password.length < 12) throw failure('管理密码至少需要 12 位。', 400);
      if (password.length > 1024) throw failure('管理密码不能超过 1024 位。', 400);
      const next = { admin: { username: name, ...await passwordRecord(password) }, backupRetention: 5, autoStart: false, shutdownWait: 5, shutdownMessage: DEFAULT_SHUTDOWN_MESSAGE, gameArgs: [], installArgs: [...DEFAULT_INSTALL_ARGS] };
      await jsonWrite(this.settingsFile, next);
      this.settings = next;
      this.setupRequired = false;
      this.syncRuntimeArgs();
      this.syncRuntimeInstallArgs();
      return next.admin;
    } finally { this.setupPending = false; }
  }
  /** Start the game once during panel boot when the persisted setting is on. */
  async autoStartServer() {
    if (!this.autoStart || this.setupRequired || this.closing) return;
    if (this.runtime.game) return;
    if (!(await this.runtime.installed())) {
      this.runtime.log('palbox', '自动启动已启用，但服务端尚未安装，已跳过。\n');
      return;
    }
    try {
      // A panel-only restart can leave the previous detached game process alive.
      await this.runtime.rest('info');
      this.runtime.log('palbox', '自动启动：检测到游戏服务已在运行，已跳过。\n');
      return;
    } catch { /* REST not reachable: continue with a normal start. */ }
    try {
      this.runtime.log('palbox', '自动启动已启用，正在启动游戏服务。\n');
      await this.submit('start');
    } catch (error) {
      this.runtime.log('palbox', `自动启动失败：${error.message}\n`);
    }
  }
  changed() { this.stateRevision++; this.emit('state'); }
  saveTasks() { return jsonWrite(this.tasksFile, this.tasks.slice(0, 40)); }
  async submit(action, payload = {}, { authorize = () => {} } = {}) {
    authorize();
    const allowed = ['install', 'update', 'start', 'stop', 'force-stop', 'restart', 'apply', 'backup', 'delete-backup', 'restore', 'restore-native', 'import-save', 'reset-save', 'save-world', 'announce', 'kick', 'ban', 'unban'];
    if (!allowed.includes(action)) throw failure('管理操作不存在。', 404);
    if (action === 'backup' && payload.category && payload.category !== 'manual') throw failure('定时备份已交由游戏官方机制，面板仅支持手动创建世界备份。');
    if (this.closing) throw failure('管理服务正在关闭。', 503);
    if (this.busy) throw failure('已有任务正在执行，请稍后再试。', 409);
    if (action === 'update' && this.runtime.game) throw failure('请先停止游戏服再更新服务端。', 409);
    if (action === 'backup' && this.runtime.game) throw failure('请先停止游戏服再创建世界备份。', 409);
    if (action === 'reset-save') this.requireResetAllowed(payload);
    if (action === 'backup') {
      await this.requireWorldSave();
      if (this.closing) throw failure('管理服务正在关闭。', 503);
      if (this.busy) throw failure('已有任务正在执行，请稍后再试。', 409);
      if (this.runtime.game) throw failure('请先停止游戏服再创建世界备份。', 409);
    }
    authorize();
    const task = { id: randomUUID(), action, state: 'running', message: '任务已开始', createdAt: new Date().toISOString() };
    this.busy = task;
    this.tasks.unshift(task); this.tasks = this.tasks.slice(0, 40);
    try { await this.saveTasks(); } catch (error) { this.busy = null; throw error; }
    this.changed();
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
        this.changed();
      }
    })();
    return { ...task };
  }
  async ensureConfig() {
    try { await stat(this.runtime.config); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const active = this.store.active();
      if (!active) throw failure('尚无可用配置，请先安装服务端或手动新建配置。', 409);
      await atomicWrite(this.runtime.config, output(active.source));
    }
  }
  servicePhase(phase, message) {
    if (this.busy && (this.busy.phase !== phase || this.busy.message !== message)) {
      this.busy.phase = phase; this.busy.message = message;
      this.changed();
    }
  }
  async startGame() {
    this.servicePhase('starting', '正在启动游戏服务，等待管理接口就绪。');
    await this.runtime.start();
  }
  async stopGame(options) {
    this.servicePhase('stopping', '正在保存世界并等待游戏服务退出。');
    await this.runtime.stop(options);
  }
  async installGame() {
    const update = this.busy?.action === 'update';
    this.servicePhase(update ? 'updating' : 'installing', update ? '正在启动 SteamCMD，准备更新服务端。' : '正在启动 SteamCMD，准备下载和安装服务端。');
    await this.runtime.install({ onProgress: (phase, message) => this.servicePhase(update && phase === 'installing' ? 'updating' : phase, message) });
  }
  async execute(action, payload, task) {
    switch (action) {
      case 'install':
        await this.installGame();
        task.defaultsImported = await this.store.syncDefaultProfile();
        await this.ensureConfig();
        this.updateCache = null;
        this.versionCache = null;
        if (payload.start) await this.startGame();
        break;
      case 'update': {
        await this.installGame();
        try { await this.store.syncDefaultProfile(); } catch (error) { this.runtime.log('palbox', `同步游戏默认配置失败：${error.message}\n`); }
        this.updateCache = null;
        this.versionCache = null;
        break;
      }
      case 'start': await this.ensureConfig(); await this.startGame(); break;
      case 'stop': await this.stopGame(); break;
      case 'restart': await this.requireRunning(); await this.stopGame({ requireSave: true }); await this.startGame(); break;
      case 'apply': {
        const snapshot = this.store.snapshot();
        if (payload.revision !== snapshot.revision || payload.profileId !== snapshot.workspace.activeId) throw failure('配置已变更，请等待自动保存完成后重新应用。', 409);
        const active = this.store.active();
        if (!active) throw failure('尚无可用配置，请先安装服务端或手动新建配置。', 409);
        const source = output(active.source);
        const values = new Map(parse(source).entries.map(e => [e.key, e.raw]));
        if (values.get('RESTAPIEnabled') !== 'True' || !decodeString(values.get('AdminPassword') || '""')) throw failure('管理模式需要 RESTAPIEnabled=True 和非空管理员密码。');
        const restPort = Number(values.get('RESTAPIPort') || 8212);
        if (!Number.isInteger(restPort) || restPort < 1 || restPort > 65535 || restPort === this.runtime.port || restPort === this.webPort) throw failure('REST API 端口无效或与现有服务端口冲突。');
        const running = Boolean(this.runtime.game);
        if (running) await this.stopGame({ requireSave: true });
        this.servicePhase('applying', '正在将配置写入游戏文件。');
        await atomicWrite(this.runtime.config, source);
        if (running) await this.startGame();
        break;
      }
      case 'backup': {
        await this.requireWorldSave();
        task.backup = await this.backup('manual');
        if (!task.backup) throw failure('存档目录已不存在，未创建备份。', 409);
        break;
      }
      case 'delete-backup': await this.deleteBackup(payload.id); break;
      case 'restore': await this.restore(payload.id); break;
      case 'restore-native': {
        await this.targetWorld();
        const running = Boolean(this.runtime.game);
        await this.native.restore(payload.id, async () => {
          if (running) await this.stopGame({ requireSave: true });
          await this.backup('before-restore');
          this.servicePhase('restoring', '正在恢复官方备份中的世界和玩家存档。');
        });
        if (running) await this.startGame();
        break;
      }
      case 'import-save': await this.restoreImported(payload.id, task); break;
      case 'reset-save': {
        this.requireResetAllowed(payload);
        task.backup = await this.backup('before-reset');
        this.servicePhase('resetting', '正在清空全部世界、玩家存档及官方备份历史。');
        task.removedEntries = await this.native.clearWorlds(() => this.requireResetAllowed(payload));
        this.runtime.log('palbox', `重置存档完成：已清空 SaveGames/0 下的 ${task.removedEntries} 个顶层条目。\n`);
        break;
      }
      case 'save-world': await this.requireRunning(); await this.runtime.rest('save', {}); break;
      case 'announce':
        await this.requireRunning();
        if (typeof payload.message !== 'string' || !payload.message.trim() || payload.message.length > 500) throw failure('请输入 1 到 500 字的广播内容。');
        await this.runtime.rest('announce', { message: payload.message }); break;
      case 'kick':
      case 'ban': {
        await this.requireRunning();
        if (typeof payload.userid !== 'string' || !payload.userid.trim() || payload.userid.length > 200 || /[\p{Cc}\p{Cf}]/u.test(payload.userid)) throw failure('玩家 ID 无效。');
        const userId = normalizeActionUserId(payload.userid);
        const fallback = action === 'kick' ? '管理员已将你移出服务器' : '管理员已将你封禁';
        const message = payload.message === undefined || payload.message === null || payload.message === '' ? fallback : payload.message;
        if (typeof message !== 'string' || !message.trim() || message.length > 500) throw failure('操作理由须为 1 到 500 个字符。');
        await this.runtime.rest(action, { userid: userId, message: message.trim() });
        if (action === 'ban') task.player = { userId, name: typeof payload.name === 'string' ? payload.name.slice(0, 100) : '', reason: message.trim(), bannedAt: new Date().toISOString() };
        break;
      }
      case 'unban': {
        await this.requireRunning();
        if (typeof payload.userid !== 'string' || !payload.userid.trim() || payload.userid.length > 200 || /[\p{Cc}\p{Cf}]/u.test(payload.userid)) throw failure('玩家 ID 无效。');
        const userId = normalizeActionUserId(payload.userid);
        await this.runtime.rest('unban', { userid: userId });
        task.player = { userId };
        break;
      }
      case 'force-stop':
        await this.requireRunning();
        this.servicePhase('force-stopping', '正在强制停止游戏服务，请稍候。');
        await this.runtime.forceStop();
        break;
    }
  }
  async requireRunning() { if (!this.runtime.game) throw failure('游戏服尚未运行。', 409); }
  async targetWorld() {
    const configured = await this.native.configuredWorld();
    if (configured) return configured;
    throw failure('无法确定游戏运行的世界 ID：GameUserSettings.ini 中缺少有效的 DedicatedServerName，请先恢复该文件或填写正确的世界 ID。', 409);
  }
  requireResetAllowed(payload) {
    if (payload.confirmation !== 'delete') throw failure('请输入 delete 确认重置存档。', 400);
    if (this.runtime.game) throw failure('请先停止游戏服务器，再重置存档。', 409);
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
      const wholeSaved = imported.kind === 'full';
      const worldId = wholeSaved ? null : await this.targetWorld();
      if (wasRunning) await this.stopGame({ requireSave: true });
      if (!wholeSaved && worldId !== await this.targetWorld()) throw failure('当前世界已改变，请刷新后重试。', 409);
      task.message = '正在创建导入前备份';
      task.backup = await this.backup('before-import');
      let target;
      if (wholeSaved) {
        target = this.runtime.saved;
        try { await this.native.safeDirectory([]); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        await mkdir(path.dirname(target), { recursive: true });
      } else {
        if (await this.targetWorld() !== worldId) throw failure('当前世界已改变，请刷新后重试。', 409);
        const ensured = await this.native.ensureWorld(worldId);
        target = ensured.directory;
        if (ensured.created) created = target;
      }
      this.servicePhase('restoring', wholeSaved ? '正在整体替换 Pal/Saved 中的全部存档和配置。' : '正在清空并替换当前世界目录中的全部内容。');
      await replaceDirectory(imported.snapshot, target);
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
        try { await this.startGame(); }
        catch (error) { this.runtime.log('palbox', `导入失败后启动游戏服失败：${error.message}\n`); }
      }
      throw failureError;
    }
    if (wasRunning && !this.runtime.game && !this.closing) {
      try { await this.startGame(); }
      catch (error) { throw failure(`存档已导入，但游戏服启动失败：${error.message}`, 500); }
    }
  }
  async hasWorldSave() {
    for (const worldId of await this.native.worlds()) {
      try {
        const level = await lstat(path.join(this.runtime.saved, 'SaveGames', '0', worldId, 'Level.sav'));
        if (level.isFile() && level.size > 0) return true;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return false;
  }
  async requireWorldSave() {
    if (!(await this.hasWorldSave())) throw failure('尚无可备份的世界存档，请先启动游戏并生成存档。', 409);
  }
  async checkBackupFiles(directory) {
    let populated = false;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const info = await lstat(file);
      if (info.isDirectory()) { if (await this.checkBackupFiles(file)) populated = true; }
      else if (info.isFile()) populated ||= info.size > 0;
      else throw failure('备份内容包含链接或特殊文件，拒绝备份或恢复。');
    }
    return populated;
  }
  async backup(category, protectedId = null) {
    const directory = await backupDirectory(this.directory, category);
    this.servicePhase('backing', '正在备份整个 Pal/Saved 目录。');
    // Stop the process before archiving so world/player files belong to one save.
    if (this.runtime.game) throw failure('创建备份前需要停止游戏服。', 409);
    try { await this.native.safeDirectory([]); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (!(await this.checkBackupFiles(this.runtime.saved))) return null;
    const worlds = await this.native.worlds();
    const worldId = await this.native.configuredWorld() || (worlds.length === 1 ? worlds[0] : null);
    const id = `${category}/${Date.now()}-${randomUUID()}.tar.gz`;
    const file = path.join(this.directory, 'backups', id);
    const stage = await mkdtemp(path.join(directory, '.creating-'));
    const temporary = path.join(stage, 'archive.tar.gz');
    try {
      await this.runtime.run('tar', ['-czf', temporary, '--hard-dereference', '-C', this.runtime.server, '--', 'Pal/Saved'], 'palbox');
      await backupDirectory(this.directory, category);
      await rename(temporary, file);
      await recordBackupWorld(file, worldId);
    } finally { await rm(stage, { recursive: true, force: true }); }
    const list = (await this.backups()).filter(b => b.category === category);
    for (const old of list.slice(this.backupRetentions[category])) if (old.id !== protectedId) await this.deleteBackup(old.id);
    return id;
  }
  backupFile(id) {
    if (typeof id !== 'string') throw failure('备份不存在。', 404);
    const [category, name, extra] = id.split('/');
    if (!categories.includes(category) || !backupId.test(name || '') || extra !== undefined) throw failure('备份路径无效。', 400);
    return path.join(this.directory, 'backups', category, name);
  }
  async checkedBackupFile(id) {
    const file = this.backupFile(id);
    await backupDirectory(this.directory, id.split('/')[0]);
    if (!(await lstat(file)).isFile()) throw failure('备份文件无效。', 400);
    return file;
  }
  async openBackup(id) {
    const file = await this.checkedBackupFile(id);
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      if (!(await handle.stat()).isFile()) throw failure('备份文件无效。', 400);
      return handle;
    } catch (error) { await handle.close(); throw error; }
  }
  async deleteBackup(id) {
    try {
      const file = await this.checkedBackupFile(id);
      await unlink(file);
      await removeBackupMetadata(file);
    } catch (error) {
      if (error.code === 'ENOENT') throw failure('备份不存在或已被删除，请刷新列表。', 404);
      throw error;
    }
  }
  async backups({ includeWorldId = false } = {}) {
    const entries = [];
    for (const category of categories) for (const name of await readdir(await backupDirectory(this.directory, category))) {
      if (!backupId.test(name)) continue;
      const file = path.join(this.directory, 'backups', category, name);
      const info = await lstat(file);
      if (info.isFile()) {
        const entry = { id: `${category}/${name}`, category, bytes: info.size, createdAt: info.mtime.toISOString() };
        if (includeWorldId) entry.worldId = await readBackupWorld(file, info);
        entries.push(entry);
      }
    }
    return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async restore(id) {
    const file = await this.checkedBackupFile(id);
    const captureLimit = 32 * 1024 * 1024;
    const listing = await this.runtime.run('tar', ['-tzf', file], 'palbox', { captureLimit });
    if (listing.length >= captureLimit) throw failure('备份目录清单过长，无法安全校验。');
    const names = listing.trim().split('\n');
    for (const name of names) if (!/^Pal\/Saved(?:\/|$)/.test(name) || name.split('/').some(p => p === '..') || name.includes('\\')) throw failure('备份包含不允许的路径。');
    const types = await this.runtime.run('tar', ['-tvzf', file], 'palbox', { captureLimit });
    if (types.length >= captureLimit || types.trim().split('\n').some(line => !['-', 'd'].includes(line[0]))) throw failure('备份包含链接或不支持的文件类型。');
    const worlds = [...new Set(names.map(name => /^Pal\/Saved\/SaveGames\/0\/([A-Za-z0-9_-]{1,128})\/Level\.sav$/.exec(name)?.[1]).filter(Boolean))];
    const configured = await this.native.configuredWorld();
    const currentWorld = configured && (await this.native.worlds()).includes(configured) ? configured : null;
    const stage = path.join(this.runtime.server, `.restore-${randomUUID()}`);
    const previous = path.join(this.runtime.server, `.saved-${randomUUID()}`);
    await mkdir(stage, { recursive: true });
    const running = Boolean(this.runtime.game);
    try {
      await this.runtime.run('tar', ['-xzf', file, '--no-same-owner', '--no-same-permissions', '-C', stage, '--', 'Pal/Saved']);
      const saved = path.join(stage, 'Pal/Saved');
      if (!(await this.checkBackupFiles(saved))) throw failure('备份中没有可恢复的文件。');
      const archived = new NativeBackups(saved, this.directory);
      const archivedWorld = await archived.configuredWorld();
      const sourceWorld = worlds.includes(archivedWorld) ? archivedWorld : worlds.includes(currentWorld) ? currentWorld : worlds.length === 1 ? worlds[0] : null;
      const wholeSaved = !currentWorld || !sourceWorld;
      const source = wholeSaved ? saved : path.join(saved, 'SaveGames/0', sourceWorld);
      if (wholeSaved) {
        if (worlds.length && !worlds.includes(archivedWorld)) throw failure('备份缺少有效的 GameUserSettings.ini 世界配置，无法整体还原；请先恢复当前世界配置后重试。', 409);
        try { parse(await readFile(path.join(saved, 'Config/LinuxServer/PalWorldSettings.ini'), 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') throw failure('备份缺少 PalWorldSettings.ini，无法整体还原。', 409); throw error; }
      } else {
        const level = await lstat(path.join(source, 'Level.sav'));
        if (!level.isFile() || !level.size) throw failure('备份中的世界存档为空或无效。');
      }
      if (running) await this.stopGame({ requireSave: true });
      if (!wholeSaved && currentWorld !== await this.targetWorld()) throw failure('当前世界已改变，请刷新后重试。', 409);
      await this.backup('before-restore', id);
      await this.checkedBackupFile(id);
      this.servicePhase('restoring', wholeSaved ? '正在整体还原 Pal/Saved 中的存档和配置。' : '正在恢复当前世界的存档，保留当前服务器配置。');
      const target = wholeSaved ? this.runtime.saved : await this.native.safeDirectory(['SaveGames', '0', currentWorld]);
      await mkdir(path.dirname(target), { recursive: true });
      let moved = false;
      try { await rename(target, previous); moved = true; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      try { await rename(source, target); }
      catch (error) {
        if (moved) {
          try { await rename(previous, target); }
          catch { throw failure(`恢复回滚失败，原数据已保留在 ${previous}，请检查服务器。`, 500); }
        }
        throw error;
      }
      if (moved) await rm(previous, { recursive: true });
    } finally { await rm(stage, { recursive: true, force: true }); }
    if (running) await this.startGame();
  }
  async bannedPlayers() {
    const value = await readBanList(this.runtime.saved);
    const snapshotAt = value.updatedAt ? Date.parse(value.updatedAt) : 0;
    const players = new Map(value.players.map(player => [player.userId, { ...player }]));
    // Newer server builds write the local ban list on shutdown. Merge the
    // latest successful panel action so bans made while the server is running
    // are immediately visible and can be undone.
    const latest = new Map();
    for (const task of this.tasks) {
      const userId = task.player?.userId;
      if (!userId || task.state !== 'succeeded' || !['ban', 'unban'].includes(task.action) || latest.has(userId)) continue;
      latest.set(userId, { task, at: Date.parse(task.finishedAt || task.createdAt) || 0 });
    }
    for (const [userId, { task, at }] of latest) {
      if (task.action === 'ban') {
        if (players.has(userId)) players.set(userId, { ...players.get(userId), ...task.player });
        else if (at > snapshotAt) players.set(userId, { ...task.player });
      } else if (at > snapshotAt) {
        players.delete(userId);
      }
    }
    return { players: [...players.values()], skipped: value.skipped };
  }
  async historicalPlayers(options) {
    await this.playerHistoryRecorder.pending;
    await this.playerHistory.pending;
    const value = this.playerHistory.list(options);
    const banned = new Set((await this.bannedPlayers()).players.map(player => player.userId));
    return {
      ...value, players: value.players.map(player => ({ ...player, banned: banned.has(player.userId) })),
      error: this.playerHistoryRecorder.error ? '玩家历史暂时无法更新，请查看服务器日志。' : null
    };
  }
  async clearPlayerHistory(checks) {
    const result = await this.playerHistory.clear(checks);
    this.playerHistoryRecorder.revision++; this.changed();
    return result;
  }
  async restorePlayerHistory(checks) {
    const result = await this.playerHistory.restore(this.playerHistoryRecorder.readEvents(), checks);
    this.playerHistoryRecorder.error = null;
    this.playerHistoryRecorder.revision++; this.changed();
    return result;
  }
  async runningConfiguration() {
    const game = this.runtime.game;
    if (!game) return { running: false };
    let settings;
    try { settings = await this.runtime.rest('settings'); }
    catch (error) {
      if (!this.runtime.game) return { running: false };
      if (this.runtime.game !== game) throw failure('游戏进程已变化，请重新打开运行参数。', 409);
      throw failure(`无法通过游戏 REST API 读取运行配置：${error.message}`, 502);
    }
    if (!this.runtime.game) return { running: false };
    if (this.runtime.game !== game) throw failure('游戏进程已变化，请重新打开运行参数。', 409);
    if (!settings || typeof settings !== 'object' || Array.isArray(settings) || !Object.keys(settings).length) throw failure('游戏 REST API 返回的运行配置格式无效。', 502);
    return {
      running: true,
      settings,
      args: [...(this.runtime.runningArgs || [])],
      port: this.runtime.port,
      startedAt: this.runtime.startedAt
    };
  }
  async status({ scope = 'overview' } = {}) {
    if (!['overview', 'players', 'local'].includes(scope)) throw failure('状态读取范围无效。', 400);
    const stateRevision = this.stateRevision;
    await this.store.syncDefaultProfile();
    const installed = await this.runtime.installed();
    const installedBuild = installed ? await this.installedBuild() : null;
    if (!installed || this.versionCache?.build !== installedBuild) this.versionCache = null;
    let disk = null;
    try { disk = await readFile(this.runtime.config, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const active = this.store.active();
    const desired = active ? output(active.source) : null;
    let configuration = disk && output(disk) === desired ? 'applied' : 'pending';
    if (this.runtime.game && (!this.runtime.runningSource || output(this.runtime.runningSource) !== desired)) configuration = 'pending';
    const game = this.runtime.game;
    const status = { stateInstance: this.stateInstance, stateRevision, installed, installedBuild, version: this.versionCache?.version || null, hasWorldSave: await this.hasWorldSave(), running: Boolean(game), ready: this.runtime.ready, configuration, hasConfiguration: Boolean(active), startedAt: this.runtime.startedAt, lastExit: this.runtime.lastExit, task: this.busy, tasks: this.tasks, revision: this.store.revision, port: this.runtime.port };
    status.playerHistoryRevision = this.playerHistoryRecorder.revision;
    const endpoints = scope === 'overview' ? ['info', 'metrics', 'players'] : scope === 'players' ? ['players'] : [];
    for (const endpoint of endpoints) status[endpoint] = endpoint === 'players' ? [] : null;
    if (game && endpoints.length) {
      const results = await Promise.allSettled(endpoints.map(endpoint => this.runtime.rest(endpoint)));
      if (this.runtime.game !== game || this.stateRevision !== stateRevision) return this.status({ scope: 'local' });
      endpoints.forEach((endpoint, index) => {
        const result = results[index];
        if (endpoint === 'info') {
          status.ready = this.runtime.ready = result.status === 'fulfilled';
          if (result.status === 'fulfilled' && typeof result.value?.version === 'string' && result.value.version.trim()) {
            status.version = result.value.version.trim();
            this.versionCache = { build: installedBuild, version: status.version };
          }
        }
        if (result.status === 'fulfilled') status[endpoint] = endpoint === 'players' ? result.value.players || [] : result.value;
      });
    }
    return status;
  }
  async installedBuild() {
    try {
      const manifest = await readFile(path.join(this.runtime.server, 'steamapps/appmanifest_2394010.acf'), 'utf8');
      return manifest.match(/"buildid"\s+"(\d+)"/)?.[1] || null;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  async latestBuild() {
    if (this.busy) throw failure('已有任务正在执行，请稍后再试。', 409);
    // SteamCMD.net is much faster than launching SteamCMD; use it first and
    // fall back to the local client when the API is unavailable.
    try {
      const response = await fetch('https://api.steamcmd.net/v1/info/2394010', {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
      if (response.ok) {
        const build = steamCmdApiBuild(await response.json());
        if (build) return build;
      }
    } catch { /* fall through to SteamCMD */ }
    const args = ['+login', 'anonymous', '+app_info_update', '1', '+app_info_print', '2394010', '+quit'];
    const options = { timeout: 60000, maxBuffer: 8 * 1024 * 1024, env: this.runtime.childEnvironment() };
    const parse = value => value.match(/"public"\s*\{[\s\S]{0,4000}?"buildid"\s*"(\d+)"/)?.[1] || null;
    let output = '';
    try {
      const result = await exec(this.runtime.steamcmd, args, options);
      output = `${result.stdout || ''}${result.stderr || ''}`;
    } catch {}
    let build = parse(output);
    if (!build) {
      try {
        const command = [this.runtime.steamcmd, ...args].map(shellQuote).join(' ');
        const result = await exec('script', ['-qec', command, '/dev/null'], options);
        output = `${result.stdout || ''}${result.stderr || ''}`;
        build = parse(output);
      } catch {}
    }
    if (!build) throw failure('无法获取 Steam 最新版本信息，请稍后重试。', 502);
    return build;
  }
  async updateInfo() {
    const now = Date.now();
    if (this.updateCache && now - this.updateCache.at < 5 * 60 * 1000) return this.updateCache.value;
    const installedBuild = await this.installedBuild();
    let value;
    if (!installedBuild) {
      value = { installed: false, installedBuild: null, latestBuild: null, updateAvailable: false, checkedAt: new Date().toISOString() };
    } else {
      try {
        const latestBuild = await this.latestBuild();
        value = { installed: true, installedBuild, latestBuild, updateAvailable: latestBuild !== installedBuild, checkedAt: new Date().toISOString() };
      } catch (error) {
        value = { installed: true, installedBuild, latestBuild: null, updateAvailable: null, checkedAt: new Date().toISOString(), error: error.message };
      }
    }
    this.updateCache = { at: now, value };
    return value;
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
  publicSettings() {
    return {
      backupRetention: this.backupRetention,
      backupRetentions: this.backupRetentions,
      autoStart: this.autoStart,
      shutdownWait: this.shutdownWait,
      shutdownMessage: this.shutdownMessage,
      gameArgs: [...this.gameArgs],
      installArgs: this.installArgs.map(arg => arg === '{server}' ? this.runtime.server : arg)
    };
  }
  updateAdmin(change, { authorize = () => {} } = {}) {
    const operation = this.settingsUpdates.then(async () => {
      authorize();
      if (this.setupRequired) throw failure('请先完成管理员初始化。', 409);
      const admin = change(structuredClone(this.settings.admin));
      const next = { ...this.settings, admin };
      this.validateSettings(next);
      await jsonWrite(this.settingsFile, next, { beforeCommit: authorize });
      this.settings = next;
    });
    this.settingsUpdates = operation.catch(() => {});
    return operation;
  }
  updateSettings(value, { authorize = () => {} } = {}) {
    const update = this.settingsUpdates.then(() => {
      authorize();
      return this.applySettings(value, { authorize });
    });
    this.settingsUpdates = update.catch(() => {});
    return update;
  }
  async applySettings(value, { authorize = () => {} } = {}) {
    if (this.setupRequired) throw failure('请先完成管理员初始化。', 409);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('设置格式不正确。');
    if (Object.hasOwn(value, 'backupIntervalHours')) throw failure('面板定时备份已移除，请使用游戏官方自动备份。');
    const hasRetention = Object.hasOwn(value, 'backupRetention');
    const hasRetentions = Object.hasOwn(value, 'backupRetentions');
    const hasAutoStart = Object.hasOwn(value, 'autoStart');
    const hasShutdownWait = Object.hasOwn(value, 'shutdownWait');
    const hasShutdownMessage = Object.hasOwn(value, 'shutdownMessage');
    const hasArgs = Object.hasOwn(value, 'gameArgs');
    const hasInstallArgs = Object.hasOwn(value, 'installArgs');
    if (!hasRetention && !hasRetentions && !hasAutoStart && !hasShutdownWait && !hasShutdownMessage && !hasArgs && !hasInstallArgs) throw failure('请提供要保存的设置。');
    const next = { ...this.settings, gameArgs: [...this.gameArgs], installArgs: [...this.installArgs] };
    if (hasRetention) {
      if (!Number.isInteger(value.backupRetention) || value.backupRetention < 1 || value.backupRetention > MAX_BACKUP_RETENTION) throw failure(`世界备份保留数量须为 1 到 ${MAX_BACKUP_RETENTION}。`);
      next.backupRetention = value.backupRetention;
      next.backupRetentions = Object.fromEntries(categories.map(category => [category, value.backupRetention]));
    }
    if (hasRetentions) {
      if (!validBackupRetentions(value.backupRetentions)) throw failure('备份分类无效，或保留数量不在 1 到 20 之间。');
      next.backupRetentions = { ...(next.backupRetentions ?? this.backupRetentions), ...value.backupRetentions };
    }
    if (hasAutoStart) {
      if (typeof value.autoStart !== 'boolean') throw failure('自动启动设置必须为布尔值。');
      next.autoStart = value.autoStart;
    }
    if (hasShutdownWait) {
      if (!Number.isInteger(value.shutdownWait) || value.shutdownWait < 0 || value.shutdownWait > 300) throw failure('关服倒计时须为 0 到 300 的整数秒。');
      next.shutdownWait = value.shutdownWait;
    }
    if (hasShutdownMessage) {
      if (typeof value.shutdownMessage !== 'string' || !value.shutdownMessage.trim() || value.shutdownMessage.length > 500 || /\p{Cc}/u.test(value.shutdownMessage)) throw failure('关服提示须为 1 到 500 个字符，且不能包含控制字符。');
      next.shutdownMessage = value.shutdownMessage.trim();
    }
    if (hasArgs) {
      const message = gameArgsError(value.gameArgs);
      if (message) throw failure(message);
      next.gameArgs = [...value.gameArgs];
    }
    if (hasInstallArgs) next.installArgs = normalizeInstallArgs(value.installArgs, this.runtime.server);
    await jsonWrite(this.settingsFile, next, { beforeCommit: authorize });
    this.settings = next;
    this.syncRuntimeArgs();
    this.syncRuntimeInstallArgs();
    return this.publicSettings();
  }
  async close() {
    this.closing = true;
    await this.runtime.close();
    await this.playerHistoryRecorder.close();
    await this.operation;
    await this.settingsUpdates;
  }
}
