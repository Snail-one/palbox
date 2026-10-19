export function createManagementClient({ fetch, csrf = '' }) {
  let token = csrf;
  const logConnections = new Set();
  const securityUpdates = new Set();
  return {
    watchLogs(channel, { onLog, onOpen, onError }) {
      let source;
      let closed = false;
      function connect() {
        if (closed) return;
        source?.close();
        const current = source = new EventSource(`/api/logs/stream?channel=${encodeURIComponent(channel)}`);
        current.onopen = () => { if (source === current && !closed) onOpen?.(); };
        current.addEventListener('log', event => {
          if (source !== current || closed) return;
          try { onLog(JSON.parse(event.data).text); }
          catch { onError?.(new Error('日志响应无效，请重新连接。')); }
        });
        current.addEventListener('unauthorized', async () => {
          // A rotation can invalidate this stream before its HTTP response
          // arrives. Wait for the new Cookie/CSRF and let connect replace it.
          await Promise.allSettled([...securityUpdates]);
          if (source !== current || closed) return;
          current.close();
          onError?.(Object.assign(new Error('登录已失效，请重新登录以查看日志。'), { status: 401 }));
        });
        current.onerror = () => {
          if (source === current && !closed) onError?.(new Error(current.readyState === EventSource.CLOSED ? '日志连接已关闭，请刷新页面或重新登录。' : '日志连接中断，正在重新连接…'));
        };
      }
      logConnections.add(connect);
      connect();
      return () => { closed = true; source.close(); logConnections.delete(connect); };
    },
    async request(path, { method = 'GET', body, timeout = 20000 } = {}) {
      let finish;
      const updating = method === 'POST' && path.startsWith('security/totp/') ? new Promise(resolve => { finish = resolve; }) : null;
      if (updating) securityUpdates.add(updating);
      try {
        const response = await fetch('/api/' + path, {
          method, credentials: 'same-origin', cache: 'no-store',
          signal: AbortSignal.timeout(timeout),
          headers: { 'Content-Type': 'application/json', 'X-Palbox-CSRF': token },
          body: body === undefined ? undefined : JSON.stringify(body)
        });
        let value;
        try { value = await response.json(); } catch { throw new Error('管理服务返回了无效响应。'); }
        if (!response.ok) {
          const error = new Error(value.error || `请求失败（${response.status}）`);
          error.status = response.status;
          throw error;
        }
        if (value.csrf && value.csrf !== token) {
          token = value.csrf;
          for (const connect of logConnections) connect();
        }
        return value;
      } finally {
        if (updating) { securityUpdates.delete(updating); finish(); }
      }
    },
    upload(path, file, { onProgress } = {}) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/' + path);
        xhr.withCredentials = true;
        xhr.timeout = 15 * 60 * 1000;
        xhr.setRequestHeader('Content-Type', 'application/gzip');
        xhr.setRequestHeader('X-Palbox-CSRF', token);
        xhr.upload.onprogress = event => { if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total); };
        xhr.onload = () => {
          let value;
          try { value = JSON.parse(xhr.responseText); } catch { reject(new Error('管理服务返回了无效响应。')); return; }
          if (xhr.status < 200 || xhr.status >= 300) {
            const error = new Error(value.error || `请求失败（${xhr.status}）`);
            error.status = xhr.status;
            reject(error); return;
          }
          if (value.csrf) token = value.csrf;
          resolve(value);
        };
        xhr.onerror = () => reject(new Error('上传失败，请检查网络连接。'));
        xhr.ontimeout = () => reject(new Error('上传超时，请重试。'));
        xhr.onabort = () => reject(new Error('上传已取消。'));
        xhr.send(file);
      });
    }
  };
}

// Keep editing synchronous while serializing server writes and tracking acknowledgement.
export function createRemoteRepository({ api, workspace, revision }) {
  let snapshot = workspace;
  let queued = null;
  let working = null;
  let error = '';
  const listeners = new Set();
  const emit = () => { for (const listener of listeners) listener(); };
  async function drain() {
    while (queued) {
      const candidate = queued;
      queued = null;
      try {
        const saved = await api.request('workspace', { method: 'PUT', body: { workspace: candidate, revision } });
        revision = saved.revision;
        snapshot = candidate;
        error = '';
      } catch (caught) {
        queued ??= candidate;
        error = caught.message;
        break;
      }
    }
  }
  function start() {
    if (working) return working;
    error = '';
    working = Promise.resolve().then(drain).finally(() => { working = null; emit(); });
    emit();
    return working;
  }
  return {
    get revision() { return revision; },
    get pending() { return Boolean(working || queued) && !error; },
    get error() { return error; },
    load() { return structuredClone(snapshot); },
    save(value) { queued = structuredClone(value); start(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async flush() { if (queued) await start(); else await working; return !error; }
  };
}
