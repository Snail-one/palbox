import { createGameArgsDialog } from './game-args-dialog.js';
import { createSaveImportDialog } from './save-import-dialog.js';

export function createManagementPanel({ dom, api, ask, notify, getConfiguration }) {
  const { $, document } = dom;
  const section = document.createElement('section');
  section.className = 'management-panel';
  section.setAttribute('aria-label', '帕鲁服务管理');
  section.innerHTML = `
    <div class="management-heading"><h2>游戏服务 <span id="game-state" class="save-status" data-state="pending">连接中</span></h2><a class="button secondary" href="#configuration">管理配置 →</a></div>
    <p class="management-note">管理服务器的安装、启动、停止与更新。</p>
    <div class="management-actions"><button class="button secondary" data-action="install">安装服务端</button><button class="button primary" data-action="start">启动</button><button class="button secondary" data-action="stop">停止</button><button class="button secondary" data-action="restart">重启</button><button class="button secondary" data-action="update">更新服务端</button><button class="button secondary" id="edit-game-args" disabled><svg class="icon" aria-hidden="true"><use href="#i-edit"/></svg>启动参数</button></div>`;
  const metrics = document.createElement('dl');
  metrics.className = 'management-metrics';
  metrics.setAttribute('aria-label', '服务器运行信息');
  const cards = [
    ['版本', 'game-version', 'code', '—', '当前游戏服务端版本'],
    ['在线', 'game-players', 'user', '—', '当前人数 / 人数上限'],
    ['FPS', 'game-fps', 'sparkles', '—', '服务器每秒运行帧数'],
    ['运行', 'game-uptime', 'globe', '—', '本次启动持续时间'],
    ['游戏端口', 'game-port', 'server', '8211', 'UDP 游戏连接端口']
  ];
  metrics.innerHTML = cards.map(([label, id, icon, initial, caption]) => `<div class="server-metric"><dt><span class="metric-icon"><svg class="icon" aria-hidden="true"><use href="#i-${icon}"/></svg></span>${label}</dt><dd id="${id}" class="metric-value">${initial}</dd><dd class="metric-caption">${caption}</dd></div>`).join('');
  $('game-overview').append(metrics, section);
  const logs = document.createElement('section');
  logs.id = 'game-logs';
  logs.className = 'management-panel';
  logs.setAttribute('aria-label', '运行日志');
  logs.innerHTML = `<div class="management-heading log-heading"><h2>运行日志</h2><div class="segmented log-type-buttons" id="manager-log-channel" role="group" aria-label="日志类型"><button type="button" class="selected" data-log-channel="game" aria-pressed="true">游戏日志</button><button type="button" data-log-channel="steamcmd" aria-pressed="false">安装与更新</button><button type="button" data-log-channel="palbox" aria-pressed="false">面板日志</button></div></div><p class="management-note">日志自动刷新，支持切换游戏、安装更新与面板日志。</p><pre id="manager-logs" tabindex="0">正在读取日志…</pre>`;
  $('game-overview').append(logs);
  const playerPanel = document.createElement('section');
  playerPanel.className = 'management-panel';
  playerPanel.setAttribute('aria-label', '在线玩家与广播');
  playerPanel.innerHTML = `<div class="management-heading"><h2>在线玩家与广播</h2></div><p class="management-note">查看在线玩家并向服务器发送公告。</p><form id="manager-announce"><label class="sr-only" for="announce-message">广播内容</label><input id="announce-message" maxlength="500" required placeholder="向服务器玩家广播…"><button class="button secondary" type="submit">发送广播</button></form><div id="manager-players-list">游戏服尚未连接</div>`;
  $('game-players-view').append(playerPanel);
  const saves = document.createElement('section');
  saves.id = 'save-management';
  saves.className = 'management-panel save-management';
  saves.setAttribute('aria-labelledby', 'save-management-title');
  saves.innerHTML = `
    <div class="management-heading"><div><h2 id="save-management-title">存档管理</h2><p class="management-note">官方自动备份与手动完整备份分开管理。</p></div><div class="management-actions"><button class="button secondary" data-action="import-save" disabled><svg class="icon" aria-hidden="true"><use href="#i-upload"/></svg>导入存档</button><button class="button secondary" data-action="backup" disabled>创建完整备份</button><button class="button primary" data-action="save-world" disabled>保存世界</button></div></div>
    <div class="save-backup-plan"><div class="management-heading"><h3>官方自动备份 <span id="native-backup-state" class="save-status" data-state="pending">读取中</span></h3><a class="button secondary" href="#configuration">管理备份配置 →</a></div><p class="management-note">由游戏在运行中生成，无需停服。保留档位：30 秒 5 份、10 分钟 6 份、1 小时 12 份、1 天 7 份。修改「自动备份世界」后需应用配置。</p><p id="native-backup-note" class="management-note"></p><div class="save-backup-heading"><h3>官方存档备份</h3><span id="native-backup-summary" role="status">正在读取…</span></div><div id="native-backups">正在读取官方备份…</div></div>
    <div class="save-backup-heading"><h3>完整备份归档</h3><span id="save-backup-summary" role="status">正在读取…</span></div><p class="management-note">包含世界、玩家存档和游戏配置。手动创建完整备份时会先存档并停服，完成后重新启动；恢复任何备份前都会先备份当前数据。</p>
    <form id="backup-settings"><label>每类完整备份保留数量<input id="backup-retention" disabled type="number" min="1" max="100" required></label><button class="button secondary" type="submit" disabled>保存设置</button></form>
    <div id="manager-backups">正在读取完整备份…</div>`;
  $('game-saves').append(saves);
  const deployment = document.createElement('section');
  deployment.className = 'configuration-deployment';
  deployment.setAttribute('aria-label', '配置应用');
  deployment.hidden = $('configuration-page').hidden || $('configuration-editor').hidden;
  deployment.innerHTML = `<div><h2>应用到游戏 <span id="game-config-state" class="save-status" data-state="pending">连接中</span></h2><p>有效修改自动保存到服务器。应用后写入游戏；运行中的服务器会先存档、停服、备份，再应用并重启。</p></div><button class="button primary" data-action="apply" disabled>应用配置</button>`;
  $('configuration-page').prepend(deployment);
  const feedback = document.createElement('div');
  feedback.className = 'management-feedback';
  feedback.innerHTML = `<div id="management-error" class="alert error" role="alert" hidden></div><p id="management-task" class="management-task" role="status">暂无任务</p>`;
  $('storage-error').after(feedback);
  const logout = document.createElement('button');
  logout.id = 'manager-logout'; logout.className = 'button secondary'; logout.textContent = '退出登录';
  document.querySelector('.topbar-session').append(logout);
  document.querySelector('.bottom-note > span:last-child').textContent = '配置自动保存 · 应用后在游戏中生效';
  const actionButtons = [...section.querySelectorAll('[data-action]'), ...saves.querySelectorAll('[data-action]'), ...deployment.querySelectorAll('[data-action]')];
  actionButtons.forEach(button => { button.disabled = true; });
  const names = { install: '安装服务端', start: '启动', stop: '停止', restart: '重启', update: '更新服务端', apply: '应用配置', backup: '创建备份', restore: '恢复备份', 'restore-native': '恢复官方备份', 'import-save': '导入存档', 'save-world': '保存世界', announce: '发送广播', kick: '移出玩家' };
  let polling = false;
  let stopped = false;
  let lastTask;
  let lastStatus;
  let settingsRequest = null;
  let settingsCache = null;
  let logChannel = 'game';
  let logRequest = 0;
  function error(message) { $('management-error').textContent = message; $('management-error').hidden = !message; }
  async function action(name, payload = {}, confirm = true) {
    if (confirm && ['stop', 'restart', 'update', 'apply', 'backup', 'restore', 'restore-native', 'kick'].includes(name)) {
      const descriptions = {
        apply: '将当前配置写入游戏。游戏服正在运行时会先存档、停服、备份，再应用并重启。',
        backup: '备份完整存档和配置。游戏服正在运行时会短暂停服，完成后重新启动。',
        restore: '用这份完整备份恢复游戏配置和世界存档。当前存档会先备份，面板中的配置预设保持不变。',
        'restore-native': '将当前世界和玩家存档恢复到所选官方备份。会先存档、停服并创建完整备份，保留当前配置及官方备份历史；原先运行的游戏服会重新启动。',
        update: '先保存世界、停服并备份，再用 SteamCMD 更新。更新完成后恢复原来的运行状态。',
        stop: '保存世界后停止游戏服，管理面板继续运行。',
        restart: '保存世界并重启游戏服。', kick: '将选中的玩家移出游戏服。'
      };
      if (!(await ask({ title: `${names[name]}？`, description: descriptions[name], confirm: names[name], danger: ['restore', 'restore-native', 'kick'].includes(name), symbol: 'server' }))) return;
    }
    try {
      if (name === 'apply') payload = { ...payload, ...await getConfiguration() };
      error('');
      const task = await api.request('tasks', { method: 'POST', body: { action: name, ...payload } });
      $('management-task').textContent = `${names[name]}：${task.message}`;
      await refresh();
    } catch (caught) { error(caught.message); }
  }
  const gameArgsDialog = createGameArgsDialog({ dom, onSave: async gameArgs => {
    const saved = await api.request('settings', { method: 'PUT', body: { gameArgs } });
    settingsCache = saved;
    notify('启动参数已保存，将在下次启动或重启游戏服时生效');
  } });
  $('edit-game-args').addEventListener('click', () => gameArgsDialog.open(settingsCache?.gameArgs ?? []));
  const saveImport = createSaveImportDialog({ dom, api, onImport: async id => {
    error('');
    const task = await api.request('tasks', { method: 'POST', body: { action: 'import-save', id } });
    $('management-task').textContent = `${names['import-save']}：${task.message}`;
    await refresh();
  } });
  for (const button of actionButtons) button.addEventListener('click', () => button.dataset.action === 'import-save' ? saveImport.open() : action(button.dataset.action));
  async function loadBackups() {
    const backups = await api.request('backups');
    $('save-backup-summary').textContent = `${backups.length} 份 · ${(backups.reduce((total, backup) => total + backup.bytes, 0) / 1024 / 1024).toFixed(1)} MB`;
    $('manager-backups').replaceChildren();
    if (!backups.length) $('manager-backups').textContent = '暂无完整备份。手动创建后，可在这里下载或恢复。';
    for (const backup of backups) {
      const row = document.createElement('div'); row.className = 'backup-row';
      const label = document.createElement('span');
      const category = { manual: '手动', scheduled: '旧定时归档', 'before-update': '更新前' }[backup.category];
      label.textContent = `${new Date(backup.createdAt).toLocaleString()} · ${category} · ${(backup.bytes / 1024 / 1024).toFixed(1)} MB`;
      const download = document.createElement('a'); download.className = 'button secondary'; download.textContent = '下载'; download.href = `/api/backup?id=${encodeURIComponent(backup.id)}`; download.setAttribute('download', '');
      const restore = document.createElement('button'); restore.className = 'button secondary'; restore.textContent = '恢复'; restore.disabled = Boolean(lastStatus?.task); restore.addEventListener('click', () => action('restore', { id: backup.id }));
      row.append(label, download, restore); $('manager-backups').append(row);
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
  async function loadLogs() {
    const request = ++logRequest;
    let result;
    try { result = await api.request(`logs?channel=${encodeURIComponent(logChannel)}`); }
    catch (caught) { if (request === logRequest) throw caught; return; }
    if (request !== logRequest) return;
    const panel = $('manager-logs');
    const bottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 30;
    panel.textContent = result.text || '暂无日志';
    if (bottom) panel.scrollTop = panel.scrollHeight;
  }
  function players(list) {
    $('manager-players-list').replaceChildren();
    if (!list.length) $('manager-players-list').textContent = '暂无在线玩家';
    for (const player of list) {
      const row = document.createElement('div'); row.className = 'backup-row';
      const text = document.createElement('span'); text.textContent = `${player.name || player.accountName || '玩家'} · Lv.${player.level ?? '—'} · ${player.userId || ''}`;
      const kick = document.createElement('button'); kick.className = 'button secondary'; kick.textContent = '移出'; kick.disabled = Boolean(lastStatus?.task); kick.addEventListener('click', () => action('kick', { userid: player.userId }));
      row.append(text, kick); $('manager-players-list').append(row);
    }
  }
  async function refresh() {
    if (polling || stopped || document.hidden) return;
    polling = true;
    try {
      const value = await api.request('status'); lastStatus = value;
      const game = $('game-state');
      game.textContent = !value.installed ? '未安装' : value.running ? (value.ready ? '运行中' : value.task?.action === 'start' || value.task?.action === 'install' || value.task?.action === 'apply' || value.task?.action === 'restart' ? '启动中' : '接口异常') : '已停止';
      game.dataset.state = value.running && value.ready ? 'saved' : 'pending';
      const config = $('game-config-state');
      config.textContent = value.configuration === 'pending' ? '待生效' : value.running && value.ready ? '已生效' : '已写入';
      config.dataset.state = value.configuration === 'pending' ? 'pending' : 'saved';
      $('game-version').textContent = value.info?.version || '—';
      $('game-players').textContent = value.metrics ? `${value.metrics.currentplayernum} / ${value.metrics.maxplayernum}` : '—';
      $('game-fps').textContent = value.metrics?.serverfps ?? '—';
      $('game-uptime').textContent = value.metrics ? `${Math.floor(value.metrics.uptime / 60)} 分钟` : '—';
      $('game-port').textContent = value.port;
      for (const button of actionButtons) {
        const name = button.dataset.action;
        button.disabled = Boolean(value.task) || (name === 'install' && value.installed) || (['start', 'update', 'restart', 'import-save'].includes(name) && !value.installed) || (name === 'start' && value.running) || (['stop', 'restart', 'save-world'].includes(name) && !value.running);
        if (name === 'apply') button.textContent = value.running ? '应用并重启' : '应用配置';
      }
      const task = value.task || value.tasks[0];
      if (task) {
        const state = { running: '执行中', succeeded: '已完成', failed: '失败', interrupted: '已中断' }[task.state];
        $('management-task').textContent = `${names[task.action] || task.action} · ${state} · ${task.message}`;
        if (task.state === 'failed' && task.id !== lastTask) error(task.message);
        if (task.state !== 'running') lastTask = task.id;
      }
      players(value.players);
      const gameVisible = !$('game-page').hidden;
      const overviewVisible = gameVisible && !$('game-overview').hidden;
      const savesVisible = gameVisible && !$('game-saves').hidden;
      if (overviewVisible || savesVisible) await loadSettings();
      if (overviewVisible) await loadLogs();
      if (savesVisible) await Promise.all([loadNativeBackups(), loadBackups()]);
    } catch (caught) {
      error(caught.message);
      actionButtons.forEach(button => { button.disabled = true; });
      if (caught.status === 401) { stopped = true; $('game-state').textContent = '需登录'; }
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
    loadLogs().catch(caught => error(caught.message));
  });
  function loadSettings() {
    settingsRequest ??= api.request('settings').then(settings => {
      $('backup-retention').value = settings.backupRetention;
      settingsCache = settings;
      $('backup-settings').querySelectorAll('input, button').forEach(control => { control.disabled = false; });
      $('edit-game-args').disabled = false;
      return settings;
    }).catch(caught => { settingsRequest = null; throw caught; });
    return settingsRequest;
  }
  $('backup-settings').addEventListener('submit', async event => {
    event.preventDefault();
    try { await api.request('settings', { method: 'PUT', body: { backupRetention: Number($('backup-retention').value) } }); notify('完整备份保留设置已保存'); }
    catch (caught) { error(caught.message); }
  });
  $('manager-announce').addEventListener('submit', event => { event.preventDefault(); action('announce', { message: $('announce-message').value }, false); });
  $('manager-logout').addEventListener('click', async () => {
    try { await getConfiguration(); await api.request('logout', { method: 'POST', body: {} }); document.location.assign('/login.html'); }
    catch (caught) { error(caught.message); }
  });
  const timer = setInterval(refresh, 5000);
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('hashchange', refresh);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  refresh();
  return { refresh };
}
