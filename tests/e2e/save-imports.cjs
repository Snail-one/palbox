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
    const original = await nativeBackupFixture(f.runtime.saved, { worldId: 'ARCHIVED' });
    const fullArchive = path.join(f.directory, 'full-saved.tar.gz');
    await f.runtime.run('tar', ['-czf', fullArchive, '-C', f.runtime.server, '--', 'Pal/Saved']);
    await nativeBackupFixture(f.runtime.saved, { worldId: 'CURRENT' });
    await fs.writeFile(path.join(f.runtime.saved, 'remove-from-saved.txt'), 'old');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.request.post(f.base + '/api/login', { data: { username: f.username, password: f.password } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(f.base + '/#saves');

    async function importArchive(file) {
      const button = page.locator('[data-action="import-save"]');
      await page.waitForFunction(() => {
        const button = document.querySelector('[data-action="import-save"]');
        return button && !button.disabled;
      });
      await button.click();
      assert.match(await page.locator('#save-import-dialog').textContent(), /完整备份会整体替换 Pal\/Saved/);
      await page.locator('#save-import-file').setInputFiles(file);
      const submitted = page.waitForResponse(response => response.url().endsWith('/api/tasks') && response.request().method() === 'POST');
      await page.locator('#save-import-confirm').click();
      const response = await submitted;
      assert.equal(response.status(), 202);
      const task = await response.json();
      await f.manager.operation;
      const finished = f.manager.tasks.find(entry => entry.id === task.id);
      assert.equal(finished.state, 'succeeded', finished.message);
      await page.locator('#save-import-dialog').waitFor({ state: 'hidden' });
    }

    await importArchive(fullArchive);
    assert.deepEqual(await fs.readdir(path.join(f.runtime.saved, 'SaveGames/0')), ['ARCHIVED']);
    await assert.rejects(fs.access(path.join(f.runtime.saved, 'remove-from-saved.txt')), { code: 'ENOENT' });
    assert.equal(await f.manager.targetWorld(), 'ARCHIVED');
    assert.equal(await fs.readFile(path.join(original.snapshot, 'Level.sav'), 'utf8'), 'official-world');
    console.log('PASS 浏览器上传完整备份，整体替换 Saved 并恢复备份世界与历史');

    const source = path.join(f.directory, 'world-source/DIFFERENT_ID');
    await fs.mkdir(path.join(source, 'Players'), { recursive: true });
    await fs.mkdir(path.join(source, 'backup/world/imported'), { recursive: true });
    await fs.mkdir(path.join(source, 'empty-directory'));
    await fs.writeFile(path.join(source, 'Level.sav'), 'new-world');
    await fs.writeFile(path.join(source, 'LevelMeta.sav'), 'new-meta');
    await fs.writeFile(path.join(source, 'Players/new.sav'), 'new-player');
    await fs.writeFile(path.join(source, 'backup/world/imported/Level.sav'), 'new-history');
    await fs.writeFile(path.join(source, 'extra.txt'), 'extra-file');
    const worldArchive = path.join(f.directory, 'world-package.tar.gz');
    await f.runtime.run('tar', ['-czf', worldArchive, '-C', path.dirname(source), '--', 'DIFFERENT_ID']);
    const config = await fs.readFile(f.runtime.config);
    await importArchive(worldArchive);
    assert.equal(await f.manager.targetWorld(), 'ARCHIVED');
    assert.deepEqual(await fs.readdir(path.join(f.runtime.saved, 'SaveGames/0')), ['ARCHIVED']);
    assert.equal(await fs.readFile(path.join(original.world, 'Level.sav'), 'utf8'), 'new-world');
    assert.deepEqual(await fs.readdir(path.join(original.world, 'Players')), ['new.sav']);
    assert.deepEqual(await fs.readdir(path.join(original.world, 'backup/world')), ['imported']);
    assert.deepEqual(await fs.readdir(path.join(original.world, 'empty-directory')), []);
    assert.equal(await fs.readFile(path.join(original.world, 'extra.txt'), 'utf8'), 'extra-file');
    await assert.rejects(fs.access(path.join(original.world, 'WorldOption.sav')), { code: 'ENOENT' });
    assert.deepEqual(await fs.readFile(f.runtime.config), config);
    assert.equal((await f.manager.backups()).filter(entry => entry.category === 'before-import').length, 2);
    assert.equal(f.runtime.game, null);
    assert.deepEqual(errors, []);
    console.log('PASS 浏览器上传世界包，清空当前世界后写入玩家、包内历史、额外文件和空目录');
  } finally { await browser?.close(); await f.close(); }
})().catch(error => { console.error(error); process.exit(1); });
