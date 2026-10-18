import { createManagementClient } from './services/management-api.js';

const api = createManagementClient({ fetch: window.fetch.bind(window) });
fetch('/api/bootstrap', { cache: 'no-store' })
  .then(response => response.ok ? response.json() : null)
  .then(bootstrap => {
    if (!bootstrap) return;
    if (bootstrap.authenticated) window.location.replace('/');
    else if (!bootstrap.setupRequired) window.location.replace('/login.html');
  })
  .catch(() => {});
document.getElementById('setup-form').addEventListener('submit', async event => {
  event.preventDefault();
  const error = document.getElementById('setup-error');
  const button = event.currentTarget.querySelector('button');
  const username = document.getElementById('setup-username').value.trim();
  const password = document.getElementById('setup-password').value;
  const confirmation = document.getElementById('setup-confirm').value;
  error.hidden = true;
  if (!username) { error.textContent = '请输入管理员用户名。'; error.hidden = false; return; }
  if (password.length < 12) { error.textContent = '管理密码至少需要 12 位。'; error.hidden = false; return; }
  if (password !== confirmation) { error.textContent = '两次输入的密码不一致。'; error.hidden = false; return; }
  button.disabled = true;
  try {
    await api.request('setup', { method: 'POST', body: { username, password } });
    window.location.replace('/login.html');
  } catch (caught) { error.textContent = caught.message; error.hidden = false; }
  finally { button.disabled = false; }
});
