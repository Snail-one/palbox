'use strict';
const { chromium } = require('playwright');
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
      await page.waitForFunction(() => !document.getElementById('password-section').hidden);
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
    await page.locator('#password-section summary').click();
    assert.equal(await page.locator('#password-code-field').isVisible(), false);
    const nextPassword = 'new-browser-password-456';
    await fillPasswords(f.password, nextPassword, 'mismatched-password');
    await page.locator('#password-submit').click();
    assert.equal(await page.locator('#password-confirm').evaluate(input => input.validity.customError), true);
    await fillPasswords('wrong-password', nextPassword);
    await page.locator('#password-submit').click();
    await page.locator('#password-error').waitFor();
    assert.match(await page.locator('#password-error').textContent(), /密码不正确/);
    await fillPasswords(f.password, nextPassword);
    await page.locator('#password-submit').click();
    await page.waitForFunction(() => !document.getElementById('password-fields').disabled && document.getElementById('password-new').value === '');
    assert.notEqual((await context.cookies()).find(cookie => cookie.name === 'palbox_session').value, oldCookie);
    assert.equal((await fetch(f.base + '/api/settings', { headers: { Cookie: `palbox_session=${oldCookie}` } })).status, 401);
    await page.waitForFunction(() => document.getElementById('login-log-content').textContent.includes('管理员密码已修改'));
    assert.equal((await page.locator('#login-log-status').textContent()).includes('登录已失效'), false);
    console.log('PASS 密码确认、错误提示、密码修改、字段清除和日志会话重连');

    // Enable TOTP, then change the password using a recovery code on mobile.
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
    await page.locator('#password-section summary').click();
    assert.equal(await page.locator('#password-code-field').isVisible(), true);
    await fillPasswords(nextPassword, 'final-browser-password-789');
    await page.locator('#password-code').fill(codes[0]);
    await page.locator('#password-submit').click();
    await page.waitForFunction(() => document.getElementById('security-status').textContent.includes('剩余 9 个恢复码'));
    for (const id of ['password-current', 'password-new', 'password-confirm', 'password-code']) assert.equal(await page.locator('#' + id).inputValue(), '');
    await page.locator('#manager-logout').click();
    await page.waitForURL('**/login.html');
    await login(f.password);
    await page.locator('#login-error').waitFor();
    await login('final-browser-password-789');
    await page.locator('#login-totp-step').waitFor();
    await page.locator('#login-use-recovery').click();
    await page.locator('#login-code').fill(codes[1]);
    await page.locator('#login-submit').click();
    await page.waitForURL(f.base + '/');
    assert.deepEqual(errors, []);
    console.log('PASS 移动端二次验证修改密码、恢复码消费和新密码重新登录');
  } finally {
    await browser?.close();
    await f.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
