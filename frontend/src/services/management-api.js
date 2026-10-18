export function createManagementClient({ fetch, csrf = '' }) {
  let token = csrf;
  return {
    async request(path, { method = 'GET', body } = {}) {
      const response = await fetch('/api/' + path, {
        method, credentials: 'same-origin', cache: 'no-store',
        signal: AbortSignal.timeout(20000),
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
      if (value.csrf) token = value.csrf;
      return value;
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
    remote: true,
    get revision() { return revision; },
    get pending() { return Boolean(working || queued) && !error; },
    get error() { return error; },
    load() { return structuredClone(snapshot); },
    save(value) { queued = structuredClone(value); start(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async flush() { if (queued) await start(); else await working; return !error; }
  };
}
