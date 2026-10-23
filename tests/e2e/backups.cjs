'use strict';
const { chromium, testOutput } = require('../helpers/browser.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const { managementFixture } = await import('../helpers/management-fixture.js');
  const { nativeBackupFixture } = await import('../helpers/native-backup-fixture.js');
  const categories = ['manual', 'before-restore', 'before-import', 'before-reset'];
  const savedWorld = '0123456789ABCDEF0123456789ABCDEF';
  const currentWorld = 'FEDCBA9876543210FEDCBA9876543210';
  const f = await managementFixture();
  let browser;
  try {
    await f.manager.ensureConfig();
    await nativeBackupFixture(f.runtime.saved, { worldId: savedWorld });
    const original = await f.manager.backup('manual');
    const sample = await fs.readFile(f.manager.backupFile(original));
    await f.manager.deleteBackup(original);
    for (const timestamp of ['2026.10.19-12.00.00', '2026.10.19-12.01.00', '2026.10.19-12.02.00']) {
      await nativeBackupFixture(f.runtime.saved, { worldId: currentWorld, timestamp });
    }
    for (const category of categories) for (let index = 1; index <= 11; index++) {
      const file = path.join(f.directory, 'backups', category, `preview-${index}.tar.gz`);
      await fs.writeFile(file, sample);
      const at = new Date(Date.UTC(2026, 9, 19, 12, 0, index));
      await fs.utimes(file, at, at);
    }
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await context.request.post(f.base + '/api/login', { data: { username: f.username, password: f.password } });
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const group = category => page.locator(`[data-backup-category="${category}"]`);
    const pagination = category => group(category).locator('.backup-category-pagination');
    async function assertPage(category, number, count) {
      await page.waitForFunction(({ category, number, count }) => {
        const card = document.querySelector(`[data-backup-category="${category}"]`);
        return card?.querySelector('[aria-current="page"]')?.textContent === String(number) && card.querySelectorAll('.backup-row').length === count;
      }, { category, number, count });
    }
    async function assertPageFits(category) {
      const { height, content, lastBottom, bottom } = await group(category).locator('.backup-category-entries').evaluate(list => ({
        height: list.clientHeight, content: list.scrollHeight,
        lastBottom: list.lastElementChild.getBoundingClientRect().bottom, bottom: list.getBoundingClientRect().bottom
      }));
      assert.ok(content <= height + 1, `${category} should show the whole page without internal scrolling`);
      assert.ok(lastBottom <= bottom + 1);
    }
    async function refresh() {
      const received = page.waitForResponse(response => response.url().endsWith('/api/backups'));
      await page.locator('#refresh-status').click();
      await received;
      await page.waitForFunction(() => !document.getElementById('refresh-status').disabled);
    }
    await page.goto(f.base + '/#saves/archives');
    for (const category of categories) {
      await assertPage(category, 1, 5);
      assert.match(await pagination(category).textContent(), /1 \/ 3 页 · 共 11 份/);
      assert.equal(await pagination(category).getByRole('button', { name: '上一页', exact: true }).isDisabled(), true);
      await assertPageFits(category);
      assert.equal(await group(category).locator('.backup-entry-world code').first().textContent(), savedWorld);
    }
    const output = testOutput('backups');
    await fs.mkdir(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    await page.locator('#backup-page-manual-3').click();
    await assertPage('manual', 3, 1);
    assert.equal(await group('manual').locator('.backup-row').getAttribute('data-backup-id'), 'manual/preview-1.tar.gz');
    assert.equal(await pagination('manual').getByRole('button', { name: '下一页', exact: true }).isDisabled(), true);
    await assertPage('before-import', 1, 5);
    await page.locator('#backup-page-before-restore-2').click();
    await pagination('before-import').getByRole('button', { name: '下一页', exact: true }).click();
    await page.locator('#backup-page-before-reset-2').click();
    await refresh();
    await assertPage('manual', 3, 1);
    for (const category of categories.slice(1)) await assertPage(category, 2, 5);
    await group('manual').locator('.backup-entry-actions').getByRole('button', { name: '删除', exact: true }).click();
    await page.locator('#dialog-confirm').click();
    await assertPage('manual', 2, 5);
    await assert.rejects(fs.access(path.join(f.directory, 'backups/manual/preview-1.tar.gz.json')), { code: 'ENOENT' });
    assert.match(await pagination('manual').textContent(), /2 \/ 2 页 · 共 10 份/);
    await assertPage('before-restore', 2, 5);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const category of categories) await assertPageFits(category);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 320, height: 740 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const retained = (await f.manager.backups()).filter(backup => backup.category === 'before-reset');
    await Promise.all(retained.map(backup => fs.unlink(f.manager.backupFile(backup.id))));
    await refresh();
    assert.equal(await group('before-reset').locator('.backup-row').count(), 0);
    assert.equal(await pagination('before-reset').count(), 0);
    assert.equal(await group('before-reset').locator('.backup-category-empty').isVisible(), true);
    await assertPage('before-import', 2, 5);
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.locator('#nav-saves-native').click();
    await page.locator('.native-backup-card').first().waitFor();
    const columns = () => page.locator('.native-backup-grid').evaluate(grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length);
    assert.equal(await columns(), 3);
    await page.screenshot({ path: path.join(output, 'native-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 1024, height: 900 });
    assert.equal(await columns(), 2);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await columns(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, 'native-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS 世界备份每页 5 条、历史世界 ID、独立分页和删除回退；官方备份宽屏三列、窄屏两列、手机单列');
  } finally {
    await browser?.close();
    await f.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
