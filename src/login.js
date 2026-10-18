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
document.getElementById('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const error = document.getElementById('login-error');
  const button = event.currentTarget.querySelector('button');
  button.disabled = true; error.hidden = true;
  try {
    await api.request('login', { method: 'POST', body: { username: document.getElementById('login-username').value.trim(), password: document.getElementById('login-password').value } });
    window.location.replace('/');
  } catch (caught) { error.textContent = caught.message; error.hidden = false; }
  finally { button.disabled = false; }
});
