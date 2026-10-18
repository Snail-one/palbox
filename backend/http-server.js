import http from 'node:http';
import { API_SECURITY_HEADERS } from './security-headers.js';

/** Backend exposes only the management API and its own health check. */
export function createServer({ api } = {}) {
  const server = http.createServer(async (request, response) => {
    const json = (status, value) => {
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(status, { ...API_SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify(value));
    };
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { json(400, { error: '请求路径无效。' }); return; }
    if (pathname === '/healthz' && ['GET', 'HEAD'].includes(request.method)) { json(200, { ok: true }); return; }
    if (!pathname.startsWith('/api/')) { json(404, { error: '接口不存在。' }); return; }
    if (!api) { json(503, { error: '管理服务尚未初始化。' }); return; }
    try { await api(request, response, pathname); }
    catch {
      if (response.headersSent || response.destroyed) response.destroy();
      else json(500, { error: '管理服务发生错误。' });
    }
  });
  // Long uploads and event streams are bounded per request in the handlers;
  // JSON bodies additionally carry an absolute read deadline.
  server.requestTimeout = 30 * 60 * 1000;
  return server;
}
