'use strict';
const http = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

// Only publish the application's static assets, never arbitrary workspace files.
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/assets/favicon.svg', ['assets/favicon.svg', 'image/svg+xml']],
  ...['config', 'template', 'schema', 'storage', 'app'].map(name => [`/js/${name}.js`, [`js/${name}.js`, 'text/javascript; charset=utf-8']]),
  ['/tests/index.html', ['tests/index.html', 'text/html; charset=utf-8']],
  ...['suite', 'runner'].map(name => [`/tests/${name}.js`, [`tests/${name}.js`, 'text/javascript; charset=utf-8']])
]);

function createServer() {
  return http.createServer(async (request, response) => {
    const headers = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { ...headers, Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Method not allowed');
      return;
    }
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch {
      response.writeHead(400, headers); response.end('Bad request'); return;
    }
    const file = files.get(pathname);
    if (!file) {
      response.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : 'Not found');
      return;
    }
    try {
      const body = await readFile(path.join(__dirname, file[0]));
      response.writeHead(200, { ...headers, 'Content-Type': file[1], 'Content-Length': body.length });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500, headers);
      response.end(request.method === 'HEAD' ? undefined : 'Unable to read asset');
    }
  });
}

if (require.main === module) {
  const value = process.env.PORT || '8080';
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT 必须是 1 到 65535 的整数。');
    process.exitCode = 1;
  } else {
    const server = createServer();
    server.on('error', error => {
      console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，请设置其他 PORT 后重试。` : `启动失败：${error.message}`);
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => console.log(`Palbox 已启动：http://127.0.0.1:${port}\n按 Ctrl+C 停止。`));
  }
}

module.exports = { createServer };
