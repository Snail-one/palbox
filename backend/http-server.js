import http from 'node:http';

/** Backend exposes only the management API and its own health check. */
export function createServer({ api } = {}) {
  const server = http.createServer(async (request, response) => {
    const json = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
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
      if (response.headersSent) response.destroy();
      else json(500, { error: '管理服务发生错误。' });
    }
  });
  server.requestTimeout = 30 * 60 * 1000;
  return server;
}
