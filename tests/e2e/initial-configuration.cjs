'use strict';
const { chromium } = require('../helpers/browser.cjs');
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
      // Without official defaults an import must fail without creating a partial profile.
      await page.locator('#import-button').click();
      await page.locator('#import-text').fill('OptionSettings=(ExpRate=3)');
      await page.locator('#import-name').fill('等待默认配置');
      await page.locator('#import-confirm').click();
      await page.locator('#import-error').waitFor();
      assert.match(await page.locator('#import-error').textContent(), /DefaultPalWorldSettings.ini.*安装服务端/);
      assert.equal(await page.locator('#import-dialog').isVisible(), true);
      assert.equal(await page.locator('#import-text').inputValue(), 'OptionSettings=(ExpRate=3)');
      assert.equal(await page.locator('#import-name').inputValue(), '等待默认配置');
      assert.equal(await page.locator('#import-confirm').isEnabled(), true);
      assert.deepEqual(f.manager.store.workspace.profiles, []);
      await page.locator('#import-cancel').click();
      let manualId;
      if (manual) {
        await page.locator('#new-profile').click();
        await page.locator('#dialog-name').fill('手动世界');
        await page.locator('#dialog-confirm').click();
        await page.waitForFunction(() => document.getElementById('profile-title').textContent === '手动世界' && document.getElementById('change-caption').textContent === '已保存');
        await page.locator('#editor-mode-advanced').click();
        await page.locator('#mode-source').click();
        assert.equal(await page.locator('#source-editor').isEditable(), false);
        assert.equal(f.manager.store.workspace.profiles.length, 1);
        manualId = f.manager.store.active().id;
        await fs.writeFile(path.join(f.directory, 'server/DefaultPalWorldSettings.ini'), official);
        const refreshed = page.waitForResponse(response => response.url().includes('/api/status?') && response.status() === 200);
        await page.locator('#refresh-status').click();
        await refreshed;
      } else {
        await fs.writeFile(path.join(f.directory, 'server/DefaultPalWorldSettings.ini'), official);
      }
      // Detection reloads the page when the official file appears. The list is empty until scripts render.
      await page.locator('#nav-configuration-form').click();
      await page.locator('#nav-configuration-profiles').click();
      const expectedCount = manual ? 2 : 1;
      await page.waitForFunction(expected => document.querySelectorAll('#profile-list .profile-item:not(.unavailable)').length === expected, expectedCount, { timeout: 15000 });
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
