'use strict';
const { chromium, testOutput } = require('../helpers/browser.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const { managementFixture } = await import('../helpers/management-fixture.js');
  const { parse, decodeString } = await import('../../shared/domain/config.js');
  const { createProfile } = await import('../../shared/domain/workspace.js');
  // This case restores an imported baseline; an official default would replace it.
  const f = await managementFixture({ officialDefaults: false, editable: false });
  const source = '; 保留注释\nOptionSettings=(ExpRate=7.000000,ServerName="基准世界",ServerDescription="原描述",ServerPlayerMaxNum=32,AdminPassword="baseline-secret",DeathPenalty=All,bIsPvP=False,CrossplayPlatforms=(Steam,Xbox),FutureSetting=(A=1,B="原值"))\n';
  const profile = createProfile('自定义基准', source);
  f.manager.store.workspace.profiles.push(profile);
  f.manager.store.workspace.activeId = profile.id;
  await f.manager.store.persist();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.request.post(f.base + '/api/login', { data: { username: f.username, password: f.password } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const reset = key => page.locator(`[data-reset-field="${key}"]`);
    const search = key => page.locator('#search').fill(key);
    async function confirmReset(key) {
      await reset(key).click();
      await page.locator('#action-dialog').waitFor();
      await page.locator('#dialog-confirm').click();
    }
    async function saved() {
      await page.waitForFunction(() => document.getElementById('change-caption').textContent === '已保存');
    }
    async function badges(heading) {
      const sizes = await heading.evaluate(el => {
        const evidence = el.querySelector('.verification-badge'), modified = el.querySelector('.modified-badge');
        const a = evidence.getBoundingClientRect(), b = modified.getBoundingClientRect();
        return { height: [a.height, b.height], top: [a.top, b.top], order: Boolean(evidence.compareDocumentPosition(modified) & Node.DOCUMENT_POSITION_FOLLOWING) };
      });
      assert.equal(sizes.height[0], sizes.height[1]);
      assert.ok(Math.abs(sizes.top[0] - sizes.top[1]) < 1);
      assert.equal(sizes.order, true);
    }
    await page.goto(f.base + '/#configuration');
    await page.locator('#field-ServerName').waitFor();
    assert.equal(await reset('ServerName').count(), 0);
    await page.locator('#field-ServerPlayerMaxNum').fill('16');
    await page.locator('#field-ServerPlayerMaxNum').fill('1.5');
    await page.locator('#field-ServerName').fill('修改名称');
    await badges(page.locator('#field-ServerName').locator('..').locator('..').locator('.parameter-heading'));
    await reset('ServerName').click();
    await page.locator('#action-dialog').waitFor();
    assert.match(await page.locator('#dialog-title').textContent(), /服务器名称/);
    await page.locator('#dialog-cancel').click();
    assert.equal(await page.locator('#field-ServerName').inputValue(), '修改名称');
    assert.equal(await reset('ServerName').isEnabled(), true);
    const response = page.waitForResponse(value => value.url().endsWith('/api/workspace') && value.request().method() === 'PUT');
    await confirmReset('ServerName'); await response;
    assert.equal(await page.locator('#field-ServerName').inputValue(), '基准世界');
    assert.equal(await reset('ServerName').count(), 0);
    assert.equal(await page.locator('#field-ServerName').evaluate(el => el === document.activeElement), true);
    assert.equal(await page.locator('#field-ServerPlayerMaxNum').inputValue(), '1.5');
    assert.equal(await page.locator('#field-ServerPlayerMaxNum').getAttribute('aria-invalid'), 'true');
    const values = new Map(parse(f.manager.store.active().source).entries.map(entry => [entry.key, entry.raw]));
    assert.equal(decodeString(values.get('ServerName')), '基准世界');
    assert.equal(values.get('ServerPlayerMaxNum'), '16');
    await confirmReset('ServerPlayerMaxNum');
    await page.locator('#field-ServerDescription').fill('保留其他修改');

    await search('ExpRate');
    await page.locator('#field-ExpRate').fill('broken');
    assert.equal(await page.locator('.modified-badge').count(), 0);
    await page.locator('#field-ExpRate').fill('2.5');
    await badges(page.locator('#fields-grid .parameter-heading'));
    await page.locator('#field-ExpRate').fill('broken');
    await confirmReset('ExpRate');
    assert.equal(await page.locator('#field-ExpRate').inputValue(), '7.000000');
    assert.equal(await page.locator('#field-ExpRate').getAttribute('aria-invalid'), 'false');
    await search('bIsPvP');
    await page.locator('#field-bIsPvP').click();
    await badges(page.locator('#fields-grid .parameter-heading'));
    await confirmReset('bIsPvP');
    assert.equal(await page.locator('#field-bIsPvP').getAttribute('aria-checked'), 'false');
    await search('DeathPenalty');
    await page.locator('#field-DeathPenalty').selectOption('None');
    await confirmReset('DeathPenalty');
    assert.equal(await page.locator('#field-DeathPenalty').inputValue(), 'All');
    await search('CrossplayPlatforms');
    await page.getByRole('checkbox', { name: 'PS5', exact: true }).check();
    await confirmReset('CrossplayPlatforms');
    assert.equal(await page.getByRole('checkbox', { name: 'PS5', exact: true }).isChecked(), false);
    assert.equal(await page.getByRole('checkbox', { name: 'Steam', exact: true }).isChecked(), true);
    await search('AdminPassword');
    await page.locator('#field-AdminPassword').fill('changed-password');
    assert.ok(!(await reset('AdminPassword').getAttribute('title')).includes('baseline-secret'));
    await confirmReset('AdminPassword');
    assert.equal(await page.locator('#field-AdminPassword').inputValue(), 'baseline-secret');
    assert.equal(await page.locator('#field-AdminPassword').getAttribute('type'), 'password');
    console.log('PASS 单项恢复文本、数值、开关、枚举、平台和密码，清除错误并保留其他修改及焦点');

    await page.locator('#editor-mode-advanced').click();
    await search('FutureSetting');
    await page.locator('#raw-field-FutureSetting').fill('(A=2,B="新值")');
    await confirmReset('FutureSetting');
    assert.equal(await page.locator('#raw-field-FutureSetting').inputValue(), '(A=1,B="原值")');
    await search('ExpRate');
    await page.locator('#raw-field-ExpRate').fill('2');
    await badges(page.locator('#parameter-rows .parameter-heading'));
    await confirmReset('ExpRate');
    assert.equal(await page.locator('#raw-field-ExpRate').inputValue(), '7.000000');
    await saved();
    await page.reload();
    await page.locator('#parameter-rows').waitFor();
    await search('ExpRate');
    assert.equal(await page.locator('#raw-field-ExpRate').inputValue(), '7.000000');
    assert.equal(await reset('ExpRate').count(), 0);
    await page.locator('#editor-mode-form').click();
    await search('ServerDescription');
    assert.equal(await page.locator('#field-ServerDescription').inputValue(), '保留其他修改');
    await search('ServerName');
    await page.locator('#field-ServerName').fill('准备单项恢复');
    const output = testOutput('field-reset'); await fs.mkdir(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.getElementById('sidebar').getBoundingClientRect().right <= 0);
    await badges(page.locator('#fields-grid .parameter-heading'));
    assert.ok(await reset('ServerName').evaluate(el => el.getBoundingClientRect().height >= 36));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    await confirmReset('ServerName');
    assert.equal(await page.locator('#field-ServerName').inputValue(), '基准世界');
    assert.deepEqual(errors, []);
    console.log('PASS 高级参数和未知字段恢复、自动保存及刷新恢复；铭牌顺序、同高对齐与手机布局');
  } finally { await browser?.close(); await f.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
