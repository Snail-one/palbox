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
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Shanghai' });
    await context.addInitScript(() => {
      const Original = window.EventSource;
      window.logSources = [];
      window.EventSource = class extends Original {
        constructor(...args) { super(...args); if (String(args[0]).includes('/api/logs/stream')) window.logSources.push(this); }
      };
    });
    await context.request.post(f.base + '/api/login', { data: { username: f.username, password: f.password } });
    f.runtime.log('game', '\x1b[32m中文游戏日志🙂\x1b[0m\n进度 10%\r进度 20%\r\n');
    f.runtime.log('steamcmd', '\x1b[33m中文安装日志\x1b[0m\n');
    f.runtime.log('palbox', '面板任务日志\n');
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(f.base);
    const waitLog = text => page.waitForFunction(value => document.getElementById('manager-logs')?.textContent.includes(value), text, { timeout: 2500 });
    await waitLog('中文游戏日志🙂');
    assert.ok(pendingStatus.length, '状态接口应处于等待中');
    assert.equal(await page.locator('[data-log-channel="all"]').getAttribute('aria-pressed'), 'true');
    let combined = await page.locator('#manager-logs').textContent();
    assert.match(combined, /\[游戏\] 中文游戏日志🙂/);
    assert.match(combined, /\[游戏\] 进度 20%/);
    assert.match(combined, /\[安装更新\] 中文安装日志/);
    assert.match(combined, /\[面板\] 面板任务日志/);
    assert.ok(combined.indexOf('中文游戏日志') < combined.indexOf('中文安装日志'));
    assert.ok(combined.indexOf('中文安装日志') < combined.indexOf('面板任务日志'));
    assert.doesNotMatch(combined, /\x1b|\ufffd/);
    assert.match(combined, /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} UTC\] \[游戏\]/m);
    f.runtime.log('game', '状态查询未完成时仍实时追加\n');
    await waitLog('状态查询未完成时仍实时追加');
    f.runtime.log('steamcmd', '统一窗口中的实时安装更新\n');
    await waitLog('统一窗口中的实时安装更新');
    f.runtime.log('palbox', '统一窗口中的实时面板任务\n');
    await waitLog('统一窗口中的实时面板任务');
    assert.equal(await page.evaluate(() => window.logSources.filter(source => source.readyState === EventSource.OPEN).length), 1);
    console.log('PASS 默认统一窗口合并三个来源，仅一个实时连接，状态接口卡住时仍实时更新');

    await page.locator('[data-log-channel="steamcmd"]').click();
    await waitLog('中文安装日志');
    assert.match(await page.locator('#manager-logs').textContent(), /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} UTC\] 中文安装日志/m);
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
    await page.locator('[data-log-channel="all"]').click();
    await waitLog('统一窗口中的实时面板任务');
    combined = await page.locator('#manager-logs').textContent();
    assert.match(combined, /\[安装更新\] 统一窗口中的实时安装更新/);
    await page.locator('#nav-login-logs').click();
    const loginRecords = page.locator('#login-log-content');
    await loginRecords.locator('.login-log-badge.success').waitFor();
    f.runtime.log('login', '登录失败（2001:db8:85a3:0000:0000:8a2e:0370:7334，用户名 "<img src=x onerror=alert(1)>"）\n登录尝试过于频繁（192.0.2.1）\n');
    await loginRecords.locator('.login-log-badge.limited').waitFor();
    assert.equal(await loginRecords.locator('.login-log-badge').first().textContent(), '登录尝试过于频繁');
    assert.match(await page.locator('#login-log-status').textContent(), /本地时间（Asia\/Shanghai）/);
    assert.equal(await loginRecords.locator('.login-log-badge.failure').count(), 1);
    assert.match((await loginRecords.locator('.login-log-detail').allTextContents()).join('\n'), /<img src=x onerror=alert\(1\)>/);
    assert.equal(await loginRecords.locator('img').count(), 0);
    assert.equal(await loginRecords.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await loginRecords.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.deepEqual(errors, []);
    console.log('PASS 自动跟随底部、保留历史滚动位置、离开页面关闭连接并在返回时恢复');
    console.log('PASS 登录日志浅色列表、实时结果标记、用户名安全显示和手机布局');

    f.runtime.log('login', Array.from({ length: 3000 }, (_, index) => `登录成功（192.0.2.1，批量历史 ${index}）\n`).join(''));
    await page.waitForFunction(() => document.getElementById('login-log-content').textContent.includes('批量历史 2999'));
    assert.match(await loginRecords.textContent(), /<img src=x onerror=alert\(1\)>/);
    await page.locator('#login-log-latest').click();
    await page.waitForFunction(() => !document.getElementById('login-log-older').disabled);
    assert.doesNotMatch(await loginRecords.textContent(), /批量历史 0）/);
    for (let count = 0; count < 12 && !(await loginRecords.textContent()).includes('批量历史 0'); count++) {
      await page.locator('#login-log-older').click();
      await page.waitForFunction(() => document.getElementById('login-log-older').textContent !== '正在加载…');
    }
    assert.match(await loginRecords.textContent(), /批量历史 0/);
    assert.equal(await loginRecords.locator('tr').filter({ hasText: '批量历史 2999' }).count(), 1);

    await page.locator('#mobile-menu').click();
    await page.locator('#nav-game').click();
    await page.locator('[data-log-channel="game"]').click();
    f.runtime.log('game', '新增前已显示标记\n');
    await waitLog('新增前已显示标记');
    f.runtime.log('game', Array.from({ length: 2500 }, (_, index) => `大批实时日志 ${index} 中文🙂\n`).join(''));
    await page.waitForFunction(() => document.getElementById('manager-logs').textContent.includes('大批实时日志 2499'));
    assert.match(await panel.textContent(), /新增前已显示标记/);
    f.runtime.log('game', '[LOG] REST accessed endpoint /v1/api/settings OK\n\n玩家 connected the server.\n[LOG] REST accessed endpoint /v1/api/settings FAILED\n');
    await waitLog('玩家 connected the server.');
    assert.doesNotMatch(await panel.textContent(), /\/v1\/api\/settings OK/);
    assert.match(await panel.textContent(), /\/v1\/api\/settings FAILED/);
    await page.locator('.log-toggle').click();
    await waitLog('/v1/api/settings OK');
    await page.locator('.log-toggle').click();
    await page.waitForFunction(() => !document.getElementById('manager-logs').textContent.includes('/v1/api/settings OK'));
    await page.locator('#manager-log-latest').click();
    await page.waitForFunction(() => !document.getElementById('manager-log-older').disabled);
    assert.doesNotMatch(await panel.textContent(), /新增前已显示标记/);
    for (let count = 0; count < 12 && !(await panel.textContent()).includes('新增前已显示标记'); count++) {
      await page.locator('#manager-log-older').click();
      await page.waitForFunction(() => document.getElementById('manager-log-older').textContent !== '正在加载…');
    }
    assert.match(await panel.textContent(), /新增前已显示标记/);
    assert.doesNotMatch(await panel.textContent(), /\ufffd/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    console.log('PASS 超过 64 KiB 仍保留已显示记录，运行及登录日志可加载完整历史，settings 过滤随开关切换');
  } finally {
    for (const resolve of pendingStatus) resolve(baseline);
    await browser?.close();
    await f.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
