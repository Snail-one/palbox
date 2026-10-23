'use strict';
const { chromium, testOutput } = require('../helpers/browser.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const { managementFixture } = await import('../helpers/management-fixture.js');
  const { steamcmdArchive } = await import('../helpers/steamcmd-fixture.js');
  const { defaultSteamcmd, installSteamcmd } = await import('../../backend/management/steamcmd.js');
  const f = await managementFixture();
  let release;
  let browser;
  try {
    const archive = await steamcmdArchive(f.directory, { gameInstaller: f.runtime.steamcmd });
    f.runtime.steamcmd = defaultSteamcmd(f.directory);
    let attempt = 0;
    const gate = new Promise(resolve => { release = resolve; });
    f.runtime.installSteamcmd = options => installSteamcmd(f.runtime, { ...options, fetch: async () => {
      if (++attempt === 1) return new Response('', { status: 503 });
      const body = new ReadableStream({ async start(controller) {
        await new Promise(resolve => setTimeout(resolve, 1100));
        const half = Math.ceil(archive.length / 2);
        controller.enqueue(archive.subarray(0, half));
        await gate;
        controller.enqueue(archive.subarray(half)); controller.close();
      } });
      return new Response(body, { headers: { 'Content-Length': String(archive.length) } });
    } });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.request.post(f.base + '/api/login', { data: { username: f.username, password: f.password } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(f.base);
    const steamcmd = page.locator('[data-action="install-steamcmd"]');
    const game = page.locator('[data-action="install"]');
    await steamcmd.waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('[data-action="install-steamcmd"]').disabled);
    assert.equal(await game.isDisabled(), true);
    const output = testOutput('steamcmd');
    await fs.mkdir(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'missing-desktop.png'), fullPage: true });
    await steamcmd.click();
    await page.waitForFunction(() => document.getElementById('game-state').textContent === 'SteamCMD 安装失败');
    assert.equal(await steamcmd.isDisabled(), false);
    assert.match(await page.locator('#task-history-list').textContent(), /HTTP 503/);
    await steamcmd.click();
    await page.waitForFunction(() => document.querySelector('[data-action="install-steamcmd"]').textContent === '正在安装 SteamCMD…');
    assert.equal(await steamcmd.isDisabled(), true);
    assert.equal(await game.isDisabled(), true);
    await page.locator('[data-log-channel="steamcmd"]').click();
    await page.waitForFunction(() => /安装包：.*50%/.test(document.getElementById('manager-logs').textContent));
    assert.match(await page.locator('#game-state').getAttribute('title'), /50%/, '任务状态同步下载进度');
    assert.ok(!(await page.locator('#manager-logs').textContent()).includes('安装包下载完成'), '下载未结束时不显示完成');
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.locator('#mobile-menu').getAttribute('aria-expanded') === 'true') await page.locator('#mobile-menu').click();
    await page.waitForFunction(() => document.getElementById('sidebar').getBoundingClientRect().right <= 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, 'installing-mobile.png'), fullPage: true });
    release();
    await steamcmd.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => /安装包下载完成：.*100%/.test(document.getElementById('manager-logs').textContent));
    await page.waitForFunction(() => !document.querySelector('[data-action="install"]').disabled);
    assert.match(await page.locator('#task-history-list').textContent(), /安装 SteamCMD · 已完成/);
    await game.click();
    await page.waitForFunction(() => document.getElementById('task-history-list').textContent.includes('安装服务端 · 已完成'));
    assert.equal((await f.manager.status()).installed, true);
    assert.deepEqual(errors, []);
    console.log('PASS 网页安装 SteamCMD：失败重试、安装包实时大小与百分比、任务状态同步、下载完成提示、互斥、手机布局及后续游戏安装');
  } finally {
    release?.();
    await browser?.close();
    await f.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
