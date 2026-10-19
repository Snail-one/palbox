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
function showPassword() {
  challenge = null; recovery = false;
  $('login-password-step').hidden = false; $('login-totp-step').hidden = true;
  $('login-username').required = true; $('login-password').required = true;
  $('login-code').required = false; $('login-code').value = ''; $('login-password').value = '';
  $('login-submit').textContent = '登录面板'; $('login-back').hidden = true;
  $('login-description').textContent = '输入管理员用户名和密码以继续。';
  $('login-error').hidden = true; $('login-password').focus();
}
function showCode() {
  $('login-password-step').hidden = true; $('login-totp-step').hidden = false;
  $('login-username').required = false; $('login-password').required = false;
  $('login-password').value = '';
  $('login-code').required = true; $('login-code').value = '';
  $('login-code').inputMode = recovery ? 'text' : 'numeric';
  $('login-code').maxLength = recovery ? 40 : 6;
  $('login-code').pattern = recovery ? '[A-Fa-f0-9-]{20,40}' : '[0-9]{6}';
  document.querySelector('label[for="login-code"]').textContent = recovery ? '一次性恢复码' : '6 位动态验证码';
  $('login-use-recovery').textContent = recovery ? '使用动态验证码' : '使用恢复码';
  $('login-submit').textContent = '验证并登录'; $('login-back').hidden = false;
  $('login-description').textContent = recovery ? '输入已保存的恢复码。每个恢复码只能使用一次。' : '输入验证器当前显示的动态验证码。';
  $('login-code').focus();
}
$('login-back').addEventListener('click', showPassword);
$('login-use-recovery').addEventListener('click', () => { recovery = !recovery; $('login-error').hidden = true; showCode(); });
$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('login-submit');
  button.disabled = true; $('login-back').disabled = true; $('login-use-recovery').disabled = true; $('login-error').hidden = true;
  try {
    if (challenge) {
      await api.request('login/totp', { method: 'POST', body: { challenge, code: $('login-code').value.trim() } });
      window.location.replace('/');
    } else {
      const result = await api.request('login', { method: 'POST', body: { username: $('login-username').value.trim(), password: $('login-password').value } });
      if (result.totpRequired) { challenge = result.challenge; showCode(); }
      else window.location.replace('/');
    }
  } catch (caught) { $('login-error').textContent = caught.message; $('login-error').hidden = false; }
  finally { button.disabled = false; $('login-back').disabled = false; $('login-use-recovery').disabled = false; }
});
