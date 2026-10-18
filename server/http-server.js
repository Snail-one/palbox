import http from 'node:http';
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

/** Serve only browser-owned roots; server code and Node tests stay private. */
export function createServer({ root = projectRoot, api } = {}) {
  const mounts = [
    ['/src/', path.join(root, 'src'), new Set(['.js'])],
    ['/tests/browser/', path.join(root, 'tests/browser'), new Set(['.html', '.js'])],
    ['/tests/shared/', path.join(root, 'tests/shared'), new Set(['.js'])],
    ['/', path.join(root, 'public'), new Set(contentTypes.keys())]
  ];
  return http.createServer(async (request, response) => {
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
      if (api) { await api(request, response, pathname); return; }
      if (pathname === '/api/bootstrap' && request.method === 'GET') {
        response.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ mode: 'local' })); return;
      }
      send(404, 'Not found'); return;
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
}
