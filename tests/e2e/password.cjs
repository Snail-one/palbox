'use strict';
const { chromium } = require('../helpers/browser.cjs');
const assert = require('node:assert/strict');

(async () => {
  const { managementFixture } = await import('../helpers/management-fixture.js');
  const { totpCode } = await import('../../backend/management/totp.js');
  const f = await managementFixture({ editable: false, officialDefaults: false });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const openAccount = async () => {
      await page.locator('#account-security').click();
      await page.waitForFunction(() => !document.getElementById('account-password-button').disabled);
    };
    const fillPasswords = async (current, next, confirm = next) => {
      await page.locator('#password-current').fill(current);
      await page.locator('#password-new').fill(next);
      await page.locator('#password-confirm').fill(confirm);
    };
    const login = async password => {
      await page.locator('#login-username').fill(f.username);
      await page.locator('#login-password').fill(password);
      await page.locator('#login-submit').click();
    };
    await page.goto(f.base);
    await page.waitForURL('**/login.html');
    await login(f.password);
    await page.waitForURL(f.base + '/');
    await page.goto(f.base + '/#login-logs');
    await page.waitForFunction(() => document.getElementById('login-log-status').textContent.includes('实时更新'));
    const oldCookie = (await context.cookies()).find(cookie => cookie.name === 'palbox_session').value;
    await openAccount();
    assert.equal(await page.locator('#password-section').isVisible(), false);
    assert.equal(await page.locator('#security-section').isVisible(), false);
    assert.equal(await page.locator('#password-copy').count(), 0);
    await page.locator('#account-password-button').click();
    assert.equal(await page.locator('#password-code-field').isVisible(), false);
    let nextPassword = 'new-browser-password-456';
    await fillPasswords(f.password, nextPassword, 'mismatched-password');
    await page.locator('#password-submit').click();
    assert.equal(await page.locator('#password-confirm').evaluate(input => input.validity.customError), true);
    await page.locator('#password-generate').click();
    const firstGenerated = await page.locator('#password-new').inputValue();
    assert.match(firstGenerated, /^[a-f0-9]{48}$/);
    assert.equal(await page.locator('#password-confirm').inputValue(), firstGenerated);
    assert.equal(await page.locator('#password-confirm').evaluate(input => input.validity.customError), false);
    await page.locator('#password-generate').click();
    assert.notEqual(await page.locator('#password-new').inputValue(), firstGenerated);
    await page.locator('#password-new-reveal').click();
    assert.equal(await page.locator('#password-new').getAttribute('type'), 'text');
    assert.equal(await page.locator('#password-confirm').getAttribute('type'), 'password');
    await page.locator('#password-confirm-reveal').click();
    assert.equal(await page.locator('#password-confirm').getAttribute('type'), 'text');
    assert.equal(await page.locator('#password-current').getAttribute('type'), 'password');
    for (const id of ['password-current', 'password-new', 'password-confirm']) {
      const input = await page.locator('#' + id).boundingBox();
      const eye = await page.locator('#' + id + '-reveal').boundingBox();
      assert.ok(eye.x >= input.x && eye.x + eye.width <= input.x + input.width);
      assert.ok(Math.abs(eye.y + eye.height / 2 - input.y - input.height / 2) < 1);
    }
    await page.locator('#account-totp-button').click();
    assert.equal(await page.locator('#password-section').isVisible(), false);
    assert.equal(await page.locator('#security-section').isVisible(), true);
    assert.equal(await page.locator('#password-new').inputValue(), '');
    await page.locator('#security-password-reveal').click();
    assert.equal(await page.locator('#security-password').getAttribute('type'), 'text');
    await page.locator('#security-close').click();
    await openAccount();
    await page.locator('#account-password-button').click();
    assert.equal(await page.locator('#password-new').inputValue(), '');
    assert.equal(await page.locator('#password-new').getAttribute('type'), 'password');
    assert.equal(await page.locator('#password-new-reveal').getAttribute('aria-pressed'), 'false');
    await page.locator('#password-generate').click();
    nextPassword = await page.locator('#password-new').inputValue();
    await page.locator('#password-current').fill('wrong-password');
    await page.locator('#password-submit').click();
    await page.locator('#password-error').waitFor();
    assert.match(await page.locator('#password-error').textContent(), /密码不正确/);
    await page.locator('#password-current').fill(f.password);
    await page.locator('#password-submit').click();
    await page.waitForFunction(() => !document.getElementById('password-fields').disabled && document.getElementById('password-new').value === '');
    assert.notEqual((await context.cookies()).find(cookie => cookie.name === 'palbox_session').value, oldCookie);
    assert.equal((await fetch(f.base + '/api/settings', { headers: { Cookie: `palbox_session=${oldCookie}` } })).status, 401);
    await page.waitForFunction(() => document.getElementById('login-log-content').textContent.includes('管理员密码已修改'));
    assert.equal((await page.locator('#login-log-status').textContent()).includes('登录已失效'), false);
    console.log('PASS 按钮切换表单、输入框内独立小眼睛、随机生成、关闭清除、修改密码和日志重连');

    // Enable TOTP, then change the password using a recovery code on mobile.
    await page.locator('#account-totp-button').click();
    await page.locator('#security-password').fill(nextPassword);
    await page.locator('#security-submit').click();
    await page.locator('#security-setup').waitFor();
    assert.equal(await page.locator('#password-section').isVisible(), false);
    const secret = await page.locator('#security-secret').textContent();
    await page.locator('#security-code').fill(totpCode(secret, Math.floor(Date.now() / 30000) - 1));
    await page.locator('#security-submit').click();
    await page.locator('#security-recovery').waitFor();
    const codes = (await page.locator('#security-recovery-codes').textContent()).split('\n');
    await page.locator('#security-saved').click();
    await page.setViewportSize({ width: 390, height: 844 });
    // The mobile sidebar must be opened before its account action is available.
    await page.locator('#mobile-menu').click();
    await openAccount();
    await page.locator('#account-password-button').click();
    assert.equal(await page.locator('#password-code-field').isVisible(), true);
    await page.locator('#password-current').fill(nextPassword);
    await page.locator('#password-generate').click();
    const finalPassword = await page.locator('#password-new').inputValue();
    assert.match(finalPassword, /^[a-f0-9]{48}$/);
    assert.equal(await page.locator('#password-confirm').inputValue(), finalPassword);
    assert.equal(await page.locator('.account-password-tools').evaluate(element => element.scrollWidth <= element.clientWidth), true);
    assert.equal(await page.locator('#account-security-dialog').evaluate(element => element.scrollWidth <= element.clientWidth), true);
    await page.locator('#password-code').fill(codes[0]);
    await page.locator('#password-submit').click();
    await page.waitForFunction(() => document.getElementById('security-status').textContent.includes('剩余 9 个恢复码'));
    for (const id of ['password-current', 'password-new', 'password-confirm', 'password-code']) assert.equal(await page.locator('#' + id).inputValue(), '');
    await page.locator('#manager-logout').click();
    await page.waitForURL('**/login.html');
    await login(f.password);
    await page.locator('#login-error').waitFor();
    await login(finalPassword);
    await page.locator('#login-totp-step').waitFor();
    await page.locator('#login-use-recovery').click();
    await page.locator('#login-code').fill(codes[1]);
    await page.locator('#login-submit').click();
    await page.waitForURL(f.base + '/');
    assert.deepEqual(errors, []);
    console.log('PASS 移动端随机生成、二次验证修改密码和使用随机新密码重新登录');
  } finally {
    await browser?.close();
    await f.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
