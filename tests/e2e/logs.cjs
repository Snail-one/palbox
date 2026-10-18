'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const { managementFixture } = await import('../helpers/management-fixture.js');
  const f = await managementFixture();
  const baseline = await f.manager.status();
  const pendingStatus = [];
  f.manager.status = () => new Promise(resolve => pendingStatus.push(resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript(() => {
      const Original = window.EventSource;
      window.logSources = [];
      window.EventSource = class extends Original {
        constructor(...args) { super(...args); window.logSources.push(this); }
      };
    });
    await context.request.post(f.base + '/api/login', { data: { username: f.username, password: f.password } });
    f.runtime.log('game', '\x1b[32m中文游戏日志🙂\x1b[0m\n进度 10%\r进度 20%\r\n');
    f.runtime.log('steamcmd', '\x1b[33m中文安装日志\x1b[0m\n');
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(f.base);
    const waitLog = text => page.waitForFunction(value => document.getElementById('manager-logs')?.textContent.includes(value), text, { timeout: 2500 });
    await waitLog('中文游戏日志🙂');
    assert.ok(pendingStatus.length, '状态接口应处于等待中');
    assert.equal(await page.locator('#manager-logs').textContent(), '中文游戏日志🙂\n进度 20%\n');
    f.runtime.log('game', '状态查询未完成时仍实时追加\n');
    await waitLog('状态查询未完成时仍实时追加');
    console.log('PASS 状态接口卡住时，中文日志仍实时更新，颜色和进度控制码正确显示');

    await page.locator('[data-log-channel="steamcmd"]').click();
    await waitLog('中文安装日志');
    assert.doesNotMatch(await page.locator('#manager-logs').textContent(), /中文游戏日志/);
    f.runtime.log('game', '旧频道追加不应污染当前频道\n');
    f.runtime.log('steamcmd', '当前安装频道实时追加\n');
    await waitLog('当前安装频道实时追加');
    assert.doesNotMatch(await page.locator('#manager-logs').textContent(), /旧频道/);
    f.backend.closeAllConnections();
    f.runtime.log('steamcmd', '连接恢复后补齐日志\n');
    await page.waitForFunction(() => document.getElementById('manager-logs').textContent.includes('连接恢复后补齐日志'), null, { timeout: 5000 });
    console.log('PASS 切换频道关闭旧连接，断线自动重连并补齐最新日志');

    await page.locator('[data-log-channel="game"]').click();
    f.runtime.log('game', Array.from({ length: 600 }, (_, i) => `历史日志第 ${i} 行\n`).join(''));
    await waitLog('历史日志第 599 行');
    const panel = page.locator('#manager-logs');
    assert.equal(await panel.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 30), true);
    await panel.evaluate(el => { el.scrollTop = 80; });
    f.runtime.log('game', '查看历史时的新日志\n');
    await waitLog('查看历史时的新日志');
    assert.ok(Math.abs(await panel.evaluate(el => el.scrollTop) - 80) < 2);
    await panel.evaluate(el => { el.scrollTop = el.scrollHeight; });
    f.runtime.log('game', '跟随底部的新日志\n');
    await waitLog('跟随底部的新日志');
    assert.equal(await panel.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 30), true);
    await page.locator('#nav-configuration').click();
    await page.waitForFunction(() => window.logSources.every(source => source.readyState === EventSource.CLOSED));
    await page.locator('#nav-game').click();
    await waitLog('跟随底部的新日志');
    await page.waitForFunction(() => window.logSources.filter(source => source.readyState === EventSource.OPEN).length === 1);
    assert.deepEqual(errors, []);
    console.log('PASS 自动跟随底部、保留历史滚动位置、离开页面关闭连接并在返回时恢复');
  } finally {
    for (const resolve of pendingStatus) resolve(baseline);
    await browser?.close();
    await f.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
