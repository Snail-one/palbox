const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const { managementFixture } = await import('../helpers/management-fixture.js');
  const { nativeBackupFixture } = await import('../helpers/native-backup-fixture.js');
  const f = await managementFixture();
  let browser;
  try {
    await f.login();
    assert.equal((await f.task('install')).state, 'succeeded');
    const originalConfig = await fs.readFile(f.runtime.config, 'utf8');
    await nativeBackupFixture(f.runtime.saved, { worldId: 'SAVED_WORLD' });
    const id = await f.manager.backup('manual');
    const current = await nativeBackupFixture(f.runtime.saved, { worldId: 'CURRENT_WORLD' });
    const currentConfig = originalConfig + '\n; keep-current-config\n';
    await fs.writeFile(f.runtime.config, currentConfig);
    await fs.writeFile(path.join(current.world, 'old-only.sav'), 'remove');
    await fs.writeFile(path.join(f.runtime.saved, 'outside-world.txt'), 'keep-until-full');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.request.post(f.base + '/api/login', { data: { username: f.username, password: f.password } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(f.base + '/#saves/archives');
    const restore = () => page.locator('[data-backup-category="manual"] .backup-row').getByRole('button', { name: '恢复', exact: true });

    async function confirmMode(mode) {
      const submitted = page.waitForResponse(response => response.url().endsWith('/api/tasks') && response.request().method() === 'POST');
      await page.locator('#dialog-confirm').click();
      const response = await submitted;
      assert.equal(response.request().postDataJSON().mode, mode);
      assert.equal(response.request().postDataJSON().id, id);
      assert.equal(response.status(), 202);
      const task = await response.json();
      await f.manager.operation;
      const finished = f.manager.tasks.find(entry => entry.id === task.id);
      assert.equal(finished.state, 'succeeded', finished.message);
      await page.waitForFunction(() => !document.getElementById('refresh-status').disabled);
      await page.locator('#refresh-status').click();
    }

    await restore().click();
    const modes = page.getByRole('group', { name: '恢复方式', exact: true });
    const worldMode = modes.getByRole('button', { name: '存档恢复', exact: true });
    const fullMode = modes.getByRole('button', { name: '完整恢复', exact: true });
    assert.equal(await fullMode.getAttribute('aria-pressed'), 'true');
    assert.equal(await worldMode.getAttribute('aria-pressed'), 'false');
    assert.equal(await modes.locator('select').count(), 0);
    assert.match(await page.locator('#dialog-choice-description').textContent(), /整体替换 Pal\/Saved/);
    assert.equal(await page.locator('#action-dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true);
    await worldMode.click();
    assert.equal(await worldMode.getAttribute('aria-pressed'), 'true');
    await fullMode.focus();
    await fullMode.press('Enter');
    assert.equal(await fullMode.getAttribute('aria-pressed'), 'true');
    assert.equal(await worldMode.getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('#action-dialog').isVisible(), true);
    assert.equal(f.manager.tasks.filter(task => task.action === 'restore').length, 0);
    assert.equal(await fs.readFile(f.runtime.config, 'utf8'), currentConfig);
    assert.equal(await page.getByRole('button', { name: '恢复备份', exact: true }).isVisible(), true);
    await page.locator('#dialog-cancel').click();
    assert.equal(f.manager.tasks.filter(task => task.action === 'restore').length, 0);

    await restore().click();
    await worldMode.click();
    assert.equal(await worldMode.getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('#dialog-choice-description').textContent(), /清空并替换当前世界/);
    await confirmMode('world');
    assert.equal(await f.manager.targetWorld(), 'CURRENT_WORLD');
    const restoredConfig = await fs.readFile(f.runtime.config, 'utf8');
    assert.equal(restoredConfig, f.manager.store.active().source);
    assert.equal(f.manager.store.active().name, '游戏默认配置');
    assert.doesNotMatch(restoredConfig, /keep-current-config/);
    await assert.rejects(fs.access(path.join(current.world, 'old-only.sav')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(f.runtime.saved, 'outside-world.txt'), 'utf8'), 'keep-until-full');
    console.log('PASS 可选择存档恢复，确认后保留当前世界 ID 和外部配置');

    await page.waitForFunction(() => !document.querySelector('[data-backup-category="manual"] .backup-row button').disabled);
    await restore().click();
    assert.equal(await fullMode.getAttribute('aria-pressed'), 'true');
    assert.equal(await worldMode.getAttribute('aria-pressed'), 'false');
    assert.match(await page.locator('#dialog-choice-description').textContent(), /整体替换 Pal\/Saved/);
    assert.equal(f.manager.tasks.filter(task => task.action === 'restore').length, 1);
    assert.equal(await fs.readFile(f.runtime.config, 'utf8'), restoredConfig);
    await confirmMode('full');
    assert.equal(await f.manager.targetWorld(), 'CURRENT_WORLD');
    assert.equal(await fs.readFile(f.runtime.config, 'utf8'), restoredConfig);
    assert.deepEqual((await fs.readdir(path.join(f.runtime.saved, 'SaveGames/0'))).sort(), ['CURRENT_WORLD', 'SAVED_WORLD']);
    assert.equal(await fs.readFile(path.join(f.runtime.saved, 'outside-world.txt'), 'utf8'), 'keep-until-full');
    assert.equal(await fs.readFile(path.join(f.runtime.saved, 'SaveGames/0/SAVED_WORLD/Level.sav'), 'utf8'), 'current-world');
    assert.equal((await f.manager.backups()).filter(backup => backup.category === 'before-restore').length, 2);
    console.log('PASS 默认完整恢复写入备份配置并替换包内世界，保留其他世界和目录外文件');

    await page.waitForFunction(() => !document.querySelector('[data-backup-category="manual"] .backup-row button').disabled);
    await restore().click();
    assert.equal(await fullMode.getAttribute('aria-pressed'), 'true');
    await page.locator('#dialog-cancel').click();
    await page.locator('[data-backup-category="manual"] .backup-row').getByRole('button', { name: '删除', exact: true }).click();
    assert.equal(await page.locator('#dialog-choice-label').isVisible(), false);
    await page.locator('#dialog-cancel').click();
    assert.deepEqual(errors, []);
    console.log('PASS 再次恢复重置选择，其他确认窗口不显示恢复方式');
  } finally { await browser?.close(); await f.close(); }
})().catch(error => { console.error(error); process.exit(1); });
