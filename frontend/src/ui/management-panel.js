import { createArgsDialog } from './args-dialog.js';
import { createSaveImportDialog } from './save-import-dialog.js';

function uptimeLabel(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const minutes = Math.max(0, Math.floor(seconds / 60));
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时${minutes % 60 ? `${minutes % 60}分` : ''}`;
  return `${Math.floor(hours / 24)}天${hours % 24 ? `${hours % 24}小时` : ''}`;
}

export function createManagementPanel({ dom, api, ask, notify, getConfiguration, onDefaultsImported }) {
  const { $, document } = dom;
  const section = document.createElement('section');
  section.className = 'management-panel';
  section.setAttribute('aria-label', '帕鲁服务管理');
  section.id = 'server-service';
  section.innerHTML = `
    <div class="management-heading server-heading"><div><h2>游戏服务 <span id="game-state" class="save-status" data-state="pending">连接中</span></h2><p id="server-state-note" class="management-note">正在获取服务器状态…</p></div><div class="management-actions server-heading-actions"><button type="button" id="show-task-history" class="button secondary" aria-haspopup="dialog" aria-controls="task-history">任务记录</button><a class="button secondary" href="#configuration">管理配置 →</a></div></div>
    <div class="management-feedback"><div id="management-error" class="alert error" role="alert" hidden></div><p id="management-task" class="management-task" role="status" hidden></p></div>
    <div class="server-controls">
      <div class="management-actions server-primary-actions">
        <button class="button primary" data-action="install" hidden>安装服务端</button><button class="button primary" data-action="start">启动</button><button class="button secondary" data-action="stop" hidden>停止</button><button class="button secondary" data-action="restart" hidden>重启</button>
        <button class="button secondary" id="check-update" disabled>检查更新</button><button class="button secondary" data-action="update" title="更新前会自动备份，运行中的游戏服务将短暂停服。">更新服务端</button><button class="button secondary" id="edit-game-args" disabled>启动参数</button><button class="button secondary" id="edit-install-args" disabled>安装参数</button><button class="button secondary" data-action="force-stop" title="仅在正常停止无效时使用，可能丢失最近一次未保存的进度。">强制停止</button>
      </div>
    </div>
    <p id="update-status" class="management-note" role="status" hidden></p>
    <dl class="management-metrics" aria-label="服务器运行信息">
      <div class="server-metric"><dt>游戏版本</dt><dd id="game-version" class="metric-value metric-text">读取中</dd><dd id="game-build-meta" class="server-metric-note" hidden>Steam Build <span id="game-build">—</span></dd></div>
      <div class="server-metric"><dt>在线玩家</dt><dd id="game-players" class="metric-value">—</dd></div>
      <div class="server-metric"><dt>服务器 FPS</dt><dd id="game-fps" class="metric-value">—</dd></div>
      <div class="server-metric"><dt>游戏端口</dt><dd class="metric-value"><span id="game-port">8211</span><span class="metric-unit">UDP</span></dd></div>
      <div class="server-metric"><dt>运行时间</dt><dd id="game-uptime" class="metric-value">—</dd></div>
    </dl>`;
  $('game-overview').append(section);
  const logs = document.createElement('section');
  logs.id = 'game-logs';
  logs.className = 'management-panel';
  logs.setAttribute('aria-label', '运行日志');
  logs.innerHTML = `<div class="management-heading log-heading"><h2>运行日志</h2><div class="segmented log-type-buttons" id="manager-log-channel" role="group" aria-label="日志类型"><button type="button" class="selected" data-log-channel="all" aria-pressed="true">全部日志</button><button type="button" data-log-channel="game" aria-pressed="false">游戏日志</button><button type="button" data-log-channel="steamcmd" aria-pressed="false">安装与更新</button><button type="button" data-log-channel="palbox" aria-pressed="false">面板日志</button></div></div><p id="manager-log-status" class="management-note" role="status">正在连接实时日志…</p><pre id="manager-logs" tabindex="0">正在读取日志…</pre>`;
  $('game-overview').append(logs);
  const history = document.createElement('dialog');
  history.id = 'task-history';
  history.className = 'task-history-dialog';
  history.setAttribute('aria-labelledby', 'task-history-title');
  history.innerHTML = '<div class="management-heading"><h2 id="task-history-title">任务记录</h2><button type="button" id="close-task-history" class="icon-button" aria-label="关闭任务记录"><svg class="icon" aria-hidden="true"><use href="#i-close"/></svg></button></div><div id="task-history-list">暂无任务记录。</div>';
  document.body.append(history);
  $('show-task-history').addEventListener('click', () => history.showModal());
  $('close-task-history').addEventListener('click', () => history.close());
  const playerPanel = document.createElement('section');
  playerPanel.className = 'management-panel';
  playerPanel.setAttribute('aria-label', '在线玩家与广播');
  playerPanel.innerHTML = `<div class="management-heading"><h2>在线玩家 <span id="online-player-count" class="subtle-tag">—</span></h2></div><form id="manager-announce"><label class="sr-only" for="announce-message">广播内容</label><input id="announce-message" maxlength="500" required placeholder="向在线玩家发送公告…"><button class="button secondary" type="submit">发送广播</button></form><div id="manager-players-list">游戏服尚未连接</div>`;
  const bannedPanel = document.createElement('section');
  bannedPanel.id = 'banned-management';
  bannedPanel.className = 'management-panel';
  bannedPanel.setAttribute('aria-label', '已封禁玩家');
  bannedPanel.innerHTML = `<div class="management-heading"><h2>已封禁玩家 <span id="banned-player-count" class="subtle-tag">—</span></h2><div class="management-actions"><button class="button secondary" id="ban-player" disabled>按 ID 封禁</button><button class="button secondary" id="unban-player" disabled>按 ID 解封</button></div></div><p id="banned-player-note" class="management-note">本服封禁名单，游戏服务运行后可封禁或解封。</p><div id="banned-player-error" class="alert error" role="status" hidden></div><div id="manager-banned-list">正在读取封禁名单…</div>`;
  $('game-players-view').append(playerPanel, bannedPanel);
  const saves = document.createElement('section');
  saves.id = 'save-management';
  saves.className = 'management-panel save-management';
  saves.setAttribute('aria-labelledby', 'save-management-title');
  saves.innerHTML = `
    <div class="management-heading"><div><h2 id="save-management-title">存档管理</h2><p class="management-note">官方自动备份与手动完整备份分开管理。</p></div><div class="management-actions"><button class="button secondary" data-action="import-save" disabled><svg class="icon" aria-hidden="true"><use href="#i-upload"/></svg>导入存档</button><button class="button secondary" data-action="backup" disabled>创建完整备份</button><button class="button primary" data-action="save-world" disabled>保存世界</button></div></div>
    <div class="save-backup-plan"><div class="management-heading"><h3>官方自动备份 <span id="native-backup-state" class="save-status" data-state="pending">读取中</span></h3><a class="button secondary" href="#configuration">管理备份配置 →</a></div><p class="management-note">由游戏在运行中生成，无需停服。保留档位：30 秒 5 份、10 分钟 6 份、1 小时 12 份、1 天 7 份。修改「自动备份世界」后需应用配置。</p><p id="native-backup-note" class="management-note"></p><div class="save-backup-heading"><h3>官方存档备份</h3><span id="native-backup-summary" role="status">正在读取…</span></div><div id="native-backups">正在读取官方备份…</div></div>
    <div class="save-backup-heading"><h3>完整备份归档</h3><span id="save-backup-summary" role="status">正在读取…</span></div><p id="complete-backup-note" class="management-note">包含世界、玩家存档和游戏配置。手动创建完整备份时会先存档并停服，完成后重新启动；恢复任何备份前都会先备份当前数据。</p>
    <form id="backup-settings"><label>每类完整备份保留数量<input id="backup-retention" disabled type="number" min="1" max="100" required></label><button class="button secondary" type="submit" disabled>保存设置</button></form>
    <div id="manager-backups">正在读取完整备份…</div>`;
  $('game-saves').append(saves);
  const configurationApply = $('configuration-apply');
  const logout = document.createElement('button');
  logout.id = 'manager-logout'; logout.className = 'button secondary'; logout.type = 'button';
  logout.setAttribute('aria-label', '退出登录'); logout.title = '退出当前登录';
  logout.append(dom.icon('logout'), document.createTextNode('退出'));
  document.querySelector('.topbar-session').append(logout);
  document.querySelector('.bottom-note > span:last-child').textContent = '配置自动保存 · 应用后在游戏中生效';
  const actionButtons = [...section.querySelectorAll('[data-action]'), ...saves.querySelectorAll('[data-action]'), ...configurationApply.querySelectorAll('[data-action]')];
  actionButtons.forEach(button => { button.disabled = true; });
  const names = { install: '安装服务端', start: '启动', stop: '停止', 'force-stop': '强制停止', restart: '重启', update: '更新服务端', apply: '应用配置', backup: '创建备份', 'delete-backup': '删除备份', restore: '恢复备份', 'restore-native': '恢复官方备份', 'import-save': '导入存档', 'save-world': '保存世界', announce: '发送广播', kick: '移出玩家', ban: '封禁玩家', unban: '解封玩家' };
  let polling = false;
  let stopped = false;
  let lastTask;
  let activeTaskId;
  let taskHideTimer;
  let lastStatus;
  let settingsRequest = null;
  let settingsCache = null;
  let checkingUpdate = false;
  let loadingBans = false;
  let bannedCache = null;
  let bannedRenderKey = '';
  let logChannel = 'all';
  let logGeneration = 0;
  let closeLogs = null;
  let activeLogChannel = null;
  let pageActive = true;
  function overviewVisible() { return !$('game-page').hidden && !$('game-overview').hidden; }
  function error(message) {
    const changed = $('management-error').textContent !== message;
    $('management-error').textContent = message;
    $('management-error').hidden = !message;
    if (message && changed && !overviewVisible()) notify(message, true);
  }
  function showTask(task, submitted = false) {
    const running = task.state === 'running';
    const completed = !running && activeTaskId === task.id;
    // Historical tasks from /api/status must not keep the status line visible;
    // only show a task that is running, was just submitted, or just completed.
    if (!running && !completed && !submitted) return;
    const label = names[task.action] || task.action;
    const state = { running: '执行中', succeeded: '已完成', failed: '失败', interrupted: '已中断' }[task.state] || task.state;
    const message = running ? `${label}：${task.message}` : `${label} · ${state}`;
    clearTimeout(taskHideTimer);
    taskHideTimer = null;
    $('management-task').textContent = message;
    if (running) {
      activeTaskId = task.id;
      $('management-task').hidden = false;
    } else if (task.state === 'succeeded') {
      // 正常完成不占用状态栏：服务状态、按钮和任务记录已反映结果。
      $('management-task').hidden = true;
    } else {
      $('management-task').hidden = false;
      taskHideTimer = setTimeout(() => {
        $('management-task').hidden = true;
        taskHideTimer = null;
      }, 6000);
    }
    if ((submitted || completed) && !overviewVisible() && task.state !== 'failed') notify(message, task.state === 'interrupted');
    if (completed) {
      activeTaskId = null;
      if (task.defaultsImported && task.state === 'succeeded') onDefaultsImported?.();
    }
  }
  async function action(name, payload = {}, confirm = true) {
    if (confirm && ['stop', 'force-stop', 'restart', 'update', 'apply', 'backup', 'restore', 'restore-native', 'kick'].includes(name)) {
      const descriptions = {
        apply: '将当前配置写入游戏。游戏服正在运行时会先存档、停服、备份，再应用并重启。',
        backup: '备份完整存档和配置。游戏服正在运行时会短暂停服，完成后重新启动。',
        restore: '用这份完整备份恢复游戏配置和世界存档。当前存档会先备份，面板中的配置预设保持不变。',
        'restore-native': '将当前世界和玩家存档恢复到所选官方备份。会先存档、停服并创建完整备份，保留当前配置及官方备份历史；原先运行的游戏服会重新启动。',
        update: '先保存世界、停服并备份，再用 SteamCMD 更新。更新完成后恢复原来的运行状态。',
        stop: '保存世界后停止游戏服，管理面板继续运行。',
        'force-stop': '立即强制停止游戏服，可能丢失最近一次未保存的进度。仅在正常停止失败时使用。',
        restart: '保存世界并重启游戏服。', kick: '将选中的玩家移出游戏服。'
      };
      if (!(await ask({ title: `${names[name]}？`, description: descriptions[name], confirm: names[name], danger: ['restore', 'restore-native', 'kick', 'force-stop'].includes(name), symbol: 'server' }))) return;
    }
    try {
      if (name === 'apply') payload = { ...payload, ...await getConfiguration() };
      error('');
      const task = await api.request('tasks', { method: 'POST', body: { action: name, ...payload } });
      showTask(task, true);
      await refresh();
    } catch (caught) { error(caught.message); }
  }
  const gameArgsDialog = createArgsDialog({ dom, prefix: 'game-args', onSave: async gameArgs => {
    const saved = await api.request('settings', { method: 'PUT', body: { gameArgs } });
    settingsCache = saved;
    notify('启动参数已保存，将在下次启动或重启游戏服时生效');
  } });
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
    showTask(task, true);
    await refresh();
  } });
  for (const button of actionButtons) button.addEventListener('click', () => button.dataset.action === 'import-save' ? saveImport.open() : action(button.dataset.action));
  async function loadBackups() {
    const backups = await api.request('backups');
    $('save-backup-summary').textContent = `${backups.length} 份 · ${(backups.reduce((total, backup) => total + backup.bytes, 0) / 1024 / 1024).toFixed(1)} MB`;
    $('manager-backups').replaceChildren();
    if (!backups.length) $('manager-backups').textContent = '暂无完整备份。手动创建后，可在这里下载或恢复。';
    for (const backup of backups) {
      const row = document.createElement('div'); row.className = 'backup-row'; row.dataset.backupId = backup.id;
      const label = document.createElement('span');
      const category = { manual: '手动', scheduled: '旧定时归档', 'before-update': '更新前' }[backup.category];
      label.textContent = `${new Date(backup.createdAt).toLocaleString()} · ${category} · ${(backup.bytes / 1024 / 1024).toFixed(1)} MB`;
      const download = document.createElement('a'); download.className = 'button secondary'; download.textContent = '下载'; download.href = `/api/backup?id=${encodeURIComponent(backup.id)}`; download.setAttribute('download', '');
      const restore = document.createElement('button'); restore.className = 'button secondary'; restore.textContent = '恢复'; restore.disabled = Boolean(lastStatus?.task); restore.addEventListener('click', () => action('restore', { id: backup.id }));
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button secondary danger-hover'; remove.textContent = '删除'; remove.disabled = Boolean(lastStatus?.task);
      remove.addEventListener('click', async () => {
        const confirmed = await ask({ title: '删除这份完整备份？', description: `${new Date(backup.createdAt).toLocaleString()} · ${category} · ${(backup.bytes / 1024 / 1024).toFixed(1)} MB。确认后永久删除这份归档，无法撤销。当前游戏存档保持不变。`, confirm: '删除备份', danger: true, symbol: 'trash' });
        if (confirmed) await action('delete-backup', { id: backup.id }, false);
      });
      row.append(label, download, restore, remove); $('manager-backups').append(row);
    }
  }
  async function loadNativeBackups() {
    const value = await api.request('native-backups');
    const badge = $('native-backup-state');
    badge.textContent = value.enabled === null ? '尚未配置' : value.enabled ? '已启用' : '未启用';
    badge.dataset.state = value.enabled ? 'saved' : 'pending';
    $('native-backup-note').textContent = value.enabled === false ? '当前游戏配置未启用官方自动备份，可前往配置管理开启。' : value.activeWorld ? `当前世界：${value.activeWorld}。下载无需停服，恢复需要停服。` : '世界尚未生成或无法确认当前世界；可下载已有备份，暂不允许恢复。';
    $('native-backup-summary').textContent = `${value.backups.length} 份`;
    $('native-backups').replaceChildren();
    if (!value.backups.length) $('native-backups').textContent = '暂无完整的官方备份。游戏生成备份后会自动显示；正在写入或已轮换的备份可能暂不可用。';
    for (const backup of value.backups) {
      const row = document.createElement('div'); row.className = 'backup-row';
      const label = document.createElement('span');
      label.textContent = `${backup.timestamp} · 世界 ${backup.worldId} · ${(backup.bytes / 1024 / 1024).toFixed(1)} MB`;
      const download = document.createElement('a'); download.className = 'button secondary'; download.textContent = '下载'; download.href = `/api/native-backup?id=${encodeURIComponent(backup.id)}`; download.setAttribute('download', '');
      const restore = document.createElement('button'); restore.className = 'button secondary'; restore.textContent = '恢复'; restore.disabled = Boolean(lastStatus?.task) || !backup.canRestore;
      if (!backup.canRestore) restore.title = '只能恢复已确认的当前世界备份';
      restore.addEventListener('click', () => action('restore-native', { id: backup.id }));
      row.append(label, download, restore); $('native-backups').append(row);
    }
  }
  function renderLogs(text) {
    const panel = $('manager-logs');
    const content = text || '暂无日志';
    if (panel.textContent === content) return;
    const bottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 30;
    const scrollTop = panel.scrollTop;
    panel.textContent = content;
    if (bottom) panel.scrollTop = panel.scrollHeight;
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
    closeLogs = api.watchLogs(logChannel, {
      onOpen() {
        if (generation === logGeneration) $('manager-log-status').textContent = '日志实时更新，断线后自动重连；向上滚动可查看历史。';
      },
      onLog(text) { if (generation === logGeneration) renderLogs(text); },
      onError(caught) {
        if (generation !== logGeneration) return;
        $('manager-log-status').textContent = caught.message;
        if (caught.status === 401) { stopped = true; stopLogs(); }
      }
    });
  }
  function renderHistory(tasks) {
    const list = $('task-history-list');
    list.replaceChildren();
    if (!tasks?.length) { list.textContent = '暂无任务记录。'; return; }
    const states = { running: '执行中', succeeded: '已完成', failed: '失败', interrupted: '已中断' };
    for (const task of tasks.slice(0, 20)) {
      const row = document.createElement('div'); row.className = 'backup-row';
      const text = document.createElement('span');
      text.textContent = `${new Date(task.createdAt).toLocaleString()} · ${names[task.action] || task.action} · ${states[task.state] || task.state} · ${task.message}`;
      row.append(text); list.append(row);
    }
  }
  async function playerMessage(title, description, confirm, danger) {
    return ask({ title, description, name: '', nameLabel: '理由', namePlaceholder: '可选，例如：违反服务器规则', nameMaxLength: 500, required: false, confirm, danger, symbol: 'user' });
  }
  function players(list) {
    $('manager-players-list').replaceChildren();
    $('online-player-count').textContent = String(list.length);
    if (!list.length) $('manager-players-list').textContent = lastStatus?.running ? '暂无在线玩家' : '游戏服务未运行';
    for (const player of list) {
      const row = document.createElement('div'); row.className = 'player-row';
      const label = player.name || player.accountName || '玩家';
      const details = document.createElement('div'); details.className = 'player-details';
      const title = document.createElement('strong'); title.textContent = label;
      const caption = document.createElement('span'); caption.textContent = `Lv.${player.level ?? '—'} · ${player.userId || 'ID 未提供'}`;
      details.append(title, caption);
      const actions = document.createElement('div'); actions.className = 'player-actions';
      const disabled = Boolean(lastStatus?.task) || !lastStatus?.ready || !player.userId;
      const kick = document.createElement('button'); kick.className = 'button secondary'; kick.textContent = '移出'; kick.disabled = disabled;
      kick.addEventListener('click', async () => {
        const message = await playerMessage('移出玩家', `将 ${label} 移出游戏服。`, '移出', false);
        if (message === null) return;
        action('kick', { userid: player.userId, message }, false);
      });
      const ban = document.createElement('button'); ban.className = 'button secondary'; ban.textContent = '封禁'; ban.disabled = disabled;
      ban.addEventListener('click', async () => {
        const message = await playerMessage('封禁玩家', `封禁 ${label}，该玩家将被移出并无法再次加入。`, '封禁', true);
        if (message === null) return;
        action('ban', { userid: player.userId, name: label, message }, false);
      });
      actions.append(kick, ban);
      row.append(details, actions); $('manager-players-list').append(row);
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
    if (!value.players.length) list.textContent = '暂无已封禁玩家';
    for (const player of value.players) {
      const row = document.createElement('div'); row.className = 'player-row';
      const details = document.createElement('div'); details.className = 'player-details';
      const title = document.createElement('strong'); title.textContent = player.name || player.userId;
      const caption = document.createElement('span'); caption.textContent = player.name ? player.userId : '昵称未记录';
      details.append(title, caption);
      if (player.reason) {
        const note = document.createElement('span'); note.textContent = `封禁理由：${player.reason}`;
        details.append(note);
      }
      if (player.bannedAt) {
        const time = document.createElement('span'); time.textContent = `封禁时间：${new Date(player.bannedAt).toLocaleString()}`;
        details.append(time);
      }
      const button = document.createElement('button'); button.className = 'button secondary'; button.textContent = '解封'; button.disabled = disabled;
      button.addEventListener('click', async () => {
        const confirmed = await ask({ title: '解封玩家？', description: `允许 ${player.name || player.userId} 重新加入服务器。`, confirm: '解封', symbol: 'user' });
        if (confirmed) await action('unban', { userid: player.userId }, false);
      });
      row.append(details, button); list.append(row);
    }
  }
  async function loadBans() {
    if (loadingBans) return;
    loadingBans = true;
    try {
      const value = await api.request('banned-players');
      bannedCache = value;
      renderBans(value);
      $('banned-player-error').hidden = true;
    } catch (caught) {
      $('banned-player-error').textContent = `无法读取封禁名单：${caught.message}`;
      $('banned-player-error').hidden = false;
      if (!bannedCache) { $('banned-player-count').textContent = '—'; $('manager-banned-list').textContent = '封禁名单暂不可用'; }
    } finally { loadingBans = false; }
  }
  async function refresh() {
    syncLogs();
    if (!stopped && !document.hidden && !$('game-page').hidden && !$('game-players-view').hidden) void loadBans();
    if (polling || stopped || document.hidden) return;
    polling = true;
    try {
      const value = await api.request('status'); lastStatus = value;
      const game = $('game-state');
      game.textContent = !value.installed ? '未安装' : value.running ? (value.ready ? '运行中' : value.task?.action === 'start' || value.task?.action === 'install' || value.task?.action === 'apply' || value.task?.action === 'restart' ? '启动中' : '接口异常') : '已停止';
      game.dataset.state = value.running && value.ready ? 'saved' : 'pending';
      $('server-state-note').textContent = !value.installed ? '先安装服务端，再启动你的帕鲁世界。' : !value.running ? '服务端已就绪，可以启动。' : value.ready ? '服务运行正常' : '游戏进程运行中，管理接口暂未就绪';
      const config = $('game-config-state');
      config.textContent = value.configuration === 'pending' ? '待生效' : value.running && value.ready ? '已生效' : '已写入';
      config.dataset.state = value.configuration === 'pending' ? 'pending' : value.running && value.ready ? 'saved' : 'written';
      config.title = value.configuration === 'pending' ? '当前面板配置尚未应用到游戏，点击应用配置后生效。'
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
        button.disabled = Boolean(value.task) || (name === 'install' && value.installed) || (['start', 'update', 'restart', 'import-save'].includes(name) && !value.installed) || (name === 'start' && value.running) || (['stop', 'force-stop', 'restart', 'save-world'].includes(name) && !value.running);
        if (name === 'backup') {
          const noSave = !value.hasWorldSave && !value.running;
          button.disabled ||= noSave;
          button.title = noSave ? '尚无可备份的世界存档，请先启动游戏并生成存档。' : '';
        }
        if (name === 'apply') button.textContent = value.running ? '应用并重启' : '应用配置';
      }
      $('check-update').disabled = checkingUpdate || !value.installed || Boolean(value.task);
      $('complete-backup-note').textContent = !value.hasWorldSave && !value.running
        ? '尚无可备份的世界存档，请先启动游戏并生成存档。已有备份仍可下载或恢复。'
        : '包含世界、玩家存档和游戏配置。手动创建完整备份时会先存档并停服，完成后按原状态启动；恢复任何备份前都会先备份当前数据。';
      const playerActionDisabled = Boolean(value.task) || !value.running || !value.ready;
      $('ban-player').disabled = playerActionDisabled;
      $('unban-player').disabled = playerActionDisabled;
      if (bannedCache) renderBans(bannedCache);
      renderHistory(value.tasks);
      const task = value.task || value.tasks[0];
      if (task) {
        showTask(task);
        if (task.state === 'failed' && task.id !== lastTask) error(task.message);
        if (task.state !== 'running') lastTask = task.id;
      }
      players(value.players);
      const gameVisible = !$('game-page').hidden;
      const overviewVisible = gameVisible && !$('game-overview').hidden;
      const savesVisible = gameVisible && !$('game-saves').hidden;
      if (overviewVisible || savesVisible) await loadSettings();
      if (savesVisible) await Promise.all([loadNativeBackups(), loadBackups()]);
    } catch (caught) {
      error(caught.message);
      actionButtons.forEach(button => { button.disabled = true; });
      if (caught.status === 401) { stopped = true; stopLogs(); $('game-state').textContent = '需登录'; }
    } finally { polling = false; }
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
      $('backup-retention').value = settings.backupRetention;
      settingsCache = settings;
      $('backup-settings').querySelectorAll('input, button').forEach(control => { control.disabled = false; });
      $('edit-game-args').disabled = false;
      $('edit-install-args').disabled = false;
      return settings;
    }).catch(caught => { settingsRequest = null; throw caught; });
    return settingsRequest;
  }
  $('check-update').addEventListener('click', async () => {
    if (checkingUpdate) return;
    checkingUpdate = true;
    const status = $('update-status');
    status.hidden = false;
    status.textContent = '正在检查 Steam 最新版本…';
    $('check-update').disabled = true;
    try {
      const value = await api.request('update-check');
      if (!value.installed) status.textContent = '服务端尚未安装。';
      else if (value.error) status.textContent = `更新检查失败：${value.error}`;
      else if (value.updateAvailable) status.textContent = `发现新版本：已安装 build ${value.installedBuild}，Steam 最新 build ${value.latestBuild}。可点击「更新服务端」。`;
      else status.textContent = `已是最新版本（build ${value.installedBuild}）。`;
    } catch (caught) { status.textContent = `更新检查失败：${caught.message}`; }
    finally {
      checkingUpdate = false;
      $('check-update').disabled = !lastStatus?.installed || Boolean(lastStatus?.task);
    }
  });
  $('backup-settings').addEventListener('submit', async event => {
    event.preventDefault();
    try { await api.request('settings', { method: 'PUT', body: { backupRetention: Number($('backup-retention').value) } }); notify('完整备份保留设置已保存'); }
    catch (caught) { error(caught.message); }
  });
  $('manager-announce').addEventListener('submit', event => { event.preventDefault(); action('announce', { message: $('announce-message').value }, false); });
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
  $('manager-logout').addEventListener('click', async () => {
    try { await getConfiguration(); await api.request('logout', { method: 'POST', body: {} }); document.location.assign('/login.html'); }
    catch (caught) { error(caught.message); }
  });
  let timer = setInterval(refresh, 5000);
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('hashchange', refresh);
  window.addEventListener('pagehide', () => { pageActive = false; stopLogs(); clearInterval(timer); });
  window.addEventListener('pageshow', event => { if (event.persisted) { pageActive = true; timer = setInterval(refresh, 5000); refresh(); } });
  refresh();
  return { refresh };
}
