import http from 'node:http';
import https from 'node:https';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon']
]);

/** Publish browser assets and stream API traffic to the independent backend. */
export function createServer({ root = projectRoot, apiUrl = 'http://127.0.0.1:8081' } = {}) {
  const upstream = new URL(apiUrl);
  if (!['http:', 'https:'].includes(upstream.protocol) || upstream.pathname !== '/' || upstream.search || upstream.hash || upstream.username || upstream.password) {
    throw new Error('PALBOX_API_URL 必须是 HTTP(S) 服务地址，不能包含路径、凭据或查询参数。');
  }
  const mounts = [
    ['/src/', path.join(root, 'frontend/src'), new Set(['.js'])],
    ['/shared/domain/', path.join(root, 'shared/domain'), new Set(['.js'])],
    ['/tests/browser/', path.join(root, 'tests/browser'), new Set(['.html', '.js'])],
    ['/tests/shared/', path.join(root, 'tests/shared'), new Set(['.js'])],
    ['/', path.join(root, 'frontend/public'), new Set(contentTypes.keys())]
  ];
  const server = http.createServer(async (request, response) => {
    const headers = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
    const send = (status, text) => {
      response.writeHead(status, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : text);
    };
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { send(400, 'Bad request'); return; }
    if (pathname === '/healthz' && request.method === 'GET') { send(200, 'ok'); return; }
    if (pathname.startsWith('/api/')) {
      proxy(request, response, upstream); return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      headers.Allow = 'GET, HEAD'; send(405, 'Method not allowed'); return;
    }
    if (pathname === '/') pathname = '/index.html';
    if (pathname === '/tests/index.html') pathname = '/tests/browser/index.html';
    if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(segment => segment.startsWith('.'))) {
      send(404, 'Not found'); return;
    }
    const [prefix, directory, allowedTypes] = mounts.find(([prefix]) => pathname.startsWith(prefix));
    const extension = path.extname(pathname);
    if (!allowedTypes.has(extension)) { send(404, 'Not found'); return; }
    try {
      const file = path.resolve(directory, pathname.slice(prefix.length));
      const resolved = await realpath(file);
      const allowedRoot = await realpath(directory);
      if (!resolved.startsWith(allowedRoot + path.sep)) { send(404, 'Not found'); return; }
      const body = await readFile(resolved);
      response.writeHead(200, { ...headers, 'Content-Type': contentTypes.get(extension), 'Content-Length': body.length });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (error) {
      send(['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code) ? 404 : 500, 'Unable to read asset');
    }
  });
  server.requestTimeout = 30 * 60 * 1000;
  return server;
}

// Preserve the public Host and Origin for same-origin authentication.
// Stream uploads and downloads without buffering save archives in memory.
function proxy(request, response, upstream) {
  const transport = upstream.protocol === 'https:' ? https : http;
  const forwarded = { ...request.headers };
  for (const name of (forwarded.connection || '').split(',')) delete forwarded[name.trim().toLowerCase()];
  for (const name of ['connection', 'keep-alive', 'proxy-authorization', 'proxy-authenticate', 'te', 'trailer', 'transfer-encoding', 'upgrade']) delete forwarded[name];
  const pending = transport.request({
    protocol: upstream.protocol, hostname: upstream.hostname, port: upstream.port,
    method: request.method, path: request.url, headers: forwarded
  }, incoming => {
    response.writeHead(incoming.statusCode, incoming.headers);
    incoming.on('error', () => response.destroy());
    incoming.pipe(response);
  });
  pending.setTimeout(30 * 60 * 1000, () => pending.destroy(new Error('API timeout')));
  pending.on('error', () => {
    if (response.destroyed) return;
    if (response.headersSent) { response.destroy(); return; }
    response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify({ error: '无法连接 Palbox 管理服务。' }));
  });
  request.on('aborted', () => pending.destroy());
  request.on('error', () => pending.destroy());
  response.on('close', () => pending.destroy());
  request.pipe(pending);
}
