import { createApp } from './app.js';
import { createCatalog } from './domain/catalog.js';
import { createRepository } from './services/storage.js';
import { createClipboard } from './services/clipboard.js';
import { readConfigFile, validateImport } from './services/config-files.js';
import { createManagementClient, createRemoteRepository } from './services/management-api.js';

async function start() {
  const bootstrap = await fetch('/api/bootstrap', { cache: 'no-store' }).then(r => { if (r.status === 404) return { mode: 'local' }; if (!r.ok) throw new Error('无法连接 Palbox 服务。'); return r.json(); });
  const api = bootstrap.mode === 'managed' ? createManagementClient({ fetch: window.fetch.bind(window), csrf: bootstrap.csrf }) : null;
  if (api && !bootstrap.authenticated) { window.location.replace('/login.html'); return; }
  const repository = api
    ? createRemoteRepository({ api, ...await api.request('workspace') })
    : createRepository(() => window.localStorage);
  createApp({
    document, window, catalog: createCatalog(bootstrap.template ? { source: bootstrap.template } : {}), repository, management: api,
    clipboard: createClipboard({ navigator, document }),
    files: { read: readConfigFile, validate: validateImport }
  });
}

start().catch(error => {
  const alert = document.getElementById('storage-error');
  alert.textContent = `加载失败：${error.message} 请刷新重试。`; alert.hidden = false;
});
