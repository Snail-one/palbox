import { createArgsDialog } from './args-dialog.js';
import { createSaveImportDialog } from './save-import-dialog.js';
import { formatBytes } from './format.js';
import { gameServiceState } from './game-service-state.js';
import { createRunningConfigPanel } from './running-config-panel.js';
import { compactLogDisplay } from './log-display.js';
import { createTimeFormatter } from './time.js';
import { createBackupRetentionAutosave } from './backup-retention-autosave.js';

const BACKUP_GROUPS = {
  manual: '手动备份',
  'before-restore': '恢复前备份',
  'before-import': '导入前备份',
  'before-reset': '重置前备份',
  scheduled: '旧定时归档',
  'before-update': '历史更新前备份'
};
const BACKUP_GROUP_DETAILS = {
  manual: ['file', '手动创建，用于日常留档', '停止游戏后，可创建第一份完整备份。'],
  'before-restore': ['restore', '恢复备份前自动保存当前数据', '恢复备份时，会自动在这里保留当前数据。'],
  'before-import': ['upload', '导入外部存档前自动保存', '导入存档时，会自动在这里保留原存档。'],
  'before-reset': ['shield', '清空世界存档前自动保存', '重置存档时，会先在这里保留完整备份。'],
  scheduled: ['restore', '旧版定时任务创建的归档', ''],
  'before-update': ['server', '旧版更新前创建的归档', '']
};

