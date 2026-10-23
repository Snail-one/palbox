'use strict';
const { chromium } = require('../helpers/browser.cjs');
const assert = require('node:assert/strict');

(async () => {
  const { managementFixture } = await import('../helpers/management-fixture.js');
  const f = await managementFixture();
  let browser;
  try {
    await f.login();
    await f.task('install'); await f.task('start');
    const calls = [];
    const rest = f.runtime.rest.bind(f.runtime);
    f.runtime.rest = (endpoint, body) => { calls.push(endpoint); return rest(endpoint, body); };
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.request.post(f.base + '/api/login', { data: { username: f.username, password: f.password } });
    const page = await context.newPage();
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/status') requests.push(request.url()); });
    await page.clock.install();
    await page.goto(f.base);
    const settled = () => page.waitForFunction(() => !document.getElementById('refresh-status')?.disabled);
    async function visit(selector, scope) {
      const response = page.waitForResponse(response => response.url().includes(`/api/status?scope=${scope}`));
      await page.locator(selector).click(); await response; await settled();
    }
    await page.waitForFunction(() => document.getElementById('game-fps')?.textContent === '60');
    await settled();
    assert.deepEqual(calls.splice(0).sort(), ['info', 'metrics', 'players']);
    const initialRequests = requests.length;
    await page.clock.runFor(16000);
    assert.deepEqual(calls, []);
    assert.equal(requests.length, initialRequests, '闲置超过旧轮询周期后没有新的状态请求');
    await page.locator('#refresh-status').click(); await settled();
    assert.deepEqual(calls.splice(0).sort(), ['info', 'metrics', 'players']);
    await visit('#nav-game-players', 'players');
    await page.waitForFunction(() => document.getElementById('manager-players-list').textContent.includes('steam_test'));
    await settled();
    assert.deepEqual(calls.splice(0), ['players']);
    await page.locator('#refresh-status').click(); await settled();
    assert.deepEqual(calls.splice(0), ['players']);
    await visit('#nav-configuration', 'local');
    await page.locator('#refresh-status').click(); await settled();
    assert.deepEqual(calls, []);
    await page.locator('#show-running-config').click();
    await page.waitForFunction(() => document.getElementById('running-source').value.startsWith('{'));
    assert.deepEqual(calls.splice(0), ['settings']);
    await page.locator('#running-config-done').click();
    await page.clock.runFor(16000);
    assert.deepEqual(calls, []);
    console.log('PASS 闲置不请求状态；概况、玩家、配置按需读取；运行参数只在打开时读取');

    // Task updates are pushed even when another client starts the task.
    await visit('#nav-game-players', 'players'); calls.length = 0;
    let finish;
    const execute = f.manager.execute;
    f.manager.execute = async () => { await new Promise(resolve => { finish = resolve; }); };
    const task = await f.manager.submit('save-world');
    await page.waitForFunction(() => document.querySelector('[data-action="start"]').disabled);
    f.manager.servicePhase('saving', '测试事件驱动的任务进度');
    await page.waitForFunction(() => document.getElementById('task-history-list').textContent.includes('测试事件驱动的任务进度'));
    assert.deepEqual(calls, [], '任务进度推送不读取游戏接口');
    const refreshed = page.waitForResponse(response => response.url().includes('/api/status?scope=players'));
    finish(); await f.manager.operation;
    await page.waitForFunction(id => document.querySelector('#task-history-list .backup-row')?.textContent.includes('已完成'), task.id);
    await refreshed;
    await settled();
    assert.deepEqual(calls.splice(0), ['players'], '任务完成只刷新当前页面的数据');
    f.manager.execute = execute;
    // Local process events must not erase an already loaded snapshot.
    await visit('#nav-game-overview', 'overview'); calls.length = 0;
    f.manager.changed();
    await page.clock.runFor(100);
    assert.equal(await page.locator('#game-fps').textContent(), '60');
    assert.deepEqual(calls, []);
    f.runtime.kill(f.runtime.game, 'SIGKILL');
    await page.waitForFunction(() => document.getElementById('game-state').textContent === '异常退出');
    assert.equal(await page.locator('#game-fps').textContent(), '—');
    assert.deepEqual(calls, []);
    // A restarted backend has its own revision sequence. Its snapshots must
    // replace the old instance, while late responses from that instance lose.
    const oldSnapshot = await f.manager.status({ scope: 'local' });
    f.runtime.lastExit = null; f.runtime.startedAt = null;
    f.manager.stateInstance = 'restarted-manager'; f.manager.stateRevision = 0;
    f.manager.changed();
    await page.waitForFunction(() => document.getElementById('game-state').textContent === '已安装');
    await page.route('**/api/status?scope=overview', route => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ ...oldSnapshot, stateRevision: 9999 })
    }), { times: 1 });
    await page.locator('#refresh-status').click(); await settled();
    assert.equal(await page.locator('#game-state').textContent(), '已安装');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('#refresh-status').isVisible(), true);
    assert.deepEqual(errors, []);
    console.log('PASS 任务进度与进程退出实时推送，完成时按页面刷新，重启后接受新状态并拒绝旧响应，手机布局正常');
  } finally { if (browser) await browser.close(); await f.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
