export function createManagementPanel({ dom, api, ask, notify, getConfiguration }) {
  const { $, document } = dom;
  const section = document.createElement('section');
  section.className = 'management-panel';
  section.setAttribute('aria-label', '帕鲁服务管理');
  section.innerHTML = `
    <div class="management-heading"><div><div class="eyebrow">PALWORLD SERVER</div><h2>服务管理 <span id="game-state" class="save-status" data-state="pending">连接中</span> <span id="game-config-state" class="save-status" data-state="pending">待生效</span></h2></div><button id="manager-logout" class="button secondary">退出登录</button></div>
    <div class="management-metrics"><span>版本 <strong id="game-version">—</strong></span><span>在线 <strong id="game-players">—</strong></span><span>FPS <strong id="game-fps">—</strong></span><span>运行 <strong id="game-uptime">—</strong></span><span>游戏端口 <strong id="game-port">8211</strong></span></div>
    <div class="management-actions"><button class="button secondary" data-action="install">安装服务端</button><button class="button secondary" data-action="start">启动</button><button class="button secondary" data-action="stop">停止</button><button class="button secondary" data-action="restart">重启</button><button class="button secondary" data-action="update">更新服务端</button><button class="button primary" data-action="apply">应用配置</button><button class="button secondary" data-action="save-world">保存世界</button><button class="button secondary" data-action="backup">创建备份</button></div>
    <p class="management-note">配置自动保存在服务器；应用配置后才会写入游戏。运行中的游戏服应用配置或创建备份时，会先存档并短暂停服。</p>
    <div id="management-error" class="alert error" role="alert" hidden></div>
    <p id="management-task" class="management-task" role="status">暂无任务</p>
    <div class="management-details">
      <details id="manager-log-details"><summary>运行日志</summary><label>日志类型 <select id="manager-log-channel"><option value="game">游戏日志</option><option value="steamcmd">安装与更新</option><option value="palbox">面板日志</option></select></label><pre id="manager-logs" tabindex="0">暂无日志</pre></details>
      <details id="manager-backup-details"><summary>备份与恢复</summary><form id="backup-settings"><label>自动备份间隔（小时，0 关闭）<input id="backup-interval" disabled type="number" min="0" max="168" required></label><label>每类保留数量<input id="backup-retention" disabled type="number" min="1" max="100" required></label><button class="button secondary" type="submit" disabled>保存计划</button></form><div id="manager-backups">暂无备份</div></details>
      <details id="manager-player-details"><summary>在线玩家与广播</summary><form id="manager-announce"><label class="sr-only" for="announce-message">广播内容</label><input id="announce-message" maxlength="500" required placeholder="向服务器玩家广播…"><button class="button secondary" type="submit">发送广播</button></form><div id="manager-players-list">游戏服尚未连接</div></details>
    </div>`;
  $('storage-error').after(section);
  document.querySelector('.local-status').textContent = '服务管理模式';
  document.querySelector('.local-card strong').textContent = '保存在你的服务器';
  document.querySelector('.local-card p').textContent = '配置、存档与备份持久保存，换设备也能继续管理。';
  const names = { install: '安装服务端', start: '启动', stop: '停止', restart: '重启', update: '更新服务端', apply: '应用配置', backup: '创建备份', restore: '恢复备份', 'save-world': '保存世界', announce: '发送广播', kick: '移出玩家' };
  let polling = false;
  let stopped = false;
  let lastTask;
  let lastStatus;
  function error(message) { $('management-error').textContent = message; $('management-error').hidden = !message; }
  async function action(name, payload = {}, confirm = true) {
    if (confirm && ['stop', 'restart', 'update', 'apply', 'backup', 'restore', 'kick'].includes(name)) {
      const descriptions = {
        apply: '将当前配置写入游戏。游戏服正在运行时会先存档、停服、备份，再应用并重启。',
        backup: '备份完整存档和配置。游戏服正在运行时会短暂停服，完成后重新启动。',
        restore: '用这份备份恢复游戏配置和世界存档。当前存档会先备份，面板中的配置预设保持不变。',
        update: '先保存世界、停服并备份，再用 SteamCMD 更新。更新完成后恢复原来的运行状态。',
        stop: '保存世界后停止游戏服，管理面板继续运行。',
        restart: '保存世界并重启游戏服。', kick: '将选中的玩家移出游戏服。'
      };
      if (!(await ask({ title: `${names[name]}？`, description: descriptions[name], confirm: names[name], danger: ['restore', 'kick'].includes(name), symbol: 'server' }))) return;
    }
    try {
      if (name === 'apply') payload = { ...payload, ...await getConfiguration() };
      error('');
      const task = await api.request('tasks', { method: 'POST', body: { action: name, ...payload } });
      $('management-task').textContent = `${names[name]}：${task.message}`;
      await refresh();
    } catch (caught) { error(caught.message); }
  }
  for (const button of section.querySelectorAll('[data-action]')) button.addEventListener('click', () => action(button.dataset.action));
  async function loadBackups() {
    const backups = await api.request('backups');
    $('manager-backups').replaceChildren();
    if (!backups.length) $('manager-backups').textContent = '暂无备份';
    for (const backup of backups) {
      const row = document.createElement('div'); row.className = 'backup-row';
      const label = document.createElement('span');
      const category = { manual: '手动', scheduled: '定时', 'before-update': '更新前' }[backup.category];
      label.textContent = `${new Date(backup.createdAt).toLocaleString()} · ${category} · ${(backup.bytes / 1024 / 1024).toFixed(1)} MB`;
      const download = document.createElement('a'); download.className = 'button secondary'; download.textContent = '下载'; download.href = `/api/backup?id=${encodeURIComponent(backup.id)}`; download.setAttribute('download', '');
      const restore = document.createElement('button'); restore.className = 'button secondary'; restore.textContent = '恢复'; restore.disabled = Boolean(lastStatus?.task); restore.addEventListener('click', () => action('restore', { id: backup.id }));
      row.append(label, download, restore); $('manager-backups').append(row);
    }
  }
  async function loadLogs() {
    const result = await api.request(`logs?channel=${encodeURIComponent($('manager-log-channel').value)}`);
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
      for (const button of section.querySelectorAll('[data-action]')) {
        const name = button.dataset.action;
        button.disabled = Boolean(value.task) || (name === 'install' && value.installed) || (['start', 'update', 'restart'].includes(name) && !value.installed) || (name === 'start' && value.running) || (['stop', 'restart', 'save-world'].includes(name) && !value.running);
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
      if ($('manager-log-details').open) await loadLogs();
      if ($('manager-backup-details').open) await loadBackups();
    } catch (caught) {
      error(caught.message);
      if (caught.status === 401) { stopped = true; $('game-state').textContent = '需登录'; }
    } finally { polling = false; }
  }
  $('manager-log-channel').addEventListener('change', () => loadLogs().catch(caught => error(caught.message)));
  $('manager-log-details').addEventListener('toggle', () => { if ($('manager-log-details').open) loadLogs().catch(caught => error(caught.message)); });
  $('manager-backup-details').addEventListener('toggle', async () => {
    if (!$('manager-backup-details').open) return;
    const controls = [...$('backup-settings').querySelectorAll('input, button')];
    controls.forEach(control => { control.disabled = true; });
    try {
      const settings = await api.request('settings');
      $('backup-interval').value = settings.backupIntervalHours; $('backup-retention').value = settings.backupRetention;
      await loadBackups();
    } catch (caught) { error(caught.message); }
    finally { controls.forEach(control => { control.disabled = false; }); }
  });
  $('backup-settings').addEventListener('submit', async event => {
    event.preventDefault();
    try { await api.request('settings', { method: 'PUT', body: { backupIntervalHours: Number($('backup-interval').value), backupRetention: Number($('backup-retention').value) } }); notify('备份计划已保存'); }
    catch (caught) { error(caught.message); }
  });
  $('manager-announce').addEventListener('submit', event => { event.preventDefault(); action('announce', { message: $('announce-message').value }, false); });
  $('manager-logout').addEventListener('click', async () => {
    try { await getConfiguration(); await api.request('logout', { method: 'POST', body: {} }); document.location.assign('/login.html'); }
    catch (caught) { error(caught.message); }
  });
  const timer = setInterval(refresh, 5000);
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  refresh();
  return { refresh };
}
