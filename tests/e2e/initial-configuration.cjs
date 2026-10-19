'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const { managementFixture } = await import('../helpers/management-fixture.js');
  const { default: official } = await import('../../shared/domain/template.js');
  const browser = await chromium.launch({ headless: true });
  const fixtures = [];
  try {
    for (const manual of [false, true]) {
      const f = await managementFixture({ editable: false, officialDefaults: false });
      fixtures.push(f);
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.request.post(f.base + '/api/login', { data: { username: f.username, password: f.password } });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on('pageerror', error => { errors.push(error.message); console.error('页面错误：', error.message); });
      await page.goto(f.base + '/#configuration/profiles');
      const unavailable = page.locator('#profile-list .unavailable');
      await unavailable.waitFor();
      assert.equal(await page.locator('#profile-list .profile-item').count(), 1);
      assert.equal(await unavailable.locator('button').isDisabled(), true);
      assert.match(await unavailable.textContent(), /游戏默认配置.*未检测到/);
      assert.deepEqual(f.manager.store.workspace.profiles, []);
      assert.equal(await page.locator('#new-profile').isEnabled(), true);
      assert.equal(await page.locator('#import-button').isEnabled(), true);
      await page.locator('#nav-configuration-form').click();
      await page.waitForURL('**/#configuration');
      await page.locator('#configuration-empty').waitFor();
      assert.equal(await page.locator('#configuration-editor-content').isVisible(), false);
      await page.waitForFunction(() => document.querySelector('#game-config-state').textContent === '暂无配置');
      assert.equal(await page.locator('[data-action="apply"]').isDisabled(), true);
      await page.locator('#nav-configuration-profiles').click();
      let manualId;
      if (manual) {
        await page.locator('#new-profile').click();
        await page.locator('#dialog-name').fill('手动世界');
        await page.locator('#dialog-confirm').click();
        await page.waitForFunction(() => document.getElementById('profile-title').textContent === '手动世界' && document.getElementById('change-caption').textContent === '已保存');
        assert.equal(await page.locator('#source-editor').isEditable(), true);
        assert.equal(f.manager.store.workspace.profiles.length, 1);
        manualId = f.manager.store.active().id;
        // Keep a draft while detection occurs; automatic synchronization must preserve it.
        await page.locator('#source-editor').fill('OptionSettings=(ServerName="Draft")');
        await fs.writeFile(path.join(f.directory, 'server/DefaultPalWorldSettings.ini'), official);
        await page.waitForResponse(response => response.url().endsWith('/api/status') && response.status() === 200, { timeout: 12000 });
        assert.equal(await page.locator('#source-editor').inputValue(), 'OptionSettings=(ServerName="Draft")');
        await page.locator('#restore-source').click();
        await page.locator('#dialog-confirm').click();
      } else {
        await fs.writeFile(path.join(f.directory, 'server/DefaultPalWorldSettings.ini'), official);
      }
      // Detection refreshes the library without an explicit browser refresh.
      await page.locator('#nav-configuration-profiles').click();
      await page.waitForFunction(() => !document.querySelector('#profile-list .unavailable'), null, { timeout: 15000 });
      const expectedCount = manual ? 2 : 1;
      assert.equal(await page.locator('#profile-list .profile-item').count(), expectedCount);
      assert.equal(f.manager.store.workspace.profiles.length, expectedCount);
      assert.equal(f.manager.store.workspace.profiles.filter(profile => profile.locked).length, 1);
      if (manual) {
        assert.equal(f.manager.store.active().id, manualId);
        assert.equal(f.manager.store.active().name, '手动世界');
      } else {
        assert.equal(f.manager.store.active().name, '游戏默认配置');
        await page.locator('#nav-configuration-form').click();
        await page.locator('#configuration-editor-content').waitFor();
      }
      assert.deepEqual(errors, []);
      console.log(`PASS 首次部署无占位、灰色默认入口、自动检测${manual ? '、手动新建与草稿保留' : ''}`);
      await context.close();
    }
  } finally {
    await browser.close();
    for (const fixture of fixtures) await fixture.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
