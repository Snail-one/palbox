'use strict';
const { chromium } = require('../helpers/browser.cjs');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');

(async () => {
  const { managementFixture } = await import('../helpers/management-fixture.js');
  const f = await managementFixture({ setup: false });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const setupCode = f.manager.setupCode;
    await page.goto(f.base + '/');
    await page.waitForURL('**/setup.html');
    assert.equal(await page.locator('#setup-code').inputValue(), '');
    assert.equal(await page.locator('#setup-code').getAttribute('required'), '');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    const bootstrap = await context.request.get(f.base + '/api/bootstrap');
    assert.equal((await bootstrap.text()).includes(setupCode), false);

    await page.locator('#setup-username').fill(f.username);
    await page.locator('#setup-password').fill(f.password);
    await page.locator('#setup-confirm').fill(f.password);
    const incorrectCode = (setupCode[0] === '0' ? '1' : '0') + setupCode.slice(1);
    await page.locator('#setup-code').fill(incorrectCode);
    const rejected = page.waitForResponse(response => response.url().endsWith('/api/setup'));
    await page.getByRole('button', { name: '创建管理员' }).click();
    assert.equal((await rejected).status(), 403);
    await page.locator('#setup-error').waitFor();
    assert.match(await page.locator('#setup-error').textContent(), /初始化码不正确或已失效/);
    assert.equal(f.manager.needsSetup(), true);

    await page.locator('#setup-code').fill(setupCode);
    const accepted = page.waitForResponse(response => response.url().endsWith('/api/setup'));
    await page.getByRole('button', { name: '创建管理员' }).click();
    assert.equal((await accepted).status(), 201);
    await page.waitForURL('**/login.html');
    assert.equal(f.manager.setupCode, null);
    const before = await readFile(f.manager.settingsFile, 'utf8');
    const replay = await context.request.post(f.base + '/api/setup', {
      data: { username: 'replacement', password: 'replacement-password-123', setupCode }
    });
    assert.equal(replay.status(), 409);
    assert.equal(await readFile(f.manager.settingsFile, 'utf8'), before);
    await page.goto(f.base + '/setup.html');
    await page.waitForURL('**/login.html');
    assert.deepEqual(errors, []);
    console.log('PASS 一次性初始化码注册、错误提示、移动端布局、注册后失效和登录跳转');
  } finally {
    await browser?.close();
    await f.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
