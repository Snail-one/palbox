'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('../server.cjs');

test('Node.js 静态服务', async t => {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  await t.test('主页和页面入口正常响应', async () => {
    for (const route of ['/', '/index.html']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/html/);
      assert.match(await response.text(), /帕鲁配置工作台/);
    }
  });
  await t.test('样式、脚本、图标和浏览器测试页面可访问', async () => {
    for (const route of ['/styles.css', '/js/config.js', '/js/template.js', '/js/schema.js', '/js/storage.js', '/js/app.js', '/assets/favicon.svg', '/tests/index.html', '/tests/suite.js', '/tests/runner.js']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200, route);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.ok((await response.text()).length > 0);
    }
  });
  await t.test('HEAD 返回正确长度且没有响应正文', async () => {
    const get = await fetch(base + '/js/config.js');
    const head = await fetch(base + '/js/config.js', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), get.headers.get('content-length'));
    assert.equal(await head.text(), '');
  });
  await t.test('查询参数不影响静态资源加载', async () => {
    assert.equal((await fetch(base + '/styles.css?v=1')).status, 200);
  });
  await t.test('工作区元数据、源码和不存在的文件不可访问', async () => {
    for (const route of ['/.git/config', '/.aws/credentials', '/.codex/config.toml', '/server.cjs', '/package.json', '/README.md', '/tests/browser.cjs', '/missing', '/js/%2e%2e%2f.git%2fconfig']) {
      assert.equal((await fetch(base + route)).status, 404, route);
    }
  });
  await t.test('拒绝写入方法和无效路径编码', async () => {
    const response = await fetch(base + '/', { method: 'POST', body: 'ignored' });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
    assert.equal((await fetch(base + '/%zz')).status, 400);
  });
});
