import { createManagementClient } from './services/management-api.js';

const api = createManagementClient({ fetch: window.fetch.bind(window) });
document.getElementById('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const error = document.getElementById('login-error');
  const button = event.currentTarget.querySelector('button');
  button.disabled = true; error.hidden = true;
  try {
    await api.request('login', { method: 'POST', body: { password: document.getElementById('login-password').value } });
    window.location.replace('/');
  } catch (caught) { error.textContent = caught.message; error.hidden = false; }
  finally { button.disabled = false; }
});
