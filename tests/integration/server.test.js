import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../../frontend/http-server.js';
import { createServer as createBackendServer } from '../../backend/http-server.js';

test('Node.js 静态服务', async t => {
  const backend = createBackendServer();
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  const apiBase = `http://127.0.0.1:${backend.address().port}`;
  const server = createServer({ apiUrl: apiBase });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    for (const service of [server, backend]) {
      service.closeAllConnections();
      await new Promise(resolve => service.close(resolve));
    }
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  await t.test('主页和页面入口正常响应', async () => {
    for (const route of ['/', '/index.html']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/html/);
      assert.match(await response.text(), /<title>Palbox · 幻兽帕鲁管理<\/title>/);
    }
  });
  await t.test('样式、脚本、图标和浏览器测试页面可访问', async () => {
    for (const route of ['/styles/index.css', '/shared/domain/config.js', '/shared/domain/template.js', '/shared/domain/schema.js', '/src/services/management-api.js', '/src/main.js', '/src/setup.js', '/src/ui/save-import-dialog.js', '/src/ui/args-dialog.js', '/setup.html', '/assets/favicon.svg', '/tests/index.html', '/tests/shared/core-cases.js', '/tests/browser/runner.js']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200, route);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.ok((await response.text()).length > 0);
    }
  });
  await t.test('没有管理后端时返回错误，不提供本地编辑模式', async () => {
    const response = await fetch(base + '/api/bootstrap');
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: '管理服务尚未初始化。' });
    assert.equal((await fetch(base + '/src/services/storage.js')).status, 404);
  });
  await t.test('HEAD 返回正确长度且没有响应正文', async () => {
    const get = await fetch(base + '/shared/domain/config.js');
    const head = await fetch(base + '/shared/domain/config.js', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), get.headers.get('content-length'));
    assert.equal(await head.text(), '');
  });
  await t.test('查询参数不影响静态资源加载', async () => {
    assert.equal((await fetch(base + '/styles/index.css?v=1')).status, 200);
  });
  await t.test('工作区元数据、源码和不存在的文件不可访问', async () => {
    for (const route of ['/.git/config', '/.aws/credentials', '/.codex/config.toml', '/backend/index.js', '/backend/management/auth.js', '/frontend/http-server.js', '/server/index.js', '/tests/unit/config.test.js', '/tests/integration/server.test.js', '/package.json', '/README.md', '/tests/browser.cjs', '/missing', '/js/%2e%2e%2f.git%2fconfig']) {
      assert.equal((await fetch(base + route)).status, 404, route);
    }
  });
  await t.test('拒绝写入方法和无效路径编码', async () => {
    const response = await fetch(base + '/', { method: 'POST', body: 'ignored' });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
    assert.equal((await fetch(base + '/%zz')).status, 400);
  });
  await t.test('后端只提供 API 和健康检查', async () => {
    assert.equal((await fetch(apiBase + '/healthz')).status, 200);
    for (const route of ['/', '/index.html', '/src/main.js', '/shared/domain/config.js', '/styles/index.css']) {
      assert.equal((await fetch(apiBase + route)).status, 404, route);
    }
  });
  await t.test('后端离线时静态页面仍可访问，API 返回 JSON 错误', async () => {
    backend.closeAllConnections();
    await new Promise(resolve => backend.close(resolve));
    assert.equal((await fetch(base)).status, 200);
    const response = await fetch(base + '/api/bootstrap');
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: '无法连接 Palbox 管理服务。' });
  });
});
