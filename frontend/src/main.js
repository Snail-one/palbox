import { createApp } from './app.js';
import { createCatalog } from '../../shared/domain/catalog.js';
import { createClipboard } from './services/clipboard.js';
import { readConfigFile, validateImport } from './services/config-files.js';
import { createManagementClient, createRemoteRepository } from './services/management-api.js';

async function start() {
  const bootstrap = await fetch('/api/bootstrap', { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error('无法连接 Palbox 管理服务。'); return r.json(); });
  if (bootstrap.mode !== 'managed') throw new Error('请启动 Palbox 管理服务。');
  if (bootstrap.setupRequired) { window.location.replace('/setup.html'); return; }
  if (!bootstrap.authenticated) { window.location.replace('/login.html'); return; }
  const api = createManagementClient({ fetch: window.fetch.bind(window), csrf: bootstrap.csrf });
  const repository = createRemoteRepository({ api, ...await api.request('workspace') });
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
