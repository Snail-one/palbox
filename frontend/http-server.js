import http from 'node:http';
import https from 'node:https';
import { readFile, realpath } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trustedProxies } from '../shared/domain/trusted-proxies.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const securityHeaders = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
});
const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon']
]);

/**
 * Walk only explicitly trusted proxies, stopping at the nearest untrusted hop.
 * Direct clients cannot change their address by supplying forwarding headers.
 */
export function clientAddress(request, trusted = () => false) {
  const peer = request.socket.remoteAddress || '';
  if (!trusted(peer)) return peer;
  const forwarded = request.headers['x-forwarded-for'];
  const chain = typeof forwarded === 'string' ? forwarded.split(',').map(value => value.trim()) : [];
  // An invalid hop makes the chain ambiguous; do not silently skip it.
  if (chain.some(value => !isIP(value))) return '';
  if (chain.length) {
    for (let index = chain.length - 1; index >= 0; index--) {
      if (!trusted(chain[index])) return chain[index];
    }
    return chain[0];
  }
  const real = request.headers['x-real-ip'];
  if (typeof real === 'string' && isIP(real.trim())) return real.trim();
  if (forwarded !== undefined || real !== undefined) return '';
  return peer;
}

/** Publish browser assets and stream API traffic to the independent backend. */
export function createServer({ root = projectRoot, apiUrl = 'http://127.0.0.1:8081', trustedProxies: proxies = '' } = {}) {
  const trusted = trustedProxies(proxies);
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
    const headers = { 'Cache-Control': 'no-store' };
    const send = (status, text) => {
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(status, { ...securityHeaders, ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : text);
    };
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { send(400, 'Bad request'); return; }
    if (pathname === '/healthz' && request.method === 'GET') { send(200, 'ok'); return; }
    if (pathname.startsWith('/api/')) {
      proxy(request, response, upstream, trusted); return;
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
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(200, { ...securityHeaders, ...headers, 'Content-Type': contentTypes.get(extension), 'Content-Length': body.length });
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
function proxy(request, response, upstream, trusted) {
  const transport = upstream.protocol === 'https:' ? https : http;
  const forwarded = { ...request.headers };
  for (const name of (forwarded.connection || '').split(',')) delete forwarded[name.trim().toLowerCase()];
  for (const name of ['connection', 'keep-alive', 'proxy-authorization', 'proxy-authenticate', 'te', 'trailer', 'transfer-encoding', 'upgrade']) delete forwarded[name];
  const client = clientAddress(request, trusted);
  // Overwrite client-supplied values so the API can trust this header for
  // rate limiting, auditing and the first-run setup guard. Unknown values are
  // forwarded explicitly so the API never falls back to the proxy address.
  forwarded['x-palbox-client-ip'] = client || 'unknown';
  forwarded['x-forwarded-for'] = client || 'unknown';
  const pending = transport.request({
    protocol: upstream.protocol, hostname: upstream.hostname, port: upstream.port,
    method: request.method, path: request.url, headers: forwarded
  }, incoming => {
    if (response.destroyed || response.writableEnded) { incoming.destroy(); return; }
    response.writeHead(incoming.statusCode, { ...incoming.headers, ...securityHeaders });
    incoming.on('error', () => response.destroy());
    incoming.pipe(response);
  });
  pending.setTimeout(30 * 60 * 1000, () => pending.destroy(new Error('API timeout')));
  pending.on('error', () => {
    if (response.destroyed) return;
    if (response.headersSent) { response.destroy(); return; }
    response.writeHead(502, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ error: '无法连接 Palbox 管理服务。' }));
  });
  request.on('aborted', () => pending.destroy());
  request.on('error', () => pending.destroy());
  response.on('close', () => pending.destroy());
  request.pipe(pending);
}
