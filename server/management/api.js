import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { Authentication } from './auth.js';
import { failure } from './files.js';
import { managedTemplate } from './store.js';

async function body(request, limit = 8 * 1024 * 1024) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw failure('请求内容必须为 JSON。', 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of request) { size += chunk.length; if (size > limit) throw failure('请求内容过大。', 413); chunks.push(chunk); }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw failure('JSON 格式不正确。'); }
}

export function createManagementApi(manager, options = {}) {
  const auth = new Authentication(manager.settings.admin, options);
  return async function api(request, response, pathname) {
    const json = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(value));
    };
    try {
      if (pathname === '/api/bootstrap' && request.method === 'GET') {
        const session = auth.session(request);
        json(200, { mode: 'managed', authenticated: Boolean(session), csrf: session?.csrf, template: session ? managedTemplate(manager.runtime.port) : undefined }); return;
      }
      if (pathname === '/api/login' && request.method === 'POST') {
        auth.verifyOrigin(request);
        const input = await body(request, 4096);
        json(200, auth.login(request, input.password, response)); return;
      }
      auth.require(request, !['GET', 'HEAD'].includes(request.method));
      if (pathname === '/api/logout' && request.method === 'POST') { auth.logout(request, response); json(200, { ok: true }); return; }
      if (pathname === '/api/workspace') {
        if (request.method === 'GET') { json(200, manager.store.snapshot()); return; }
        if (request.method === 'PUT') { const input = await body(request); json(200, await manager.store.update(input.workspace, input.revision)); return; }
      }
      if (pathname === '/api/status' && request.method === 'GET') { json(200, await manager.status()); return; }
      if (pathname === '/api/tasks' && request.method === 'POST') {
        const input = await body(request, 8192);
        json(202, await manager.submit(input.action, input)); return;
      }
      if (pathname === '/api/logs' && request.method === 'GET') {
        const channel = new URL(request.url, 'http://localhost').searchParams.get('channel') || 'palbox';
        json(200, { text: await manager.runtime.logs(channel) }); return;
      }
      if (pathname === '/api/backups' && request.method === 'GET') { json(200, await manager.backups()); return; }
      if (pathname === '/api/backup' && request.method === 'GET') {
        const file = manager.backupFile(new URL(request.url, 'http://localhost').searchParams.get('id'));
        const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
        const info = await handle.stat();
        if (!info.isFile()) { await handle.close(); throw failure('备份文件无效。', 404); }
        response.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${file.split('/').at(-1)}"`, 'Content-Length': info.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        const stream = handle.createReadStream();
        stream.on('error', () => response.destroy()); response.on('close', () => stream.destroy()); stream.pipe(response); return;
      }
      if (pathname === '/api/settings') {
        if (request.method === 'GET') { json(200, manager.publicSettings()); return; }
        if (request.method === 'PUT') { json(200, await manager.updateSettings(await body(request, 4096))); return; }
      }
      json(404, { error: '管理接口不存在。' });
    } catch (error) {
      if (!response.headersSent) json(error.status || (error.code === 'ENOENT' ? 404 : 500), { error: error.status ? error.message : '操作失败，请检查服务器日志。' });
      else response.destroy();
      if (!error.status) manager.runtime.log('palbox', `${error.stack || error}\n`);
    }
  };
}
