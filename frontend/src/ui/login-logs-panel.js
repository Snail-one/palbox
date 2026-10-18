export function createLoginLogsPanel({ dom, api, window }) {
  const { $, document } = dom;
  const content = $('login-log-content');
  const status = $('login-log-status');
  let closeLogs = null;
  let generation = 0;
  let pageActive = true;
  let unauthorized = false;

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
        if (current === generation) status.textContent = '登录记录实时更新，断线后自动重连；时间为 UTC。';
      },
      onLog(text) {
        if (current !== generation) return;
        const next = text || '暂无登录记录';
        if (content.textContent === next) return;
        const bottom = content.scrollHeight - content.scrollTop - content.clientHeight < 30;
        const scrollTop = content.scrollTop;
        content.textContent = next;
        content.scrollTop = bottom ? content.scrollHeight : scrollTop;
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
