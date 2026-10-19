import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { Authentication } from './auth.js';
import { failure } from './files.js';
import { streamLogs } from './logs.js';
import { streamStatus } from './status-stream.js';
import { API_SECURITY_HEADERS } from '../security-headers.js';
import { isLoopbackOrPrivate } from '../../shared/domain/network.js';

const AUTH_BODY_TIMEOUT_MS = 10 * 1000;
const DEFAULT_BODY_TIMEOUT_MS = 120 * 1000;

/** Read a JSON object, enforcing both a size limit and an absolute deadline. */
export async function body(request, limit = 8 * 1024 * 1024, timeoutMs = DEFAULT_BODY_TIMEOUT_MS) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw failure('请求内容必须为 JSON。', 415);
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      request.destroy();
      reject(failure('请求内容读取超时。', 408));
    }, timeoutMs);
  });
  try {
    const reading = (async () => {
      let size = 0;
      const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > limit) throw failure('请求内容过大。', 413);
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    })();
    const buffer = await Promise.race([reading, expired]);
    try {
      const value = JSON.parse(buffer.toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      return value;
    } catch { throw failure('JSON 格式不正确。'); }
  } finally { clearTimeout(timer); }
}

export function createManagementApi(manager, options = {}) {
  const auth = new Authentication(() => manager.settings?.admin ?? null, {
    ...options,
    updateAdmin: (change, checks) => manager.updateAdmin(change, checks),
    log: options.log ?? (text => manager.runtime.log('login', text))
  });
  return async function api(request, response, pathname) {
    const json = (status, value) => {
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(status, { ...API_SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(value));
    };
    try {
      if (pathname === '/api/bootstrap' && request.method === 'GET') {
        const session = auth.session(request);
        let template;
        if (session) {
          try { template = await manager.store.defaultTemplate({ optional: true }); }
          catch { template = null; }
        }
        json(200, { mode: 'managed', authenticated: Boolean(session), ...(manager.needsSetup() ? { setupRequired: true } : {}), csrf: session?.csrf, template }); return;
      }
      if (pathname === '/api/setup' && request.method === 'POST') {
        auth.verifyOrigin(request);
        // The panel must be initialized from localhost or a trusted LAN;
        // public clients are rejected even if the port is exposed too early.
        if (!isLoopbackOrPrivate(auth.clientAddress(request))) throw failure('请在本机或可信内网完成管理员初始化。', 403);
        const input = await body(request, 4096, AUTH_BODY_TIMEOUT_MS);
        await manager.setupAdmin(input.username, input.password);
        json(201, { ok: true }); return;
      }
      if (pathname === '/api/login' && request.method === 'POST') {
        auth.verifyOrigin(request);
        const input = await body(request, 4096, AUTH_BODY_TIMEOUT_MS);
        json(200, await auth.login(request, input.username, input.password, response)); return;
      }
      if (pathname === '/api/login/totp' && request.method === 'POST') {
        auth.verifyOrigin(request);
        json(200, await auth.completeLogin(request, await body(request, 4096, AUTH_BODY_TIMEOUT_MS), response)); return;
      }
      auth.require(request, !['GET', 'HEAD'].includes(request.method));
      // Revalidate after body reads and inside queued writes, using this request's
      // original cookie and CSRF token so logout/rotation also revokes pending work.
      const checks = { authorize: () => auth.require(request, true) };
      if (pathname === '/api/security/password' && request.method === 'POST') {
        const input = await body(request, 16384, AUTH_BODY_TIMEOUT_MS);
        json(200, await auth.changePassword(request, input, response)); return;
      }
      if (pathname === '/api/security/totp' && request.method === 'GET') {
        json(200, auth.securityStatus()); return;
      }
      if (['/api/security/totp/setup', '/api/security/totp/enable', '/api/security/totp/disable', '/api/security/totp/recovery-codes'].includes(pathname) && request.method === 'POST') {
        const input = await body(request, 4096, AUTH_BODY_TIMEOUT_MS);
        if (pathname.endsWith('/setup')) json(200, await auth.beginEnrollment(request, input.password, response));
        else if (pathname.endsWith('/enable')) json(200, await auth.confirmEnrollment(request, input.code, response));
        else json(200, await auth.changeSecurity(request, input, response, pathname.endsWith('/disable')));
        return;
      }
      if (pathname === '/api/configuration-template' && request.method === 'GET') {
        json(200, await manager.store.newConfigurationTemplate()); return;
      }
      if (pathname === '/api/default-configuration' && request.method === 'GET') {
        json(200, { source: await manager.store.defaultTemplate() }); return;
      }
      if (pathname === '/api/save-import' && request.method === 'POST') {
        if (manager.closing) throw failure('管理服务正在关闭。', 503);
        if (manager.busy) throw failure('已有任务正在执行，请稍后再试。', 409);
        request.setTimeout(0);
        const staged = await manager.imports.receive(request, checks);
        try { checks.authorize(); }
        catch (error) { await manager.imports.remove(staged.id); throw error; }
        if (response.destroyed) { await manager.imports.remove(staged.id); return; }
        json(201, staged); return;
      }
      if (pathname === '/api/logout' && request.method === 'POST') { auth.logout(request, response); json(200, { ok: true }); return; }
      if (pathname === '/api/workspace') {
        if (request.method === 'GET') { await manager.store.syncDefaultProfile(); json(200, manager.store.snapshot()); return; }
        if (request.method === 'PUT') { const input = await body(request); json(200, await manager.store.update(input.workspace, input.revision, checks)); return; }
      }
      if (pathname === '/api/status/stream' && request.method === 'GET') {
        await streamStatus({ request, response, manager, auth }); return;
      }
      if (pathname === '/api/status' && request.method === 'GET') {
        const scope = new URL(request.url, 'http://localhost').searchParams.get('scope') || 'overview';
        json(200, await manager.status({ scope })); return;
      }
      if (pathname === '/api/running' && request.method === 'GET') { json(200, await manager.runningConfiguration()); return; }
      if (pathname === '/api/banned-players' && request.method === 'GET') { json(200, await manager.bannedPlayers()); return; }
      if (pathname === '/api/update-check' && request.method === 'GET') { json(200, await manager.updateInfo()); return; }
      if (pathname === '/api/tasks' && request.method === 'POST') {
        const input = await body(request, 8192);
        json(202, await manager.submit(input.action, input, checks)); return;
      }
      if (pathname === '/api/logs/stream' && request.method === 'GET') {
        const query = new URL(request.url, 'http://localhost').searchParams;
        const channel = query.get('channel') || 'palbox';
        await streamLogs({ request, response, runtime: manager.runtime, auth, channel, pages: query.get('format') === 'pages', after: request.headers['last-event-id'] || query.get('after') || undefined }); return;
      }
      if (pathname === '/api/logs/history' && request.method === 'GET') {
        const query = new URL(request.url, 'http://localhost').searchParams;
        const page = await manager.runtime.logPage(query.get('channel') || 'palbox', {
          ...(query.has('before') ? { before: query.get('before') } : {}),
          ...(query.has('after') ? { after: query.get('after') } : {})
        });
        auth.require(request);
        json(200, page); return;
      }
      if (pathname === '/api/logs' && request.method === 'GET') {
        const channel = new URL(request.url, 'http://localhost').searchParams.get('channel') || 'palbox';
        json(200, { text: await manager.runtime.logs(channel) }); return;
      }
      if (pathname === '/api/backups' && request.method === 'GET') { json(200, await manager.backups()); return; }
      if (pathname === '/api/native-backups' && request.method === 'GET') { json(200, await manager.nativeBackups()); return; }
      if (pathname === '/api/native-backup' && request.method === 'GET') {
        const archive = await manager.native.export(new URL(request.url, 'http://localhost').searchParams.get('id'));
        let handle;
        try {
          if (response.destroyed) { await archive.cleanup(); return; }
          handle = await open(archive.file, constants.O_RDONLY | constants.O_NOFOLLOW);
          const info = await handle.stat();
          if (response.destroyed) { await handle.close(); await archive.cleanup(); return; }
          response.writeHead(200, { ...API_SECURITY_HEADERS, 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${archive.filename}"`, 'Content-Length': info.size, 'Cache-Control': 'no-store' });
          const stream = handle.createReadStream();
          stream.on('error', () => response.destroy());
          stream.on('close', () => archive.cleanup().catch(error => manager.runtime.log('palbox', `${error.message}\n`)));
          response.on('close', () => stream.destroy());
          stream.pipe(response);
        } catch (error) { await handle?.close(); await archive.cleanup(); throw error; }
        return;
      }
      if (pathname === '/api/backup' && request.method === 'GET') {
        const id = new URL(request.url, 'http://localhost').searchParams.get('id');
        const handle = await manager.openBackup(id);
        const info = await handle.stat();
        if (!info.isFile()) { await handle.close(); throw failure('备份文件无效。', 404); }
        if (response.destroyed) { await handle.close(); return; }
        response.writeHead(200, { ...API_SECURITY_HEADERS, 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${id.split('/').at(-1)}"`, 'Content-Length': info.size, 'Cache-Control': 'no-store' });
        const stream = handle.createReadStream();
        stream.on('error', () => response.destroy()); response.on('close', () => stream.destroy()); stream.pipe(response); return;
      }
      if (pathname === '/api/settings') {
        if (request.method === 'GET') { json(200, manager.publicSettings()); return; }
        if (request.method === 'PUT') { json(200, await manager.updateSettings(await body(request, 65536), checks)); return; }
      }
      json(404, { error: '管理接口不存在。' });
    } catch (error) {
      if (request.complete === false && !response.headersSent && !response.destroyed) {
        // Allow the proxy to receive an early rejection before closing an
        // unfinished upload, while bounding how long its remaining body drains.
        const timer = setTimeout(() => request.destroy(), 1000);
        timer.unref();
        request.once('end', () => clearTimeout(timer));
        request.once('close', () => clearTimeout(timer));
      }
      if (!response.headersSent && !response.destroyed) json(error.status || (error.code === 'ENOENT' ? 404 : 500), { error: error.status ? error.message : '操作失败，请检查服务器日志。' });
      else response.destroy();
      if (!error.status) manager.runtime.log('palbox', `${error.stack || error}\n`);
    }
  };
}
