import { createServer } from './http-server.js';

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
