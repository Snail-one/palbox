import { createServer } from './http-server.js';

try {
  const value = process.env.PORT || '8080';
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw new Error('PORT 必须是 1 到 65535 的整数。');
  const host = process.env.HOST || '127.0.0.1';
  const server = createServer({ apiUrl: process.env.PALBOX_API_URL || 'http://127.0.0.1:8081', trustedProxies: process.env.PALBOX_TRUSTED_PROXIES || '' });
  server.on('error', error => { console.error(`前端启动失败：${error.message}`); process.exitCode = 1; });
  server.listen(Number(value), host, () => console.log(`Palbox 前端已启动：http://${host}:${value}`));
  const close = () => { server.close(); server.closeAllConnections(); };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
} catch (error) {
  console.error(`前端启动失败：${error.message}`);
  process.exitCode = 1;
}