function uptimeLabel(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const minutes = Math.max(0, Math.floor(seconds / 60));
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时${minutes % 60 ? `${minutes % 60}分` : ''}`;
  return `${Math.floor(hours / 24)}天${hours % 24 ? `${hours % 24}小时` : ''}`;
}

export function createManagementPanel({ dom, api, ask, notify, getConfiguration, onDefaultsImported, onWorkspaceChanged }) {
  const { $, document } = dom;
  const timeFormat = createTimeFormatter();
  const NATIVE_BACKUP_PAGE_SIZE = 10;
  const section = document.createElement('section');
  section.className = 'game-service-toolbar';
  section.setAttribute('aria-label', '帕鲁服务管理');
  section.id = 'server-service';
  section.innerHTML = `
    <h2>游戏服务</h2>
    <div class="management-actions server-heading-actions"><label class="auto-start-switch" title="启用后，面板或容器重启并完成初始化时会自动创建启动任务；服务端未安装或尚未初始化时跳过"><input type="checkbox" role="switch" class="sr-only" id="auto-start" disabled><span class="toggle" aria-hidden="true"></span><span>自动启动</span></label></div>
    <div class="server-primary-actions" role="group" aria-label="游戏服务操作">
        <span id="game-state" class="save-status" data-state="pending" role="status" title="正在连接面板，读取游戏服务状态。">连接中</span>
        <button class="button primary" data-action="install" hidden>安装服务端</button><button class="button primary" data-action="start">启动</button><button class="button secondary" data-action="stop" hidden>停止</button><button class="button secondary" data-action="restart" hidden>重启</button>
        <button class="button secondary" data-action="force-stop" title="仅在正常停止无效时使用，可能丢失最近一次未保存的进度。">强制停止</button><button class="button secondary" data-action="update" title="请先停止游戏服再更新；更新后保持停服。">更新服务端</button><button class="button secondary" id="show-running-config" disabled>运行参数</button><button class="button secondary" id="edit-game-args" disabled>启动参数</button><button class="button secondary" id="edit-install-args" disabled>安装参数</button><button class="button secondary" id="edit-shutdown-wait" title="设置关服倒计时和游戏内提示文字" disabled>关服设置</button>
    </div>
    <button type="button" id="refresh-status" class="button secondary" title="读取当前页面所需的最新状态">刷新状态</button>
    <button type="button" id="show-task-history" class="button secondary" aria-haspopup="dialog" aria-controls="task-history">任务记录</button>`;
  $('game-actions').append(section);
  const metrics = document.createElement('section');
  metrics.id = 'server-metrics';
  metrics.className = 'management-panel';
  metrics.setAttribute('aria-label', '服务器运行信息');
  metrics.innerHTML = `<dl class="management-metrics" aria-label="服务器运行信息">
      <div class="server-metric server-version-metric"><dt>游戏版本</dt><dd id="game-version" class="metric-value metric-text">读取中</dd><dd id="game-build-meta" class="server-metric-note" hidden>Steam Build <span id="game-build">—</span></dd><dd class="server-metric-update"><button class="button secondary" id="check-update" disabled>检查更新</button></dd></div>
      <div class="server-metric"><dt>在线玩家</dt><dd id="game-players" class="metric-value">—</dd></div>
      <div class="server-metric"><dt>服务器 FPS</dt><dd id="game-fps" class="metric-value">—</dd></div>
      <div class="server-metric"><dt>游戏端口</dt><dd class="metric-value"><span id="game-port">8211</span><span class="metric-unit">UDP</span></dd></div>
      <div class="server-metric"><dt>运行时间</dt><dd id="game-uptime" class="metric-value">—</dd></div>
    </dl>`;
  $('game-overview').append(metrics);
  const logs = document.createElement('section');
  logs.id = 'game-logs';
  logs.className = 'management-panel';
  logs.setAttribute('aria-label', '运行日志');
  logs.innerHTML = `<div class="management-heading log-heading"><h2>运行日志</h2><div class="log-controls"><div class="segmented log-type-buttons" id="manager-log-channel" role="group" aria-label="日志类型"><button type="button" class="selected" data-log-channel="all" aria-pressed="true">全部日志</button><button type="button" data-log-channel="game" aria-pressed="false">游戏日志</button><button type="button" data-log-channel="steamcmd" aria-pressed="false">安装与更新</button><button type="button" data-log-channel="palbox" aria-pressed="false">面板日志</button></div></div></div><p id="manager-log-status" class="management-note" role="status">正在连接实时日志…</p><pre id="manager-logs" tabindex="0">正在读取日志…</pre>`;
  $('game-overview').append(logs);
  const logHistoryActions = document.createElement('div');
  logHistoryActions.className = 'log-history-actions';
  logHistoryActions.innerHTML = '<button id="manager-log-older" type="button" class="button secondary" disabled>加载更早日志</button><button id="manager-log-latest" type="button" class="button secondary">返回最新</button>';
  logs.querySelector('.log-controls').append(logHistoryActions);
  const logHistoryNote = document.createElement('p');
  logHistoryNote.id = 'manager-log-history-note'; logHistoryNote.className = 'management-note'; logHistoryNote.hidden = true;
  logHistoryNote.setAttribute('role', 'status');
  logs.insertBefore(logHistoryNote, $('manager-logs'));
  const history = document.createElement('dialog');
  history.id = 'task-history';
  history.className = 'task-history-dialog';
  history.setAttribute('aria-labelledby', 'task-history-title');
  history.innerHTML = '<div class="management-heading"><h2 id="task-history-title">任务记录</h2><button type="button" id="close-task-history" class="icon-button" aria-label="关闭任务记录"><svg class="icon" aria-hidden="true"><use href="#i-close"/></svg></button></div><div id="task-history-list">暂无任务记录。</div>';
  document.body.append(history);
  $('show-task-history').addEventListener('click', () => { history.showModal(); void refresh({ scope: 'local' }); });
  $('close-task-history').addEventListener('click', () => history.close());
  const playerPanel = document.createElement('section');
  playerPanel.id = 'online-player-management';
  playerPanel.className = 'management-panel player-management';
  playerPanel.setAttribute('aria-label', '在线玩家与广播');
  playerPanel.innerHTML = `<div class="management-heading"><div><h2>在线玩家</h2><p id="online-player-note" class="management-note">正在读取玩家状态…</p></div></div><form id="manager-announce" class="player-broadcast"><label for="announce-message"><svg class="icon" aria-hidden="true"><use href="#i-globe"/></svg>全服广播</label><div class="player-broadcast-controls"><input id="announce-message" maxlength="500" required placeholder="向在线玩家发送公告…"><button class="button secondary" type="submit" disabled>发送广播</button></div></form><div id="manager-players-list" class="player-card-grid">游戏服尚未连接</div>`;
  const bannedPanel = document.createElement('section');
  bannedPanel.id = 'banned-management';
  bannedPanel.className = 'management-panel player-management';
  bannedPanel.setAttribute('aria-label', '已封禁玩家');
  bannedPanel.innerHTML = `<div class="management-heading"><h2>已封禁玩家</h2><div class="management-actions"><button class="button secondary" id="ban-player" disabled>按 ID 封禁</button><button class="button secondary" id="unban-player" disabled>按 ID 解封</button></div></div><p id="banned-player-note" class="management-note">本服封禁名单，游戏服务运行后可封禁或解封。</p><div id="manager-banned-list" class="player-card-grid">正在读取封禁名单…</div>`;
  const playerHistoryPanel = document.createElement('section');
  playerHistoryPanel.id = 'player-history-management'; playerHistoryPanel.className = 'management-panel player-management';
  playerHistoryPanel.setAttribute('aria-labelledby', 'player-history-title');
  playerHistoryPanel.innerHTML = `<div class="management-heading"><h2 id="player-history-title">玩家登录历史</h2><div class="management-actions"><button id="restore-player-history" type="button" class="button secondary" title="从保留的游戏日志中恢复历史，并与当前记录合并" disabled><svg class="icon" aria-hidden="true"><use href="#i-restore"/></svg><span id="restore-player-history-label">恢复历史</span></button><button id="clear-player-history" type="button" class="button secondary danger-hover" disabled><svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg>清理历史</button></div></div><p id="player-history-note" class="management-note">从游戏连接日志记录昵称、UserID 和 IP；收到成功登录日志后更新状态。</p><form id="player-history-search" role="search"><label class="sr-only" for="player-history-query">搜索历史玩家</label><input id="player-history-query" type="search" maxlength="200" placeholder="搜索昵称、UserID 或 IP"><button type="submit" class="button secondary">搜索</button></form><p id="player-history-summary" class="management-note" role="status">正在读取…</p><div id="player-history-list" class="player-card-grid"></div><nav id="player-history-pagination" class="backup-pagination" aria-label="玩家历史分页" hidden></nav>`;
  const playerNavigation = document.createElement('div'); playerNavigation.className = 'player-navigation';
  playerNavigation.innerHTML = `<div class="player-page-heading"><h2>玩家管理</h2><p>查看在线玩家，查询历史账号，管理封禁名单。</p></div><div class="player-tabs" role="tablist" aria-label="玩家管理分区"><button id="players-tab-online" type="button" role="tab" aria-controls="online-player-management" aria-selected="true" tabindex="0"><svg class="icon" aria-hidden="true"><use href="#i-user"/></svg>在线玩家<span id="online-player-count" class="player-tab-count">—</span></button><button id="players-tab-history" type="button" role="tab" aria-controls="player-history-management" aria-selected="false" tabindex="-1"><svg class="icon" aria-hidden="true"><use href="#i-restore"/></svg>登录历史<span id="history-player-count" class="player-tab-count">—</span></button><button id="players-tab-banned" type="button" role="tab" aria-controls="banned-management" aria-selected="false" tabindex="-1"><svg class="icon" aria-hidden="true"><use href="#i-shield"/></svg>封禁名单<span id="banned-player-count" class="player-tab-count">—</span></button></div>`;
  const playerViews = { online: playerPanel, history: playerHistoryPanel, banned: bannedPanel };
  const playerViewNames = Object.keys(playerViews);
  function selectPlayerView(view, focus = false) {
    for (const [name, panel] of Object.entries(playerViews)) {
      const active = name === view;
      const button = $(`players-tab-${name}`);
      button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
      panel.hidden = !active;
      if (active && focus) button.focus();
    }
  }
  for (const [index, [name, panel]] of Object.entries(playerViews).entries()) {
    panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `players-tab-${name}`); panel.tabIndex = 0;
    panel.hidden = name !== 'online';
    const button = playerNavigation.querySelector(`#players-tab-${name}`);
    button.addEventListener('click', () => selectPlayerView(name));
    button.addEventListener('keydown', event => {
      const next = { ArrowRight: (index + 1) % 3, ArrowLeft: (index + 2) % 3, Home: 0, End: 2 }[event.key];
      if (next === undefined) return;
      event.preventDefault(); selectPlayerView(playerViewNames[next], true);
    });
  }
  $('game-players-view').append(playerNavigation, playerPanel, playerHistoryPanel, bannedPanel);
  const nativeSaves = document.createElement('section');
  nativeSaves.id = 'native-save-management';
  nativeSaves.className = 'management-panel save-management';
  nativeSaves.setAttribute('aria-labelledby', 'native-save-title');
  nativeSaves.innerHTML = `
    <div class="management-heading backup-page-heading"><div><h2 id="native-save-title">官方存档备份 <span id="native-backup-state" class="save-status" data-state="pending">读取中</span></h2><p class="management-note">游戏自动生成世界和玩家快照；时间按本地时区显示（${timeFormat.timeZone}）。</p></div><div class="management-actions"><button class="button secondary" data-action="reset-save" title="仅在游戏服务器停止且没有任务执行时可重置存档" disabled><svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg>重置存档</button><button class="button secondary" data-action="import-save" disabled><svg class="icon" aria-hidden="true"><use href="#i-upload"/></svg>导入存档</button><button class="button primary" data-action="save-world" disabled>保存世界</button></div></div>
    <div class="backup-overview native-backup-overview"><div class="backup-stat"><span>全部快照</span><strong id="native-backup-summary" role="status">正在读取…</strong></div><div class="backup-stat"><span>最近备份</span><span id="native-backup-latest">正在读取…</span></div><div class="backup-stat"><span>当前世界</span><span id="native-backup-world">正在读取…</span></div></div>
    <div class="backup-policy native-backup-policy"><div><span class="native-policy-title">游戏默认保留策略</span><div class="native-policy-tiers"><span>30 秒 <strong>5 份</strong></span><span>10 分钟 <strong>6 份</strong></span><span>1 小时 <strong>12 份</strong></span><span>1 天 <strong>7 份</strong></span></div></div><a class="button secondary" href="#configuration">备份配置 →</a></div>
    <p class="backup-status-note management-note"><svg class="icon" aria-hidden="true"><use href="#i-info"/></svg><span id="native-backup-note"></span></p>
    <div id="native-backups">正在读取官方备份…</div>`;
  $('saves-native').append(nativeSaves);
  const saves = document.createElement('section');
  saves.id = 'save-management';
  saves.className = 'management-panel save-management';
  saves.setAttribute('aria-labelledby', 'save-management-title');
  saves.innerHTML = `
    <div class="management-heading backup-page-heading"><div><h2 id="save-management-title">完整备份</h2><p class="management-note">完整保留世界、玩家存档和游戏配置；时间按本地时区显示（${timeFormat.timeZone}）。</p></div><div class="management-actions"><button class="button primary" data-action="backup" disabled><svg class="icon" aria-hidden="true"><use href="#i-plus"/></svg>创建完整备份</button></div></div>
    <div class="backup-overview"><div class="backup-stat"><span>全部归档</span><strong id="save-backup-summary" role="status">正在读取…</strong></div><div class="backup-stat"><span>最近备份</span><span id="save-backup-latest">正在读取…</span></div><div class="backup-stat"><span>保留策略</span><span>各分类单独设置 · 每类最多 20 份</span></div></div>
    <p id="complete-backup-note" class="backup-status-note management-note"><svg class="icon" aria-hidden="true"><use href="#i-info"/></svg><span id="complete-backup-status">创建手动备份前，请先停止游戏服务。</span></p>
    <div id="manager-backups">正在读取完整备份…</div>`;
  $('saves-archives').append(saves);
  const configurationApply = $('configuration-apply');
  document.querySelector('.bottom-note > span:last-child').textContent = '配置自动保存 · 应用后在游戏中生效';
  const actionButtons = [...section.querySelectorAll('[data-action]'), ...nativeSaves.querySelectorAll('[data-action]'), ...saves.querySelectorAll('[data-action]'), ...configurationApply.querySelectorAll('[data-action]')];
  actionButtons.forEach(button => { button.disabled = true; });
  const names = { install: '安装服务端', start: '启动', stop: '停止', 'force-stop': '强制停止', restart: '重启', update: '更新服务端', apply: '应用配置', backup: '创建备份', 'delete-backup': '删除备份', restore: '恢复备份', 'restore-native': '恢复官方备份', 'import-save': '导入存档', 'reset-save': '重置存档', 'save-world': '保存世界', announce: '发送广播', kick: '移出玩家', ban: '封禁玩家', unban: '解封玩家' };
  let refreshing = false;
  let pendingRefresh = null;
  let closeStatus = null;
  let statusGeneration = 0;
  let stopped = false;
  let lastTask;
  let activeTaskId;
  let lastStatus;
  const retiredStatusInstances = new Set();
  let settingsRequest = null;
  let settingsCache = null;
  let backupRenderKey = null;
  const retentionAutosave = createBackupRetentionAutosave({
    getSaved: category => settingsCache?.backupRetentions?.[category] ?? 5,
    async save(category, count) {
      const saved = await api.request('settings', { method: 'PUT', body: { backupRetentions: { [category]: count } } });
      settingsCache = { ...saved, backupRetentions: { ...settingsCache?.backupRetentions, [category]: saved.backupRetentions[category] } };
    },
    onState: renderRetentionState
  });
  let checkingUpdate = false;
  let loadingBans = false;
  let lastBanError = '';
  let bannedCache = null;
  let bannedRenderKey = '';
  let playersRenderKey = null;
  let playerHistoryCache = null;
  let playerHistoryRenderKey = null;
  let playerHistoryQuery = '';
  let playerHistoryPage = 1;
  let playerHistoryRequest = 0;
  let playerHistorySearchTimer = null;
  let clearingPlayerHistory = false;
  let restoringPlayerHistory = false;
  let logChannel = 'all';
  let nativeBackupPage = 0;
  let nativeBackupRenderKey = null;
  let logGeneration = 0;
  let closeLogs = null;
  let logHistory = null;
  let loadingOlderLogs = false;
  let activeLogChannel = null;
  let pageActive = true;
  let lastErrorMessage = '';
  function error(message) {
    if (!message) { lastErrorMessage = ''; return; }
    if (message === lastErrorMessage) return;
    lastErrorMessage = message;
    notify(message, true);
  }
  function trackTask(task) {
    if (task.state === 'running') {
      activeTaskId = task.id;
    } else if (activeTaskId === task.id) {
      activeTaskId = null;
      if (task.defaultsImported && task.state === 'succeeded') onDefaultsImported?.();
    }
  }
  async function action(name, payload = {}, confirm = true) {
    if (confirm && ['stop', 'force-stop', 'restart', 'update', 'apply', 'backup', 'restore', 'restore-native', 'reset-save', 'kick'].includes(name)) {
      const descriptions = {
        apply: '将当前配置写入游戏，不创建备份。游戏服正在运行时会先存档、停服，再应用并重启。',
        backup: '仅在游戏服停止时备份完整存档和配置，完成后保持停服。',
        restore: '用这份完整备份恢复游戏配置和世界存档。当前存档会先备份到“恢复前备份”，面板中的配置预设保持不变。',
        'restore-native': '将当前世界和玩家存档恢复到所选官方备份。会先存档、停服并创建完整备份，归入“恢复前备份”，保留当前配置及官方备份历史；原先运行的游戏服会重新启动。',
        'reset-save': '将先创建完整备份，单独保存在“重置前备份”中，再清空 Pal/Saved/SaveGames/0 下的全部内容，包括所有世界、玩家存档和该目录中的官方备份历史。备份失败时中止重置；游戏配置和完整备份归档保留。必须先停止游戏服务器，完成后保持停服。',
        update: '仅在游戏服停止时使用 SteamCMD 更新服务端，不自动创建备份，更新完成后保持停服。',
        stop: '保存世界后停止游戏服，管理面板继续运行。',
        'force-stop': '立即强制停止游戏服，可能丢失最近一次未保存的进度。仅在正常停止失败时使用。',
        restart: '保存世界并重启游戏服。', kick: '将选中的玩家移出游戏服。'
      };
      const confirmed = await ask({ title: `${names[name]}？`, description: descriptions[name], confirm: names[name], danger: ['restore', 'restore-native', 'reset-save', 'kick', 'force-stop'].includes(name), symbol: 'server',
        ...(name === 'reset-save' ? { name: '', nameLabel: '输入 delete 确认删除', namePlaceholder: 'delete', nameMaxLength: 6, confirmation: 'delete' } : {}) });
      if (!confirmed) return;
      if (name === 'reset-save') payload = { ...payload, confirmation: confirmed };
    }
    try {
      if (name === 'apply') payload = { ...payload, ...await getConfiguration() };
      error('');
      const task = await api.request('tasks', { method: 'POST', body: { action: name, ...payload } });
      trackTask(task);
      await refresh();
    } catch (caught) { error(caught.message); }
  }
  const gameArgsDialog = createArgsDialog({ dom, prefix: 'game-args', onSave: async gameArgs => {
    const saved = await api.request('settings', { method: 'PUT', body: { gameArgs } });
    settingsCache = saved;
    notify('启动参数已保存，将在下次启动或重启游戏服时生效');
  } });
  $('edit-shutdown-wait').addEventListener('click', () => {
    const dialog = $('shutdown-wait-dialog');
    if (dialog.open) return;
    $('shutdown-wait-input').value = settingsCache?.shutdownWait ?? 5;
    $('shutdown-message-input').value = settingsCache?.shutdownMessage ?? 'Palbox 正在维护服务器';
    $('shutdown-wait-error').hidden = true;
    dialog.showModal();
  });
  for (const id of ['shutdown-wait-close', 'shutdown-wait-cancel']) $(id).addEventListener('click', () => $('shutdown-wait-dialog').close());
  $('shutdown-wait-save').addEventListener('click', async () => {
    const input = $('shutdown-wait-input');
    const errorNode = $('shutdown-wait-error');
    const value = input.value.trim() === '' ? NaN : Number(input.value);
    const message = $('shutdown-message-input').value.trim();
    if (!Number.isInteger(value) || value < 0 || value > 300) {
      errorNode.textContent = '关服倒计时须为 0 到 300 的整数秒。';
      errorNode.hidden = false;
      return;
    }
    if (!message || message.length > 500 || /\p{Cc}/u.test(message)) {
      errorNode.textContent = '关服提示须为 1 到 500 个字符，且不能包含控制字符。';
      errorNode.hidden = false;
      return;
    }
    const button = $('shutdown-wait-save');
    button.disabled = true; errorNode.hidden = true;
    try {
      settingsCache = await api.request('settings', { method: 'PUT', body: { shutdownWait: value, shutdownMessage: message } });
      $('shutdown-wait-dialog').close();
      notify(`关服设置已保存：倒计时 ${value} 秒，提示将在下次关服时显示`);
    } catch (caught) {
      errorNode.textContent = caught.message;
      errorNode.hidden = false;
    } finally { button.disabled = false; }
  });
  let runningRead = 0;
  const runningPanel = createRunningConfigPanel({ dom });
  $('show-running-config').addEventListener('click', async () => {
    const dialog = $('running-config-dialog');
    if (dialog.open) return;
    const read = ++runningRead;
    $('running-config-error').hidden = true;
    $('running-config-note').textContent = '查看游戏当前生效的参数，仅供查看。修改配置请前往配置管理并应用。';
    $('running-command').textContent = '正在读取…';
    runningPanel.clear();
    $('running-config-state').textContent = '';
    dialog.showModal();
    try {
      const value = await api.request('running');
      if (!dialog.open || read !== runningRead) return;
      if (!value.running) {
        $('running-config-note').textContent = '游戏服务未运行，没有可读取的运行参数。';
        $('running-command').textContent = '—';
        return;
      }
      const quoted = value.args.map(arg => /[\s"']/.test(arg) ? JSON.stringify(arg) : arg).join(' ');
      $('running-command').textContent = `PalServer.sh -port=${value.port}${quoted ? ' ' + quoted : ''}`;
      runningPanel.render(value.settings);
      const started = value.startedAt ? ` 启动时间：${timeFormat.dateTime(value.startedAt)}。` : '';
      $('running-config-state').textContent = `仅显示游戏 REST API 返回的配置字段。${started}`;
    } catch (caught) {
      if (!dialog.open || read !== runningRead) return;
      $('running-command').textContent = '—';
      $('running-config-error').textContent = caught.message;
      $('running-config-error').hidden = false;
    }
  });
  $('running-config-dialog').addEventListener('close', () => { runningRead++; runningPanel.clear(); });
  for (const id of ['running-config-close', 'running-config-done']) $(id).addEventListener('click', () => $('running-config-dialog').close());
  $('edit-game-args').addEventListener('click', () => gameArgsDialog.open((settingsCache?.gameArgs ?? []).join('\n')));
  const installArgsDialog = createArgsDialog({ dom, prefix: 'install-args', onSave: async installArgs => {
    const saved = await api.request('settings', { method: 'PUT', body: { installArgs } });
    settingsCache = saved;
    notify('安装参数已保存，将在下次安装或更新服务端时生效');
  } });
  $('edit-install-args').addEventListener('click', () => installArgsDialog.open((settingsCache?.installArgs ?? []).join('\n')));
  const saveImport = createSaveImportDialog({ dom, api, onImport: async id => {
    error('');
    const task = await api.request('tasks', { method: 'POST', body: { action: 'import-save', id } });
    trackTask(task);
    await refresh();
  } });
  for (const button of actionButtons) button.addEventListener('click', () => button.dataset.action === 'import-save' ? saveImport.open() : action(button.dataset.action));
  function renderRetentionState(category, state) {
    const status = $(`backup-retention-status-${category}`);
    if (!status) return;
    status.dataset.state = state.status;
    status.textContent = { saved: '已保存', pending: '待保存', saving: '保存中…', invalid: '请输入 1～20 的整数', error: '保存失败，回车重试' }[state.status];
    status.title = state.error || '';
    $(`backup-retention-${category}`).setAttribute('aria-invalid', String(state.status === 'invalid'));
  }
  async function loadBackups() {
    const backups = await api.request('backups');
    const renderKey = JSON.stringify([backups, Boolean(lastStatus?.task)]);
    if (renderKey === backupRenderKey) return;
    const totalBytes = backups.reduce((total, backup) => total + backup.bytes, 0);
    $('save-backup-summary').textContent = `${backups.length} 份 · ${formatBytes(totalBytes)}`;
    $('save-backup-summary').title = `${totalBytes} 字节`;
    $('save-backup-latest').textContent = backups.length ? timeFormat.dateTime(backups[0].createdAt) : '尚无备份';
    $('save-backup-latest').title = `本地时间（${timeFormat.timeZone}）`;
    $('manager-backups').replaceChildren();
    if (!backups.length) {
      const empty = document.createElement('p'); empty.className = 'backup-empty-summary'; empty.textContent = '暂无完整备份，创建或执行相关操作后会显示在对应分类中。'; $('manager-backups').append(empty);
    }
    const groups = new Map();
    for (const [category, title] of Object.entries(BACKUP_GROUPS)) {
      const entries = backups.filter(backup => backup.category === category);
      if (!entries.length && ['scheduled', 'before-update'].includes(category)) continue;
      const group = document.createElement('section'); group.className = 'backup-category'; group.dataset.backupCategory = category;
      const [icon, description, emptyDescription] = BACKUP_GROUP_DETAILS[category];
      const header = document.createElement('div'); header.className = 'backup-category-header';
      const badge = document.createElement('span'); badge.className = 'backup-category-icon'; badge.setAttribute('aria-hidden', 'true');
      badge.innerHTML = `<svg class="icon"><use href="#i-${icon}"/></svg>`;
      const details = document.createElement('div'); details.className = 'backup-category-details';
      const heading = document.createElement('h3'); heading.id = `backup-category-${category}`; heading.textContent = title;
      group.setAttribute('aria-labelledby', heading.id);
      const note = document.createElement('p'); note.textContent = description; details.append(heading, note);
      const summary = document.createElement('div'); summary.className = 'backup-category-summary';
      const count = document.createElement('strong'); count.textContent = `${entries.length} 份`;
      const size = document.createElement('span'); size.textContent = formatBytes(entries.reduce((total, backup) => total + backup.bytes, 0));
      summary.append(count, size); header.append(badge, details, summary); group.append(header);
      const list = document.createElement('div'); list.className = 'backup-category-entries';
      if (entries.length) { list.tabIndex = 0; list.setAttribute('role', 'region'); list.setAttribute('aria-label', `${title}列表`); }
      if (!entries.length) {
        const empty = document.createElement('div'); empty.className = 'backup-category-empty';
        const title = document.createElement('strong'); title.textContent = '暂无备份';
        const hint = document.createElement('p'); hint.textContent = emptyDescription; empty.append(title, hint); list.append(empty);
      }
      const policy = document.createElement('form'); policy.className = 'backup-retention-settings'; policy.dataset.retentionCategory = category;
      const retentionLabel = document.createElement('label'); retentionLabel.textContent = '保留';
      const retentionInput = document.createElement('input'); retentionInput.type = 'number'; retentionInput.min = '1'; retentionInput.max = '20'; retentionInput.required = true;
      retentionInput.id = `backup-retention-${category}`; retentionInput.setAttribute('aria-label', `${title}保留数量`);
      retentionInput.value = retentionAutosave.getState(category).value;
      retentionInput.title = '修改后自动保存；按回车立即保存';
      retentionInput.addEventListener('input', () => retentionAutosave.input(category, retentionInput.value));
      retentionInput.addEventListener('change', () => { retentionAutosave.input(category, retentionInput.value); void retentionAutosave.flush(category); });
      retentionInput.addEventListener('blur', () => { void retentionAutosave.flush(category); });
      retentionLabel.append(retentionInput, '份');
      const limit = document.createElement('span'); limit.className = 'backup-retention-hint'; limit.textContent = '最多 20 份';
      const status = document.createElement('span'); status.className = 'backup-retention-status'; status.id = `backup-retention-status-${category}`;
      status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      retentionInput.setAttribute('aria-describedby', status.id);
      policy.append(retentionLabel, limit, status);
      policy.addEventListener('submit', event => {
        event.preventDefault();
        void retentionAutosave.flush(category);
      });
      group.append(list, policy); groups.set(category, list); $('manager-backups').append(group);
      renderRetentionState(category, retentionAutosave.getState(category));
    }
    for (const backup of backups) {
      const row = document.createElement('div'); row.className = 'backup-row'; row.dataset.backupId = backup.id;
      const label = document.createElement('span'); label.className = 'backup-entry-info';
      const category = BACKUP_GROUPS[backup.category];
      const date = document.createElement('time'); date.dateTime = backup.createdAt; date.textContent = timeFormat.date(backup.createdAt);
      date.title = `本地时间（${timeFormat.timeZone}），原始时间 ${backup.createdAt}`;
      const meta = document.createElement('span'); meta.className = 'backup-entry-meta'; meta.textContent = `${timeFormat.time(backup.createdAt)} · ${formatBytes(backup.bytes)}`;
      label.append(date, meta);
      label.title = `${backup.bytes} 字节`;
      const download = document.createElement('a'); download.className = 'button secondary'; download.textContent = '下载'; download.href = `/api/backup?id=${encodeURIComponent(backup.id)}`; download.setAttribute('download', '');
      const restore = document.createElement('button'); restore.className = 'button secondary'; restore.textContent = '恢复'; restore.disabled = Boolean(lastStatus?.task); restore.addEventListener('click', () => action('restore', { id: backup.id }));
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button secondary danger-hover'; remove.textContent = '删除'; remove.disabled = Boolean(lastStatus?.task);
      remove.addEventListener('click', async () => {
        const confirmed = await ask({ title: '删除这份完整备份？', description: `${timeFormat.dateTime(backup.createdAt)} · ${category} · ${formatBytes(backup.bytes)}。确认后永久删除这份归档，无法撤销。当前游戏存档保持不变。`, confirm: '删除备份', danger: true, symbol: 'trash' });
        if (confirmed) await action('delete-backup', { id: backup.id }, false);
      });
      const actions = document.createElement('div'); actions.className = 'backup-entry-actions'; actions.append(download, restore, remove);
      row.append(label, actions); groups.get(backup.category).append(row);
    }
    backupRenderKey = renderKey;
  }
  async function loadNativeBackups() {
    const value = await api.request('native-backups');
    const pageCount = Math.max(1, Math.ceil(value.backups.length / NATIVE_BACKUP_PAGE_SIZE));
    nativeBackupPage = Math.min(nativeBackupPage, pageCount - 1);
    const renderKey = JSON.stringify([value, nativeBackupPage, Boolean(lastStatus?.task)]);
    if (renderKey === nativeBackupRenderKey) return;
    const badge = $('native-backup-state');
    badge.textContent = value.enabled === null ? '尚未配置' : value.enabled ? '已启用' : '未启用';
    badge.dataset.state = value.enabled ? 'saved' : 'pending';
    $('native-backup-note').textContent = value.enabled === false ? '当前游戏配置未启用官方自动备份，可前往配置管理开启；已有备份仍可下载。' : value.activeWorld ? '下载无需停服；恢复前会保存并停服、创建当前数据的完整备份。仅可恢复当前世界的快照。' : '世界尚未生成或无法确认当前世界；可下载已有备份，暂不允许恢复。';
    const nativeBytes = value.backups.reduce((total, backup) => total + backup.bytes, 0);
    $('native-backup-summary').textContent = `${value.backups.length} 份 · ${formatBytes(nativeBytes)}`;
    $('native-backup-summary').title = `${nativeBytes} 字节`;
    $('native-backup-latest').textContent = value.backups.length ? timeFormat.dateTime(value.backups[0].createdAt) : '尚无备份';
    $('native-backup-world').textContent = value.activeWorld || '尚未确认';
    $('native-backup-world').title = value.activeWorld || '世界生成后会自动识别';
    $('native-backups').replaceChildren();
    if (!value.backups.length) {
      const empty = document.createElement('div'); empty.className = 'native-backup-empty';
      empty.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-restore"/></svg><h3>暂无官方备份</h3><p>游戏生成完整的世界和玩家快照后，会自动显示在这里。<br>正在写入或已轮换的备份可能暂不可用。</p>';
      $('native-backups').append(empty);
      nativeBackupRenderKey = renderKey;
      return;
    }
    const start = nativeBackupPage * NATIVE_BACKUP_PAGE_SIZE;
    const grid = document.createElement('div'); grid.className = 'native-backup-grid';
    for (const backup of value.backups.slice(start, start + NATIVE_BACKUP_PAGE_SIZE)) {
      const card = document.createElement('article'); card.className = 'native-backup-card'; card.dataset.backupId = backup.id;
      const header = document.createElement('div'); header.className = 'native-backup-card-header';
      const icon = document.createElement('span'); icon.className = 'native-backup-icon'; icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = '<svg class="icon"><use href="#i-restore"/></svg>';
      const heading = document.createElement('h3'); heading.id = `native-backup-${grid.children.length}`;
      card.setAttribute('aria-labelledby', heading.id);
      const date = document.createElement('time'); date.dateTime = backup.createdAt; date.textContent = `${timeFormat.date(backup.createdAt)} `;
      date.title = `本地时间（${timeFormat.timeZone}） · 原始目录 ${backup.timestamp}`;
      const clock = document.createElement('span'); clock.className = 'native-backup-hour'; clock.textContent = timeFormat.time(backup.createdAt);
      date.append(clock); heading.append(date);
      const worldBadge = document.createElement('span'); worldBadge.className = 'native-backup-world-badge';
      worldBadge.dataset.current = String(backup.worldId === value.activeWorld);
      worldBadge.textContent = backup.worldId === value.activeWorld ? '当前世界' : value.activeWorld ? '其他世界' : '世界待确认';
      header.append(icon, heading, worldBadge);
      const details = document.createElement('dl'); details.className = 'native-backup-details';
      const size = document.createElement('div');
      const sizeLabel = document.createElement('dt'); sizeLabel.textContent = '备份大小';
      const sizeValue = document.createElement('dd'); sizeValue.textContent = formatBytes(backup.bytes); sizeValue.title = `${backup.bytes} 字节`;
      size.append(sizeLabel, sizeValue);
      const world = document.createElement('div');
      const worldLabel = document.createElement('dt'); worldLabel.textContent = '所属世界';
      const worldValue = document.createElement('dd'); worldValue.className = 'native-backup-world-id'; worldValue.textContent = backup.worldId;
      world.append(worldLabel, worldValue); details.append(size, world);
      const download = document.createElement('a'); download.className = 'button secondary'; download.textContent = '下载'; download.href = `/api/native-backup?id=${encodeURIComponent(backup.id)}`; download.setAttribute('download', '');
      const restore = document.createElement('button'); restore.className = 'button secondary'; restore.textContent = '恢复'; restore.disabled = Boolean(lastStatus?.task) || !backup.canRestore;
      if (!backup.canRestore) restore.title = '只能恢复已确认的当前世界备份';
      restore.addEventListener('click', () => action('restore-native', { id: backup.id }));
      const actions = document.createElement('div'); actions.className = 'native-backup-actions'; actions.append(download, restore);
      card.append(header, details, actions); grid.append(card);
    }
    $('native-backups').append(grid);
    if (pageCount > 1) {
      const pagination = document.createElement('div');
      pagination.className = 'backup-pagination';
      pagination.setAttribute('role', 'navigation');
      pagination.setAttribute('aria-label', '官方备份分页');
      const status = document.createElement('span');
      status.className = 'page-status';
      status.textContent = `第 ${nativeBackupPage + 1} / ${pageCount} 页 · 共 ${value.backups.length} 份`;
      pagination.append(status);
      async function changePage(next) {
        if (next === nativeBackupPage) return;
        nativeBackupPage = next;
        try {
          await loadNativeBackups();
          $('native-backups').scrollIntoView({ block: 'start', behavior: 'smooth' });
        } catch (caught) { error(caught.message); }
      }
      function navButton(label, target, disabled = false) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'button secondary';
        button.textContent = label;
        button.disabled = disabled;
        button.addEventListener('click', () => changePage(target));
        return button;
      }
      pagination.append(navButton('上一页', nativeBackupPage - 1, nativeBackupPage === 0));
      for (let index = 0; index < pageCount; index++) {
        const button = navButton(String(index + 1), index);
        button.classList.toggle('active', index === nativeBackupPage);
        button.setAttribute('aria-label', `官方备份第 ${index + 1} 页`);
        if (index === nativeBackupPage) button.setAttribute('aria-current', 'page');
        pagination.append(button);
      }
      pagination.append(navButton('下一页', nativeBackupPage + 1, nativeBackupPage === pageCount - 1));
      $('native-backups').append(pagination);
    }
    nativeBackupRenderKey = renderKey;
  }
  function renderLogs(text) {
    const panel = $('manager-logs');
    const content = compactLogDisplay(text || '') || '暂无日志';
    if (panel.textContent === content) return;
    const bottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 30;
    const scrollTop = panel.scrollTop;
    const scrollHeight = panel.scrollHeight;
    panel.textContent = content;
    if (loadingOlderLogs) panel.scrollTop = scrollTop + panel.scrollHeight - scrollHeight;
    else if (bottom) panel.scrollTop = panel.scrollHeight;
    else panel.scrollTop = scrollTop;
  }
  function stopLogs() {
    logGeneration++;
    closeLogs?.();
    closeLogs = null;
    activeLogChannel = null;
  }
  function syncLogs() {
    if (!pageActive || stopped || document.hidden || $('game-page').hidden || $('game-overview').hidden) { stopLogs(); return; }
    if (closeLogs && activeLogChannel === logChannel) return;
    stopLogs();
    const generation = logGeneration;
    activeLogChannel = logChannel;
    $('manager-log-status').textContent = '正在连接实时日志…';
    logHistory = api.watchLogHistory(logChannel, {
      onOpen() {
        if (generation === logGeneration) $('manager-log-status').textContent = `日志实时更新，断线后自动重连；时间为本地时间（${timeFormat.timeZone}）。`;
      },
      onLog(text) { if (generation === logGeneration) renderLogs(text); },
      onState(state) {
        if (generation !== logGeneration) return;
        $('manager-log-older').disabled = state.loading || !state.hasMore;
        $('manager-log-older').textContent = state.loading ? '正在加载…' : state.hasMore ? '加载更早日志' : '已加载全部保留日志';
        const note = $('manager-log-history-note');
        note.hidden = !state.paused && !state.gap;
        note.textContent = state.paused ? '实时更新已暂停，可继续查看更早记录，或返回最新。' : '部分历史日志已被轮换或清理。';
      },
      onError(caught) {
        if (generation !== logGeneration) return;
        $('manager-log-status').textContent = caught.message;
        if (caught.status === 401) { stopped = true; stopLogs(); }
      }
    });
    const currentHistory = logHistory;
    closeLogs = () => currentHistory.close();
  }
  $('manager-log-older').addEventListener('click', async () => {
    loadingOlderLogs = true;
    try { await logHistory?.loadOlder(); } finally { loadingOlderLogs = false; }
  });
  $('manager-log-latest').addEventListener('click', () => {
    $('manager-logs').scrollTop = $('manager-logs').scrollHeight;
    logHistory?.latest();
  });
  $('manager-logs').addEventListener('scroll', () => {
    const panel = $('manager-logs');
    if (!loadingOlderLogs && panel.scrollTop < 30 && panel.scrollHeight > panel.clientHeight && !$('manager-log-older').disabled) $('manager-log-older').click();
  });
  function renderHistory(tasks) {
    const list = $('task-history-list');
    list.replaceChildren();
    if (!tasks?.length) { list.textContent = '暂无任务记录。'; return; }
    const states = { running: '执行中', succeeded: '已完成', failed: '失败', interrupted: '已中断' };
    for (const task of tasks.slice(0, 20)) {
      const row = document.createElement('div'); row.className = 'backup-row';
      const text = document.createElement('span');
      text.textContent = `${timeFormat.dateTime(task.createdAt)} · ${names[task.action] || task.action} · ${states[task.state] || task.state} · ${task.message}`;
      row.append(text); list.append(row);
    }
  }
  async function playerMessage(title, description, confirm, danger) {
    return ask({ title, description, name: '', nameLabel: '理由', namePlaceholder: '可选，例如：违反服务器规则', nameMaxLength: 500, required: false, confirm, danger, symbol: 'user' });
  }
  function playerDetail(details, label, value, { code = false, dateTime } = {}) {
    const item = document.createElement('div');
    const term = document.createElement('dt'); term.textContent = label;
    const description = document.createElement('dd');
    if (code) description.className = 'player-user-id';
    const content = document.createElement(dateTime ? 'time' : 'span'); content.textContent = value;
    if (dateTime) content.dateTime = dateTime;
    description.append(content); item.append(term, description); details.append(item);
  }
  function playerCard(player, banned = false, historical = false) {
    const row = document.createElement('article'); row.className = 'player-row player-card';
    if (player.userId) row.dataset.userId = player.userId;
    const label = player.name || player.accountName || (banned ? '昵称未记录' : '玩家');
    row.setAttribute('aria-label', label);
    const header = document.createElement('div'); header.className = 'player-card-header';
    const avatar = document.createElement('span'); avatar.className = 'player-avatar'; avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = Array.from(label)[0];
    const identity = document.createElement('div'); identity.className = 'player-identity';
    const title = document.createElement('h3'); title.textContent = label; identity.append(title);
    if (!banned && !historical) {
      const level = document.createElement('span'); level.className = 'player-level'; level.textContent = `Lv.${player.level ?? '—'}`; identity.append(level);
    }
    const badge = document.createElement('span'); badge.className = 'player-status'; badge.textContent = banned ? '已封禁' : historical ? player.loginStatus === 'succeeded' ? '登录成功' : '已连接' : '在线';
    if (historical) row.dataset.historical = 'true';
    if (historical) badge.dataset.loginStatus = player.loginStatus;
    row.dataset.banned = String(banned);
    const badges = document.createElement('span'); badges.className = 'player-status-group'; badges.append(badge);
    if (historical && player.banned) {
      const banBadge = document.createElement('span'); banBadge.className = 'player-ban-badge'; banBadge.textContent = '已封禁'; badges.append(banBadge);
    }
    header.append(avatar, identity, badges);
    const details = document.createElement('dl'); details.className = 'player-card-details';
    playerDetail(details, 'UserID', player.userId || 'ID 未提供', { code: true });
    const actions = document.createElement('div'); actions.className = 'player-actions';
    row.append(header, details, actions);
    return { row, details, actions, label };
  }
  function playerEmpty(list, title, description) {
    const empty = document.createElement('div'); empty.className = 'player-empty';
    const icon = document.createElement('span'); icon.className = 'player-empty-icon'; icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg class="icon"><use href="#i-user"/></svg>';
    const heading = document.createElement('h3'); heading.textContent = title;
    const note = document.createElement('p'); note.textContent = description;
    empty.append(icon, heading, note); list.append(empty);
  }
  function players(list) {
    const unavailable = Boolean(lastStatus?.task) || !lastStatus?.running || !lastStatus?.ready;
    const key = JSON.stringify([list, unavailable, Boolean(lastStatus?.running), Boolean(lastStatus?.ready)]);
    if (key === playersRenderKey) return;
    playersRenderKey = key;
    const container = $('manager-players-list'); container.replaceChildren();
    $('online-player-count').textContent = String(list.length);
    $('online-player-note').textContent = !lastStatus?.running ? '启动游戏服务后，可查看在线玩家并发送广播。' : !lastStatus?.ready ? '正在连接游戏管理接口，请稍候…' : '查看在线玩家，可移出玩家或封禁账号；点击顶部刷新状态更新列表。';
    $('announce-message').disabled = unavailable;
    $('manager-announce').querySelector('button').disabled = unavailable;
    if (!list.length) playerEmpty(container,
      !lastStatus?.running ? '游戏服务未运行' : !lastStatus?.ready ? '正在连接玩家列表' : '暂无在线玩家',
      !lastStatus?.running ? '启动游戏服务后，可在这里查看在线玩家。' : !lastStatus?.ready ? '管理接口就绪后，可查看玩家状态。' : '玩家加入服务器后，可点击顶部刷新状态更新列表。');
    for (const player of list) {
      const { row, actions, label } = playerCard(player);
      const disabled = unavailable || !player.userId;
      const kick = document.createElement('button'); kick.className = 'button secondary'; kick.textContent = '移出'; kick.disabled = disabled;
      kick.addEventListener('click', async () => {
        const message = await playerMessage('移出玩家', `将 ${label} 移出游戏服。`, '移出', false);
        if (message === null) return;
        action('kick', { userid: player.userId, message }, false);
      });
      const ban = document.createElement('button'); ban.className = 'button secondary'; ban.textContent = '封禁'; ban.disabled = disabled;
      ban.classList.add('player-ban-action');
      ban.addEventListener('click', async () => {
        const message = await playerMessage('封禁玩家', `封禁 ${label}，该玩家将被移出并无法再次加入。`, '封禁', true);
        if (message === null) return;
        action('ban', { userid: player.userId, name: label, message }, false);
      });
      actions.append(kick, ban);
      container.append(row);
    }
  }
  function renderBans(value) {
    const disabled = !lastStatus?.running || !lastStatus?.ready || Boolean(lastStatus?.task);
    const key = JSON.stringify({ value, disabled });
    if (key === bannedRenderKey) return;
    bannedRenderKey = key;
    $('banned-player-count').textContent = String(value.players.length);
    $('banned-player-note').textContent = value.skipped
      ? `有 ${value.skipped} 条名单记录格式无法识别，已跳过；游戏服务运行后可按 UserID 解封已识别记录。`
      : disabled ? '本服封禁名单，游戏服务就绪且无任务执行时可解封。' : '解封后允许玩家重新加入服务器。';
    const list = $('manager-banned-list');
    list.replaceChildren();
    if (!value.players.length) playerEmpty(list, '暂无已封禁玩家', '封禁的账号会保留在这里，解封后可重新加入服务器。');
    for (const player of value.players) {
      const { row, details, actions } = playerCard(player, true);
      playerDetail(details, '封禁理由', player.reason || '未记录');
      if (player.bannedAt) playerDetail(details, '封禁时间', timeFormat.dateTime(player.bannedAt), { dateTime: player.bannedAt });
      const button = document.createElement('button'); button.className = 'button secondary'; button.textContent = '解封'; button.disabled = disabled;
      button.addEventListener('click', async () => {
        const confirmed = await ask({ title: '解封玩家？', description: `允许 ${player.name || player.userId} 重新加入服务器。`, confirm: '解封', symbol: 'user' });
        if (confirmed) await action('unban', { userid: player.userId }, false);
      });
      actions.append(button); list.append(row);
    }
  }
  function renderPlayerHistory(value) {
    const disabled = !lastStatus?.running || !lastStatus?.ready || Boolean(lastStatus?.task);
    const key = JSON.stringify([value, disabled, playerHistoryQuery]);
    if (key === playerHistoryRenderKey) return;
    playerHistoryRenderKey = key;
    $('history-player-count').textContent = String(value.recorded);
    $('clear-player-history').disabled = clearingPlayerHistory || restoringPlayerHistory || !value.recorded;
    $('restore-player-history').disabled = clearingPlayerHistory || restoringPlayerHistory;
    $('player-history-note').textContent = value.error || '从游戏连接日志记录昵称、UserID 和 IP；收到成功登录日志后更新状态，按 UserID 合并。';
    $('player-history-summary').textContent = playerHistoryQuery ? `找到 ${value.total} 位玩家 · 已记录 ${value.recorded} 位` : `共记录 ${value.recorded} 位玩家 · 最近连接优先`;
    const list = $('player-history-list'); list.replaceChildren();
    if (!value.players.length) playerEmpty(list,
      playerHistoryQuery ? '没有匹配的玩家' : '暂无玩家连接记录',
      playerHistoryQuery ? '可尝试其他昵称、UserID 或 IP。' : '收到游戏连接日志后会显示在这里；重启时也会读取保留的游戏日志。');
    for (const player of value.players) {
      const { row, details, actions, label } = playerCard(player, false, true);
      playerDetail(details, '最近 IP', player.ip || '未记录', { code: true });
      playerDetail(details, '首次连接', timeFormat.dateTime(player.firstSeenAt), { dateTime: player.firstSeenAt });
      playerDetail(details, '最近连接', timeFormat.dateTime(player.lastSeenAt), { dateTime: player.lastSeenAt });
      if (player.lastLoginAt) playerDetail(details, '最近登录', timeFormat.dateTime(player.lastLoginAt), { dateTime: player.lastLoginAt });
      const ban = document.createElement('button'); ban.className = 'button secondary player-ban-action';
      ban.textContent = player.banned ? '已封禁' : '封禁'; ban.disabled = disabled || player.banned;
      if (disabled) ban.title = '游戏服务就绪且没有任务执行时可封禁，玩家无需在线';
      ban.addEventListener('click', async () => {
        const message = await playerMessage('封禁历史玩家', `封禁 ${label}（${player.userId}），该账号将无法再次加入服务器。`, '封禁', true);
        if (message !== null) await action('ban', { userid: player.userId, name: label, message }, false);
      });
      actions.append(ban); list.append(row);
    }
    const pagination = $('player-history-pagination'); pagination.replaceChildren(); pagination.hidden = value.pageCount <= 1;
    if (value.pageCount > 1) {
      const status = document.createElement('span'); status.className = 'page-status'; status.textContent = `第 ${value.page} / ${value.pageCount} 页`;
      const previous = document.createElement('button'); previous.type = 'button'; previous.className = 'button secondary'; previous.textContent = '上一页'; previous.disabled = value.page <= 1;
      previous.addEventListener('click', () => { playerHistoryPage = value.page - 1; void loadPlayerHistory(); });
      const next = document.createElement('button'); next.type = 'button'; next.className = 'button secondary'; next.textContent = '下一页'; next.disabled = value.page >= value.pageCount;
      next.addEventListener('click', () => { playerHistoryPage = value.page + 1; void loadPlayerHistory(); });
      pagination.append(status, previous, next);
    }
  }
  async function loadPlayerHistory() {
    const request = ++playerHistoryRequest;
    $('player-history-list').setAttribute('aria-busy', 'true');
    try {
      const value = await api.request(`player-history?query=${encodeURIComponent(playerHistoryQuery)}&page=${playerHistoryPage}`);
      if (request !== playerHistoryRequest || stopped) return;
      playerHistoryPage = value.page; playerHistoryCache = value; renderPlayerHistory(value);
    } catch (caught) {
      if (request !== playerHistoryRequest) return;
      playerHistoryRenderKey = null;
      $('player-history-summary').textContent = '玩家历史暂不可用，请刷新重试。';
      error(caught.message);
    } finally {
      if (request === playerHistoryRequest) $('player-history-list').setAttribute('aria-busy', 'false');
    }
  }
  async function loadBans() {
    if (loadingBans) return;
    loadingBans = true;
    try {
      const value = await api.request('banned-players');
      lastBanError = '';
      bannedCache = value;
      renderBans(value);
    } catch (caught) {
      const message = `无法读取封禁名单：${caught.message}`;
      if (message !== lastBanError) { lastBanError = message; notify(message, true); }
      if (!bannedCache) { $('banned-player-count').textContent = '—'; $('manager-banned-list').textContent = '封禁名单暂不可用'; }
    } finally { loadingBans = false; }
  }
  function currentScope() {
    if (!$('game-page').hidden) {
      if (!$('game-overview').hidden) return 'overview';
      if (!$('game-players-view').hidden) return 'players';
    }
    return 'local';
  }
  function renderStatus(snapshot) {
    if (retiredStatusInstances.has(snapshot.stateInstance)) return false;
    const sameInstance = snapshot.stateInstance === lastStatus?.stateInstance;
    if (sameInstance && snapshot.stateRevision < (lastStatus?.stateRevision ?? -1)) return false;
    if (!sameInstance && lastStatus) retiredStatusInstances.add(lastStatus.stateInstance);
    const sameGame = sameInstance && snapshot.running && lastStatus?.running && snapshot.startedAt === lastStatus.startedAt;
    const value = { info: null, metrics: null, players: [], ...(sameGame ? lastStatus : {}), ...snapshot };
    onWorkspaceChanged?.(value.revision); lastStatus = value; lastErrorMessage = '';
    const game = $('game-state');
    const serviceState = gameServiceState(value);
    game.textContent = serviceState.label;
    game.dataset.state = serviceState.state;
    game.title = serviceState.description;
    game.setAttribute('aria-label', `${serviceState.label}。${serviceState.description}`);
    const config = $('game-config-state');
    config.textContent = value.hasConfiguration === false ? '暂无配置' : value.configuration === 'pending' ? '待生效' : value.running && value.ready ? '已生效' : '已写入';
    config.dataset.state = value.configuration === 'pending' ? 'pending' : value.running && value.ready ? 'saved' : 'written';
    config.title = value.hasConfiguration === false ? '请先安装服务端或手动新建配置。' : value.configuration === 'pending' ? '当前面板配置尚未应用到游戏，点击应用配置后生效。'
      : value.running && value.ready ? '游戏服务已使用当前配置运行。'
      : value.running ? '配置已写入，正在等待游戏管理接口就绪。'
      : '配置已写入游戏文件，启动服务器后生效。';
    config.setAttribute('aria-label', `游戏配置：${config.textContent}。${config.title}`);
    $('game-version').textContent = value.version || value.info?.version || (value.installed ? '启动后获取' : '未安装');
    $('game-build').textContent = value.installedBuild || '—';
    $('game-build-meta').hidden = !value.installedBuild;
    $('game-players').textContent = value.metrics ? `${value.metrics.currentplayernum} / ${value.metrics.maxplayernum}` : '—';
    $('game-fps').textContent = value.metrics?.serverfps ?? '—';
    $('game-uptime').textContent = uptimeLabel(value.metrics?.uptime);
    $('game-port').textContent = value.port;
    for (const button of actionButtons) {
      const name = button.dataset.action;
      if (name === 'install') button.hidden = value.installed;
      if (name === 'start') button.hidden = !value.installed || value.running;
      if (name === 'stop' || name === 'restart') button.hidden = !value.running;
      button.disabled = Boolean(value.task) || (name === 'install' && value.installed) || (['start', 'update', 'restart', 'import-save'].includes(name) && !value.installed) || (['start', 'update'].includes(name) && value.running) || (['stop', 'force-stop', 'restart', 'save-world'].includes(name) && !value.running);
      if (name === 'reset-save') button.disabled ||= value.running;
      if (name === 'backup') {
        const noSave = !value.hasWorldSave;
        button.disabled ||= value.running || noSave;
        button.title = value.running ? '请先停止游戏服再创建完整备份。' : noSave ? '尚无可备份的世界存档，请先启动游戏并生成存档。' : '';
      }
      if (name === 'apply') { button.textContent = value.running ? '应用并重启' : '应用配置'; button.disabled ||= value.hasConfiguration === false; }
    }
    $('show-running-config').disabled = !value.running;
    $('check-update').disabled = checkingUpdate || !value.installed || Boolean(value.task);
    $('complete-backup-status').textContent = !value.hasWorldSave && !value.running
      ? '尚无可备份的世界存档，请先启动游戏并生成存档。已有备份仍可下载或恢复。'
      : value.running ? '游戏正在运行，请先停止游戏服务，再创建手动备份。' : '游戏已停止，可以创建手动备份；完成后保持停服。';
    const playerActionDisabled = Boolean(value.task) || !value.running || !value.ready;
    $('ban-player').disabled = playerActionDisabled;
    $('unban-player').disabled = playerActionDisabled;
    if (bannedCache) renderBans(bannedCache);
    if (playerHistoryCache) renderPlayerHistory(playerHistoryCache);
    renderHistory(value.tasks);
    const task = value.task || value.tasks[0];
    if (task) {
      trackTask(task);
      if (['failed', 'interrupted'].includes(task.state) && task.id !== lastTask) error(task.message);
      if (task.state !== 'running') lastTask = task.id;
    }
    players(value.players);
    return true;
  }
  function stopStatus() {
    statusGeneration++;
    closeStatus?.(); closeStatus = null;
  }
  function showConnectionError(caught) {
    const expired = caught.status === 401;
    const game = $('game-state');
    game.textContent = expired ? '需登录' : '连接失败';
    game.dataset.state = 'error';
    game.title = caught.message;
    game.setAttribute('aria-label', `${game.textContent}。${caught.message}`);
    actionButtons.forEach(button => { button.disabled = true; });
    if (expired) {
      stopped = true; stopStatus(); stopLogs();
      $('refresh-status').disabled = true;
    }
  }
  function syncStatus() {
    if (stopped || !pageActive || document.hidden) { stopStatus(); return; }
    if (closeStatus) return;
    const generation = ++statusGeneration;
    closeStatus = api.watchStatus({
      onStatus(value) {
        if (generation !== statusGeneration) return;
        const historyChanged = lastStatus && value.playerHistoryRevision !== lastStatus.playerHistoryRevision;
        const task = value.tasks?.[0];
        const completed = task && task.state !== 'running' && (task.id === activeTaskId || (lastStatus && task.id !== lastStatus.tasks?.[0]?.id));
        if (renderStatus(value)) {
          if (completed) void refresh();
          else if (historyChanged && currentScope() === 'players') void loadPlayerHistory();
        }
      },
      onError(caught) {
        if (generation !== statusGeneration) return;
        showConnectionError(caught);
        if (caught.status === 401) error(caught.message);
      }
    });
  }
  async function refresh(options = {}) {
    syncLogs(); syncStatus();
    if (stopped || !pageActive || document.hidden) return;
    const scope = options.scope || currentScope();
    if (refreshing) { pendingRefresh = { scope }; return; }
    refreshing = true;
    $('refresh-status').disabled = true;
    let statusReceived = false;
    try {
      if (scope === 'players') void loadBans();
      const value = await api.request(`status?scope=${scope}`);
      renderStatus(value);
      statusReceived = true;
      if (scope === 'players') await loadPlayerHistory();
      const savesVisible = !$('saves-page').hidden;
      const archivesVisible = savesVisible && !$('saves-archives').hidden;
      const nativeVisible = savesVisible && !$('saves-native').hidden;
      await loadSettings();
      if (archivesVisible) await loadBackups();
      if (nativeVisible) await loadNativeBackups();
    } catch (caught) {
      error(caught.message);
      actionButtons.forEach(button => { button.disabled = true; });
      if (!statusReceived || caught.status === 401) showConnectionError(caught);
    } finally {
      refreshing = false;
      $('refresh-status').disabled = stopped;
      if (pendingRefresh) { const next = pendingRefresh; pendingRefresh = null; void refresh(next); }
    }
  }
  for (const button of $('manager-log-channel').querySelectorAll('button')) button.addEventListener('click', () => {
    if (logChannel === button.dataset.logChannel) return;
    logChannel = button.dataset.logChannel;
    for (const option of $('manager-log-channel').querySelectorAll('button')) {
      const selected = option === button;
      option.classList.toggle('selected', selected);
      option.setAttribute('aria-pressed', String(selected));
    }
    $('manager-logs').textContent = '正在读取日志…';
    syncLogs();
  });
  function loadSettings() {
    settingsRequest ??= api.request('settings').then(settings => {
      $('auto-start').checked = Boolean(settings.autoStart);
      $('auto-start').disabled = false;
      settingsCache = settings;
      $('edit-game-args').disabled = false;
      $('edit-install-args').disabled = false;
      $('edit-shutdown-wait').disabled = false;
      return settings;
    }).catch(caught => { settingsRequest = null; throw caught; });
    return settingsRequest;
  }
  let updatePopupTimer;
  function showUpdateStatus(message, { error = false } = {}) {
    const popup = $('update-popup');
    clearTimeout(updatePopupTimer);
    popup.textContent = message;
    popup.classList.toggle('error', error);
    popup.hidden = false;
    $('check-update').title = message;
    updatePopupTimer = setTimeout(() => { popup.hidden = true; }, error ? 8000 : 6000);
  }
  $('check-update').addEventListener('click', async () => {
    if (checkingUpdate) return;
    checkingUpdate = true;
    showUpdateStatus('正在检查 Steam 最新版本…');
    $('check-update').disabled = true;
    try {
      // SteamCMD may need longer than the default API timeout.
      const value = await api.request('update-check', { timeout: 150000 });
      if (!value.installed) showUpdateStatus('服务端尚未安装。');
      else if (value.error) showUpdateStatus(`更新检查失败：${value.error}`, { error: true });
      else if (value.updateAvailable) showUpdateStatus(`发现新版本：已安装 build ${value.installedBuild}，Steam 最新 build ${value.latestBuild}。可在停服后点击「更新服务端」。`);
      else showUpdateStatus(`已是最新版本（build ${value.installedBuild}）。`);
    } catch (caught) { showUpdateStatus(`更新检查失败：${caught.message}`, { error: true }); }
    finally {
      checkingUpdate = false;
      $('check-update').disabled = !lastStatus?.installed || Boolean(lastStatus?.task);
    }
  });
  $('auto-start').addEventListener('change', async event => {
    const control = event.currentTarget;
    const checked = control.checked;
    control.disabled = true;
    try {
      settingsCache = await api.request('settings', { method: 'PUT', body: { autoStart: checked } });
      notify(checked ? '已启用自动启动：面板或容器重启后将启动游戏服务' : '已关闭自动启动');
    } catch (caught) {
      control.checked = !checked;
      error(caught.message);
    } finally { control.disabled = false; }
  });
  $('manager-announce').addEventListener('submit', event => { event.preventDefault(); action('announce', { message: $('announce-message').value }, false); });
  function searchPlayerHistory() {
    clearTimeout(playerHistorySearchTimer);
    playerHistoryQuery = $('player-history-query').value.trim(); playerHistoryPage = 1;
    void loadPlayerHistory();
  }
  $('player-history-search').addEventListener('submit', event => { event.preventDefault(); searchPlayerHistory(); });
  $('player-history-query').addEventListener('input', () => {
    clearTimeout(playerHistorySearchTimer);
    playerHistorySearchTimer = setTimeout(searchPlayerHistory, 300);
  });
  $('clear-player-history').addEventListener('click', async () => {
    const confirmed = await ask({ title: '清理全部玩家登录历史？', description: '将删除所有已记录的玩家昵称、UserID、IP 和连接时间，包括当前搜索条件外的记录。游戏存档、封禁名单与原始游戏日志保留；清理后只记录新发生的事件，旧日志不会重新导入。', confirm: '清理历史', danger: true, symbol: 'trash' });
    if (!confirmed) return;
    clearingPlayerHistory = true; $('clear-player-history').disabled = true; $('restore-player-history').disabled = true;
    try {
      await api.request('player-history', { method: 'DELETE' });
      clearTimeout(playerHistorySearchTimer); playerHistoryQuery = ''; playerHistoryPage = 1; $('player-history-query').value = '';
      await loadPlayerHistory(); notify('玩家登录历史已清理');
    } catch (caught) { error(caught.message); }
    finally {
      clearingPlayerHistory = false; playerHistoryRenderKey = null;
      if (playerHistoryCache) renderPlayerHistory(playerHistoryCache);
    }
  });
  $('restore-player-history').addEventListener('click', async () => {
    if (clearingPlayerHistory || restoringPlayerHistory) return;
    restoringPlayerHistory = true;
    $('clear-player-history').disabled = true; $('restore-player-history').disabled = true;
    $('restore-player-history-label').textContent = '恢复中…';
    try {
      const result = await api.request('player-history/restore', { method: 'POST' });
      clearTimeout(playerHistorySearchTimer); playerHistoryQuery = ''; playerHistoryPage = 1; $('player-history-query').value = '';
      await loadPlayerHistory();
      notify(result.restored ? `已恢复 ${result.restored} 位历史玩家，当前共 ${result.recorded} 位` : '恢复完成，没有新增历史玩家；仅能恢复保留的游戏日志中的记录。');
    } catch (caught) { error(caught.message); }
    finally {
      restoringPlayerHistory = false; playerHistoryRenderKey = null;
      $('restore-player-history-label').textContent = '恢复历史';
      if (playerHistoryCache) renderPlayerHistory(playerHistoryCache);
    }
  });
  $('ban-player').addEventListener('click', async () => {
    const userid = await ask({ title: '按 ID 封禁玩家', description: '输入要封禁的玩家 UserID（通常以 steam_ 开头）；可直接粘贴 banlist.txt 中的整行，面板会取逗号前的 ID。默认理由为“管理员已将你封禁”。', name: '', nameLabel: '玩家 UserID', namePlaceholder: 'steam_...', nameMaxLength: 200, required: true, confirm: '封禁', symbol: 'user' });
    if (userid === null) return;
    action('ban', { userid, name: '', message: '' }, false);
  });
  $('unban-player').addEventListener('click', async () => {
    const userid = await ask({ title: '解封玩家', description: '输入要解封的玩家 UserID（通常以 steam_ 开头）。', name: '', nameLabel: '玩家 UserID', namePlaceholder: 'steam_...', nameMaxLength: 200, required: true, confirm: '解封', symbol: 'user' });
    if (userid === null) return;
    action('unban', { userid }, false);
  });
  $('refresh-status').addEventListener('click', () => { void refresh(); });
  document.addEventListener('visibilitychange', () => { void refresh(); });
  window.addEventListener('hashchange', () => { void refresh(); });
  window.addEventListener('pagehide', () => { pageActive = false; clearTimeout(playerHistorySearchTimer); stopLogs(); stopStatus(); });
  window.addEventListener('pageshow', event => { if (event.persisted) { pageActive = true; void refresh(); } });
  refresh();
  return { refresh };
}
