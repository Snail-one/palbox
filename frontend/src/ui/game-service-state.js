const phases = {
  'steamcmd-downloading': ['下载 SteamCMD 中', '正在从 Valve 下载 SteamCMD。'],
  'steamcmd-installing': ['安装 SteamCMD 中', '正在解压 SteamCMD。'],
  'steamcmd-initializing': ['初始化 SteamCMD 中', '正在初始化并更新 SteamCMD。'],
  'steamcmd-ready': ['SteamCMD 已就绪', '可以安装游戏服务端。'],
  installing: ['安装中', '正在准备安装服务端，请稍候。'],
  downloading: ['下载中', '正在通过 SteamCMD 下载服务端文件。'],
  verifying: ['校验中', '正在校验服务端文件完整性。'],
  updating: ['更新中', '正在更新服务端文件。'],
  stopping: ['停止中', '正在保存世界并等待游戏服务退出。'],
  'force-stopping': ['强制停止中', '正在强制终止游戏服务。'],
  backing: ['备份中', '正在备份存档和配置。'],
  restoring: ['恢复中', '正在恢复世界和玩家存档。'],
  resetting: ['重置存档中', '正在清空当前世界和玩家存档，其他世界保留。'],
  applying: ['应用配置中', '正在将配置写入游戏文件。']
};
const actions = {
  'install-steamcmd': 'steamcmd-installing',
  install: 'installing', update: 'updating', stop: 'stopping', 'force-stop': 'force-stopping',
  backup: 'backing', restore: 'restoring', 'restore-native': 'restoring',
  'import-save': 'restoring', 'reset-save': 'resetting', apply: 'applying'
};
const failureLabels = { 'install-steamcmd': 'SteamCMD 安装失败', install: '安装失败', update: '更新失败', start: '启动失败', restart: '重启失败' };

export function gameServiceState(value) {
  const status = (label, description, state = 'pending') => ({ label, description, state });
  const task = value.task?.state === 'running' ? value.task : null;
  if (task) {
    const phase = task.phase || actions[task.action];
    if (phase === 'starting' || ['start', 'restart'].includes(task.action) && !phase) {
      if (value.running && !value.ready) return status('等待就绪', '游戏进程已启动，正在等待游戏管理接口就绪。');
      if (value.running && value.ready) return status('运行中', '游戏服务和管理接口已就绪。', 'saved');
      return status('启动中', '正在启动游戏服务，请稍候。');
    }
    if (phases[phase]) {
      const [label, description] = phases[phase];
      return status(label, task.message && task.message !== '任务已开始' ? task.message : description);
    }
  }
  if (value.running) {
    return value.ready
      ? status('运行中', '游戏服务正在运行，管理接口已就绪。', 'saved')
      : status('接口异常', '游戏进程仍在运行，但管理接口无法连接，请检查运行日志。', 'error');
  }
  const latest = value.tasks?.[0];
  if (latest?.state === 'failed' && failureLabels[latest.action]) return status(failureLabels[latest.action], latest.message || '操作失败，请查看运行日志。', 'error');
  if (!value.installed) return status('未安装', value.steamcmd?.installed === false ? value.steamcmd.reason || '请先点击“安装 SteamCMD”，完成后再安装游戏服务端。' : '尚未安装游戏服务端，点击“安装服务端”开始下载和安装。');
  if (value.lastExit && (value.lastExit.code !== 0 || value.lastExit.signal) && !['stop', 'force-stop'].includes(latest?.action)) {
    return status('异常退出', `游戏进程已退出（${value.lastExit.signal || `退出码 ${value.lastExit.code ?? '未知'}`}），请查看运行日志。`, 'error');
  }
  return value.lastExit || value.startedAt
    ? status('已停止', '游戏服务已停止，可点击“启动”重新运行。')
    : status('已安装', '服务端已安装，尚未启动，可点击“启动”运行。', 'saved');
}
