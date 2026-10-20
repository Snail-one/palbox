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
    assert.equal(await page.getByLabel('恢复方式', { exact: true }).inputValue(), 'world');
    assert.match(await page.locator('#dialog-choice-description').textContent(), /清空并替换当前世界/);
    assert.equal(await page.locator('#action-dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true);
    await page.locator('#dialog-cancel').click();
    assert.equal(f.manager.tasks.filter(task => task.action === 'restore').length, 0);

    await restore().click();
    await confirmMode('world');
    assert.equal(await f.manager.targetWorld(), 'CURRENT_WORLD');
    assert.equal(await fs.readFile(f.runtime.config, 'utf8'), currentConfig);
    await assert.rejects(fs.access(path.join(current.world, 'old-only.sav')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(f.runtime.saved, 'outside-world.txt'), 'utf8'), 'keep-until-full');
    console.log('PASS 默认存档备份，可取消；确认后保留当前世界 ID 和外部配置');

    await page.waitForFunction(() => !document.querySelector('[data-backup-category="manual"] .backup-row button').disabled);
    await restore().click();
    await page.getByLabel('恢复方式', { exact: true }).selectOption('full');
    assert.match(await page.locator('#dialog-choice-description').textContent(), /整体替换 Pal\/Saved/);
    await confirmMode('full');
    assert.equal(await f.manager.targetWorld(), 'SAVED_WORLD');
    assert.equal(await fs.readFile(f.runtime.config, 'utf8'), originalConfig);
    assert.deepEqual(await fs.readdir(path.join(f.runtime.saved, 'SaveGames/0')), ['SAVED_WORLD']);
    await assert.rejects(fs.access(path.join(f.runtime.saved, 'outside-world.txt')), { code: 'ENOENT' });
    assert.equal((await f.manager.backups()).filter(backup => backup.category === 'before-restore').length, 2);
    console.log('PASS 可选择完整备份，即使当前世界有效也整体恢复 Saved 和备份配置');

    await page.waitForFunction(() => !document.querySelector('[data-backup-category="manual"] .backup-row button').disabled);
    await restore().click();
    assert.equal(await page.locator('#dialog-choice').inputValue(), 'world');
    await page.locator('#dialog-cancel').click();
    await page.locator('[data-backup-category="manual"] .backup-row').getByRole('button', { name: '删除', exact: true }).click();
    assert.equal(await page.locator('#dialog-choice-label').isVisible(), false);
    await page.locator('#dialog-cancel').click();
    assert.deepEqual(errors, []);
    console.log('PASS 再次恢复重置选择，其他确认窗口不显示恢复方式');
  } finally { await browser?.close(); await f.close(); }
})().catch(error => { console.error(error); process.exit(1); });
