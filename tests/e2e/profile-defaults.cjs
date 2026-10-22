const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const { managementFixture } = await import('../helpers/management-fixture.js');
  const { parse, applyManagedChanges } = await import('../../shared/domain/config.js');
  const f = await managementFixture();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.request.post(f.base + '/api/login', { data: { username: f.username, password: f.password } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(f.base + '/#configuration/profiles');
    await page.locator('#profile-list .profile-default-status[data-state="current"]').first().waitFor();
    assert.deepEqual(await page.locator('#profile-list .profile-default-status').allTextContents(), ['已同步最新默认配置', '已同步最新默认配置']);
    const official = page.getByRole('group', { name: '游戏默认配置', exact: true });
    await official.getByRole('button', { name: '选择', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#profile-title').textContent === '游戏默认配置');
    assert.equal(new URL(page.url()).hash, '#configuration/profiles');
    assert.equal(await page.locator('#configuration-profiles').isVisible(), true);
    await page.waitForFunction(() => document.querySelector('#change-caption').textContent === '已保存');
    await page.reload();
    await official.getByRole('button', { name: '已选择', exact: true }).waitFor();
    assert.equal(new URL(page.url()).hash, '#configuration/profiles');

    // File availability changes independently of the workspace revision.
    const file = path.join(f.directory, 'server/DefaultPalWorldSettings.ini');
    const source = await fs.readFile(file, 'utf8');
    const revision = f.manager.store.revision;
    async function refresh() {
      const status = page.waitForResponse(response => response.url().includes('/api/status?') && response.status() === 200);
      await page.locator('#refresh-status').click();
      await status;
    }
    await fs.rename(file, file + '.saved');
    await refresh();
    await page.locator('#profile-list .profile-default-status[data-state="unknown"]').first().waitFor();
    assert.equal(f.manager.store.revision, revision);
    assert.deepEqual(await page.locator('#profile-list .profile-default-status').allTextContents(), ['默认文件缺失，无法确认', '默认文件缺失，无法确认']);
    await fs.rename(file + '.saved', file);
    await refresh();
    await page.locator('#profile-list .profile-default-status[data-state="current"]').first().waitFor();

    // Keep an invalid draft open: the old page must show pending rather than
    // claiming its cached baseline is current after the official file changes.
    await page.locator('#nav-configuration-form').click();
    await page.locator('#field-ServerPlayerMaxNum').fill('1.5');
    await fs.writeFile(file, applyManagedChanges(source, new Map([['NewGameSetting', '10']])));
    await refresh();
    await page.waitForFunction(() => document.querySelector('#profile-default-status').dataset.state === 'pending');
    assert.equal(await page.locator('#field-ServerPlayerMaxNum').inputValue(), '1.5');
    await page.locator('#nav-configuration-profiles').click();
    assert.deepEqual(await page.locator('#profile-list .profile-default-status').allTextContents(), ['待同步最新默认配置', '待同步最新默认配置']);
    page.once('dialog', dialog => dialog.accept());
    await page.reload();
    await page.locator('#profile-list .profile-default-status[data-state="current"]').first().waitFor();
    for (const profile of f.manager.store.workspace.profiles) assert.equal(parse(profile.source).entries.find(entry => entry.key === 'NewGameSetting')?.raw, '10');

    await page.setViewportSize({ width: 390, height: 844 });
    const working = page.getByRole('group', { name: '我的帕鲁世界', exact: true });
    await working.getByRole('button', { name: '选择', exact: true }).click();
    await working.getByRole('button', { name: '已选择', exact: true }).waitFor();
    assert.equal(new URL(page.url()).hash, '#configuration/profiles');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const output = path.resolve('test-results/profile-defaults');
    await fs.mkdir(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS 每套配置显示最新默认同步状态，文件缺失和旧页面不会误标最新；桌面和手机选择配置均留在列表');
  } finally { await browser?.close(); await f.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
