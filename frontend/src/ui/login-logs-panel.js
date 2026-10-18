export function createLoginLogsPanel({ dom, api, window }) {
  const { $, document, el } = dom;
  const content = $('login-log-content');
  const status = $('login-log-status');
  const timeFormat = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  const timeZone = timeFormat.resolvedOptions().timeZone;
  let closeLogs = null;
  let generation = 0;
  let pageActive = true;
  let unauthorized = false;
  let previousText = null;

  function render(text) {
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    if (!lines.length) {
      content.replaceChildren(el('p', 'login-log-empty', '暂无登录记录'));
      return;
    }
    const table = el('table', 'login-log-table');
    const head = el('thead');
    const heading = el('tr');
    for (const label of ['时间（本地）', '登录结果', '来源 IP', '详情']) {
      const cell = el('th', '', label);
      cell.scope = 'col';
      heading.append(cell);
    }
    head.append(heading);
    const body = el('tbody');
    for (const line of lines.reverse()) {
      const timestamp = line.match(/^\[([^\]]+)\]\s*/);
      const message = timestamp ? line.slice(timestamp[0].length) : line;
      const record = message.match(/^(登录成功|登录失败|登录尝试过于频繁)（([^，）]+)(?:，([\s\S]*))?）$/);
      const row = el('tr');
      const utc = timestamp?.[1].match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?) UTC$/);
      const date = utc ? new Date(`${utc[1]}T${utc[2]}Z`) : null;
      const time = el('td', 'login-log-time', date && !Number.isNaN(date.getTime()) ? timeFormat.format(date) : timestamp?.[1] || '—');
      if (timestamp) time.title = timestamp[1];
      const result = el('td', 'login-log-result');
      const state = record ? { 登录成功: 'success', 登录失败: 'failure', 登录尝试过于频繁: 'limited' }[record[1]] : 'unknown';
      result.append(el('span', `login-log-badge ${state}`, record?.[1] || '登录记录'));
      const ip = el('td', 'login-log-ip', record?.[2] || '—');
      const detail = el('td', 'login-log-detail', record ? record[3] || '—' : message);
      row.append(time, result, ip, detail);
      body.append(row);
    }
    table.append(head, body);
    content.replaceChildren(table);
  }

  function stop() {
    generation++;
    closeLogs?.();
    closeLogs = null;
  }
  function sync() {
    if (!pageActive || unauthorized || document.hidden || $('login-logs-page').hidden) { stop(); return; }
    if (closeLogs) return;
    const current = ++generation;
    status.textContent = '正在连接实时日志…';
    closeLogs = api.watchLogs('login', {
      onOpen() {
        if (current === generation) status.textContent = `登录记录实时更新，断线后自动重连；时间为本地时间（${timeZone}）。`;
      },
      onLog(text) {
        if (current !== generation) return;
        const next = text || '';
        if (previousText === next) return;
        const top = content.scrollTop < 30;
        const scrollTop = content.scrollTop;
        const scrollHeight = content.scrollHeight;
        render(next);
        previousText = next;
        content.scrollTop = top ? 0 : scrollTop + Math.max(0, content.scrollHeight - scrollHeight);
      },
      onError(error) {
        if (current !== generation) return;
        status.textContent = error.message;
        if (error.status === 401) { unauthorized = true; stop(); }
      }
    });
  }
  window.addEventListener('hashchange', sync);
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pagehide', () => { pageActive = false; stop(); });
  window.addEventListener('pageshow', event => { if (event.persisted) { pageActive = true; sync(); } });
  sync();
}
