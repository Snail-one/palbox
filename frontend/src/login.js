import { createManagementClient } from './services/management-api.js';

const api = createManagementClient({ fetch: window.fetch.bind(window) });
fetch('/api/bootstrap', { cache: 'no-store' })
  .then(response => response.ok ? response.json() : null)
  .then(bootstrap => {
    if (!bootstrap) return;
    if (bootstrap.setupRequired) window.location.replace('/setup.html');
    else if (bootstrap.authenticated) window.location.replace('/');
  })
  .catch(() => {});
const $ = id => document.getElementById(id);
let challenge = null;
let recovery = false;
let busy = false;
function resetCodeError() {
  $('login-error').hidden = true;
  $('login-code').setAttribute('aria-invalid', 'false');
}
function showPassword() {
  challenge = null; recovery = false;
  document.querySelector('.login-card').dataset.step = 'password';
  $('login-title').textContent = '管理你的帕鲁世界';
  $('login-verification-icon').hidden = true; $('login-progress').hidden = true; $('login-verification-options').hidden = true;
  $('login-password-step').hidden = false; $('login-totp-step').hidden = true;
  $('login-username').required = true; $('login-password').required = true;
  $('login-code').required = false; $('login-code').value = ''; $('login-password').value = '';
  $('login-submit').textContent = '登录面板'; $('login-back').hidden = true;
  $('login-description').textContent = '输入管理员用户名和密码以继续。';
  resetCodeError(); $('login-password').focus();
}
function showCode() {
  const card = document.querySelector('.login-card'); card.dataset.step = 'verification'; card.dataset.method = recovery ? 'recovery' : 'totp';
  $('login-title').textContent = recovery ? '使用恢复码' : '二次验证';
  $('login-verification-icon').hidden = false; $('login-progress').hidden = false; $('login-verification-options').hidden = false;
  $('login-account').textContent = `验证账号：${$('login-username').value.trim()}`;
  $('login-progress-method').textContent = recovery ? '恢复码验证' : '动态验证码';
  $('login-password-step').hidden = true; $('login-totp-step').hidden = false;
  $('login-username').required = false; $('login-password').required = false;
  $('login-password').value = '';
  $('login-code').required = true; $('login-code').value = '';
  $('login-code').inputMode = recovery ? 'text' : 'numeric';
  $('login-code').maxLength = recovery ? 40 : 6;
  $('login-code').pattern = recovery ? '[A-Fa-f0-9-]{20,40}' : '[0-9]{6}';
  $('login-code').placeholder = recovery ? '粘贴一次性恢复码' : '000000';
  $('login-code').autocomplete = recovery ? 'off' : 'one-time-code';
  document.querySelector('label[for="login-code"]').textContent = recovery ? '一次性恢复码' : '6 位动态验证码';
  $('login-use-recovery').textContent = recovery ? '使用动态验证码' : '使用恢复码';
  $('login-submit').textContent = '验证并登录'; $('login-back').hidden = false;
  $('login-description').textContent = recovery ? '使用已保存的恢复码完成安全验证。' : '密码已通过，请完成最后一步安全验证。';
  $('login-code-help').textContent = recovery ? '每个恢复码只能使用一次，请输入或粘贴完整内容。' : '打开验证器，输入当前显示的 6 位验证码。';
  $('login-alternative-hint').textContent = recovery ? '可以使用验证器？' : '无法使用验证器？';
  resetCodeError();
  $('login-code').focus();
}
$('login-back').addEventListener('click', showPassword);
$('login-use-recovery').addEventListener('click', () => { recovery = !recovery; $('login-error').hidden = true; showCode(); });
$('login-code').addEventListener('input', resetCodeError);
$('login-code').addEventListener('paste', event => {
  if (recovery) return;
  const code = event.clipboardData?.getData('text').normalize('NFKC').replace(/[\s-]/g, '');
  if (!/^\d{6}$/.test(code || '')) return;
  event.preventDefault(); $('login-code').value = code; resetCodeError();
});
$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  busy = true; $('login-form').setAttribute('aria-busy', 'true');
  const button = $('login-submit');
  button.disabled = true; button.textContent = challenge ? '正在验证…' : '正在登录…';
  $('login-back').disabled = true; $('login-use-recovery').disabled = true; resetCodeError();
  try {
    if (challenge) {
      await api.request('login/totp', { method: 'POST', body: { challenge, code: $('login-code').value.trim() } });
      window.location.replace('/');
    } else {
      const result = await api.request('login', { method: 'POST', body: { username: $('login-username').value.trim(), password: $('login-password').value } });
      if (result.totpRequired) { challenge = result.challenge; showCode(); }
      else window.location.replace('/');
    }
  } catch (caught) {
    $('login-error').textContent = caught.message; $('login-error').hidden = false;
    if (challenge) {
      $('login-code').setAttribute('aria-invalid', String(caught.status === 400 || caught.status === 401));
      $('login-code').focus(); $('login-code').select();
    }
  }
  finally {
    busy = false; $('login-form').setAttribute('aria-busy', 'false');
    button.disabled = false; button.textContent = challenge ? '验证并登录' : '登录面板';
    $('login-back').disabled = false; $('login-use-recovery').disabled = false;
  }
});
