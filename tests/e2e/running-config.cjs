'use strict';
const { chromium, testOutput } = require('../helpers/browser.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const { managementFixture } = await import('../helpers/management-fixture.js');
  const f = await managementFixture();
  let browser;
  try {
    await f.login(); await f.task('install'); await f.task('start');
    const settings = {
      ServerName: '<img src=x onerror=alert(1)> 测试服务器', ServerDescription: '',
      ServerPlayerMaxNum: 32, ServerPassword: 'join-secret-123', AdminPassword: 'admin-secret-456',
      RESTAPIEnabled: true, RESTAPIPort: 8212, CrossplayPlatforms: ['Steam', 'PS5'],
      ExpRate: 2.75, bIsPvP: false, DeathPenalty: 'ItemAndEquipment',
      bEnableFastTravel: 'True', RandomizerType: 'UnexpectedMode',
      CustomNull: null, CustomZero: 0, CustomObject: { enabled: false, nested: [1, '<b>text</b>'] },
      CustomArray: [0, false, null, 'test']
    };
    const rest = f.runtime.rest.bind(f.runtime);
    let reads = 0, unavailable = false;
    f.runtime.rest = async (endpoint, body) => {
      if (endpoint !== 'settings') return rest(endpoint, body);
      reads++;
      if (unavailable) throw new Error('测试运行参数读取失败');
      return settings;
    };
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
    await context.request.post(f.base + '/api/login', { data: { username: f.username, password: f.password } });
    const page = await context.newPage();
    const errors = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() !== 'GET' && request.url().includes('/api/')) writes.push(request.url()); });
    await page.goto(f.base);
    await page.waitForFunction(() => !document.getElementById('show-running-config')?.disabled);
    const dialog = page.locator('#running-config-dialog');
    const card = key => dialog.locator(`[data-running-key="${key}"]`);
    const input = key => card(key).locator('input');
    await page.locator('#show-running-config').click(); await card('ExpRate').waitFor();
    assert.equal(reads, 1);
    assert.equal(await dialog.locator('[data-running-key]').count(), Object.keys(settings).length);
    assert.equal(await input('ExpRate').inputValue(), '2.75');
    assert.equal(await input('ExpRate').getAttribute('readonly'), '');
    assert.match(await card('ExpRate').textContent(), /经验获取倍率|经验值获得速度/);
    assert.equal(await input('ServerName').inputValue(), settings.ServerName);
    assert.equal(await dialog.locator('img').count(), 0);
    assert.equal(await input('ServerDescription').inputValue(), '');
    assert.equal(await input('CustomZero').inputValue(), '0');
    assert.equal(await input('CustomNull').inputValue(), 'null');
    assert.match(await card('RESTAPIEnabled').textContent(), /已开启.*true/);
    assert.match(await card('bIsPvP').textContent(), /已关闭.*false/);
    assert.match(await card('bEnableFastTravel').textContent(), /已开启.*"True"/);
    assert.equal(await card('CrossplayPlatforms').locator('.tag').count(), 2);
    assert.deepEqual(JSON.parse(await card('CustomObject').locator('pre').textContent()), settings.CustomObject);
    assert.deepEqual(JSON.parse(await card('CustomArray').locator('pre').textContent()), settings.CustomArray);
    assert.match(await card('DeathPenalty').textContent(), /掉落全部物品和装备/);
    assert.equal(await input('RandomizerType').inputValue(), 'UnexpectedMode');
    assert.equal(await input('ServerPassword').getAttribute('type'), 'password');
    await card('ServerPassword').getByRole('button', { name: '显示加入密码' }).click();
    assert.equal(await input('ServerPassword').getAttribute('type'), 'text');
    assert.equal(await input('AdminPassword').getAttribute('type'), 'password');
    await page.locator('#running-search').fill('经验');
    assert.equal(await dialog.locator('[data-running-key]').count(), 1);
    assert.equal(await input('ExpRate').inputValue(), '2.75');
    await page.locator('#running-search').fill('join-secret-123');
    assert.equal(await page.locator('#running-empty').isVisible(), true);
    await page.locator('#running-search').fill('');
    await page.locator('[data-running-category="other"]').click();
    assert.equal(await dialog.locator('[data-running-key]').count(), 4);
    await page.locator('[data-running-view="json"]').click();
    assert.deepEqual(JSON.parse(await page.locator('#running-source').inputValue()), settings);
    assert.equal(await page.locator('#running-source').getAttribute('readonly'), '');
    assert.equal(await page.locator('#running-visual').isVisible(), false);
    assert.equal(reads, 1, '搜索、分类和视图切换不会重新访问游戏');
    assert.deepEqual(writes, [], '运行参数的所有控件都不会保存或应用配置');
    await page.locator('#running-config-done').click();
    await page.waitForFunction(() => document.getElementById('running-source').value === '');
    assert.equal(await page.locator('#running-source').inputValue(), '');
    assert.equal(await dialog.locator('[data-running-key]').count(), 0);
    console.log('PASS 参数分类、中文说明、实际值、原始类型、空值、未知参数、密码显示与只读交互');

    unavailable = true;
    await page.locator('#show-running-config').click(); await page.locator('#running-config-error').waitFor();
    assert.match(await page.locator('#running-config-error').textContent(), /测试运行参数读取失败/);
    assert.equal(await page.locator('#running-config-content').isVisible(), false);
    assert.equal(await page.locator('#running-source').inputValue(), '');
    await page.locator('#running-config-close').click();
    unavailable = false;
    await page.locator('#show-running-config').click(); await card('ExpRate').waitFor();
    assert.equal(await input('ServerPassword').getAttribute('type'), 'password');
    const output = testOutput('running-config'); await fs.mkdir(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await page.locator('#running-search').fill('经验');
    assert.equal(await card('ExpRate').isVisible(), true);
    assert.equal(await card('ExpRate').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await page.screenshot({ path: path.join(output, 'mobile.png') });
    assert.deepEqual(errors, []);
    console.log('PASS 接口失败清空旧值，重新打开按需读取，关闭清理密码，桌面与手机布局正常');
  } finally { await browser?.close(); await f.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
