import { totpQrImage } from './totp-qr.js';
import { generateRandomPassword } from './components/admin-password.js';

export function createAccountSecurity({ dom, api, clipboard, notify }) {
  const { $, document, icon } = dom;
  const button = document.createElement('button');
  button.id = 'account-security'; button.type = 'button'; button.className = 'button secondary';
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-controls', 'account-security-dialog');
  button.append(icon('shield'), document.createTextNode('账号'));
  $('account-actions').prepend(button);
  const dialog = document.createElement('dialog');
  dialog.id = 'account-security-dialog'; dialog.className = 'import-dialog account-security-dialog';
  dialog.setAttribute('aria-labelledby', 'account-security-title');
  function passwordField(id, label, autocomplete, attributes = '') {
    return `<label class="dialog-name-label" for="${id}">${label}<span class="input-wrap account-password-input"><input id="${id}" type="password" autocomplete="${autocomplete}" required maxlength="1024" ${attributes}><button id="${id}-reveal" type="button" class="icon-button reveal-button" data-password-input="${id}" data-password-label="${label}" aria-label="显示${label}" aria-controls="${id}" aria-pressed="false"><svg class="icon" aria-hidden="true"><use href="#i-eye"/></svg></button></span></label>`;
  }
  dialog.innerHTML = `<div class="dialog-heading"><span class="dialog-icon"><svg class="icon" aria-hidden="true"><use href="#i-shield"/></svg></span><button type="button" class="icon-button" id="security-close" aria-label="关闭账号"><svg class="icon" aria-hidden="true"><use href="#i-close"/></svg></button></div>
    <h2 id="account-security-title">账号</h2>
    <p id="security-username" class="management-note"></p>
    <div class="account-settings-actions" role="group" aria-label="账号设置"><button id="account-username-button" type="button" class="button secondary" aria-controls="username-section" aria-expanded="false" disabled>修改用户名</button><button id="account-password-button" type="button" class="button secondary" aria-controls="password-section" aria-expanded="false" disabled>修改密码</button><button id="account-totp-button" type="button" class="button secondary" aria-controls="security-section" aria-expanded="false" disabled>二次验证</button></div>
    <p id="security-status" role="status">正在读取…</p>
    <section id="username-section" aria-labelledby="username-section-title" hidden><h3 id="username-section-title" class="account-section-title">修改用户名</h3>
      <p id="username-hint">用户名需要 1–64 位。修改后，其他设备需要使用新用户名重新登录。</p>
      <form id="username-form"><fieldset id="username-fields" aria-label="修改用户名" disabled>
        <label class="dialog-name-label" for="username-new">新用户名<input id="username-new" type="text" autocomplete="username" autocapitalize="off" spellcheck="false" required maxlength="64" aria-describedby="username-hint"></label>
        ${passwordField('username-password', '当前密码', 'current-password')}
        <label id="username-code-field" class="dialog-name-label" for="username-code" hidden>动态验证码或恢复码<input id="username-code" type="text" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" maxlength="40"></label>
        <p id="username-error" class="alert error" role="alert" hidden></p>
        <div class="dialog-actions"><button id="username-submit" class="button primary" type="submit">修改用户名</button></div>
      </fieldset></form>
    </section>
    <section id="security-section" aria-labelledby="security-section-title" hidden><h3 id="security-section-title" class="account-section-title">二次验证</h3>
    <form id="security-form">
      <div id="security-credentials">${passwordField('security-password', '管理员密码', 'current-password')}</div>
      <div id="security-setup" hidden><p>用验证器扫描二维码添加账号，然后输入 6 位动态验证码完成绑定。</p><img id="security-qr" class="security-qr" width="256" height="256" alt="用验证器扫描此二维码绑定账号" hidden><p>也可手动添加账号，选择「基于时间」，输入下面的账号和密钥。</p><dl class="security-account"><dt>账号</dt><dd id="security-account"></dd><dt>密钥</dt><dd><code id="security-secret"></code><button type="button" id="security-copy-secret" class="button secondary">复制密钥</button></dd></dl><p>输入验证器显示的 6 位动态验证码，验证成功后才会启用二次验证。</p></div>
      <div id="security-code-field" hidden><label class="dialog-name-label" for="security-code"><span id="security-code-label">动态验证码或恢复码</span><input id="security-code" type="text" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" maxlength="40"></label></div>
      <p id="security-error" class="alert error" role="alert" hidden></p>
      <div class="dialog-actions" id="security-actions"><button type="button" class="button secondary" id="security-regenerate" hidden>重新生成恢复码</button><button class="button primary" id="security-submit" type="submit" disabled>启用二次验证</button></div>
    </form>
    <div id="security-recovery" hidden><p>请保存以下恢复码。每个只能使用一次，仅在此显示。手机丢失时可使用管理员密码和恢复码登录。</p><pre id="security-recovery-codes" class="security-recovery-codes"></pre><button type="button" id="security-copy-codes" class="button secondary">复制恢复码</button><div class="dialog-actions"><button type="button" id="security-saved" class="button primary">我已保存恢复码</button></div></div>
    </section>
    <section id="password-section" class="account-password-section" aria-labelledby="password-section-title" hidden><h3 id="password-section-title" class="account-section-title">修改密码</h3>
      <p id="password-hint">新密码需要 12–1024 位。修改后，其他设备需要重新登录。</p>
      <form id="password-form"><fieldset id="password-fields" aria-label="修改密码" disabled>
        ${passwordField('password-current', '当前密码', 'current-password')}
        ${passwordField('password-new', '新密码', 'new-password', 'minlength="12" aria-describedby="password-hint"')}
        <div class="account-password-tools"><button id="password-generate" type="button" class="button secondary">随机生成</button></div>
        <p id="password-generated" role="status" hidden>已生成随机密码并填入两处，请妥善保存。点击「修改密码」后生效。</p>
        ${passwordField('password-confirm', '确认新密码', 'new-password', 'minlength="12"')}
        <label id="password-code-field" class="dialog-name-label" for="password-code" hidden>动态验证码或恢复码<input id="password-code" type="text" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" maxlength="40"></label>
        <p id="password-error" class="alert error" role="alert" hidden></p>
        <div class="dialog-actions"><button id="password-submit" class="button primary" type="submit">修改密码</button></div>
      </fieldset></form>
    </section>
    <div class="account-session-actions"><button id="manager-logout" type="button" class="button secondary"><svg class="icon" aria-hidden="true"><use href="#i-logout"/></svg>退出登录</button></div>`;
  document.body.append(dialog);
  const navigation = ['account-username-button', 'account-password-button', 'account-totp-button'];
  const revealButtons = [...dialog.querySelectorAll('[data-password-input]')];
  let stage = 'loading';
  let enabled = false;
  let busy = false;
  let panel = null;
  let lastState = null;
  function revealPassword(reveal, visible) {
    $(reveal.dataset.passwordInput).type = visible ? 'text' : 'password';
    reveal.setAttribute('aria-label', `${visible ? '隐藏' : '显示'}${reveal.dataset.passwordLabel}`);
    reveal.setAttribute('aria-pressed', String(visible));
  }
  for (const reveal of revealButtons) reveal.addEventListener('click', () => revealPassword(reveal, $(reveal.dataset.passwordInput).type === 'password'));
  function showPanel() {
    $('username-section').hidden = panel !== 'username';
    $('password-section').hidden = panel !== 'password';
    $('security-section').hidden = panel !== 'totp';
    $('account-password-button').setAttribute('aria-expanded', String(panel === 'password'));
    $('account-totp-button').setAttribute('aria-expanded', String(panel === 'totp'));
    $('account-username-button').setAttribute('aria-expanded', String(panel === 'username'));
  }
  for (const [id, name] of [['account-username-button', 'username'], ['account-password-button', 'password'], ['account-totp-button', 'totp']]) {
    $(id).addEventListener('click', () => {
      if (busy || stage === 'loading' || stage === 'recovery') return;
      panel = panel === name ? null : name;
      render(lastState);
      if (panel) $({ username: 'username-new', password: 'password-current', totp: 'security-password' }[panel]).focus();
    });
  }
  function error(message = '') { $('security-error').textContent = message; $('security-error').hidden = !message; }
  function clearSecrets() {
    $('security-qr').removeAttribute('src'); $('security-qr').hidden = true;
    for (const id of ['security-password', 'security-code', 'password-current', 'password-new', 'password-confirm', 'password-code', 'username-new', 'username-password', 'username-code']) $(id).value = '';
    $('username-new').setCustomValidity('');
    $('username-error').textContent = ''; $('username-error').hidden = true;
    $('password-confirm').setCustomValidity('');
    for (const reveal of revealButtons) revealPassword(reveal, false);
    $('password-generated').hidden = true;
    $('password-error').textContent = ''; $('password-error').hidden = true;
    for (const id of ['security-secret', 'security-account', 'security-recovery-codes']) $(id).textContent = '';
  }
  function render(state) {
    lastState = state;
    enabled = state.enabled;
    $('security-username').textContent = `当前用户名：${state.username}`;
    stage = 'settings';
    $('security-status').textContent = enabled ? `二次验证已启用 · 剩余 ${state.recoveryCodesRemaining} 个恢复码` : '二次验证未启用。启用后，登录还需要验证器的动态验证码。';
    $('security-setup').hidden = true;
    $('security-recovery').hidden = true;
    $('security-form').hidden = false;
    $('security-credentials').hidden = false;
    $('security-password').required = true;
    $('security-code-field').hidden = !enabled;
    $('security-code').required = enabled;
    $('security-code').inputMode = 'text';
    $('security-code-label').textContent = '动态验证码或恢复码';
    $('security-submit').textContent = enabled ? '关闭二次验证' : '开始绑定验证器';
    $('security-submit').disabled = false;
    $('security-regenerate').hidden = !enabled;
    showPanel();
    for (const id of navigation) $(id).disabled = busy;
    $('password-fields').disabled = busy;
    $('username-fields').disabled = busy;
    $('username-code-field').hidden = !enabled;
    $('username-code').required = enabled;
    $('password-code-field').hidden = !enabled;
    $('password-code').required = enabled;
    clearSecrets(); error();
  }
  function showCodes(result) {
    enabled = true; stage = 'recovery';
    clearSecrets();
    $('security-status').textContent = '二次验证已启用。请保存恢复码；刚使用过的动态码不能重复使用，请等待下一组。';
    $('security-form').hidden = true;
    $('security-recovery').hidden = false;
    $('password-section').hidden = true;
    $('username-section').hidden = true;
    $('security-recovery-codes').textContent = result.recoveryCodes.join('\n');
    $('security-close').disabled = true; $('manager-logout').disabled = true;
    for (const id of navigation) $(id).disabled = true;
  }
  button.addEventListener('click', async () => {
    if (dialog.open) return;
    clearSecrets(); error(); stage = 'loading';
    panel = null; showPanel();
    for (const id of navigation) $(id).disabled = true;
    $('security-status').textContent = '正在读取…';
    $('security-username').textContent = '';
    $('security-form').hidden = false; $('security-recovery').hidden = true; $('security-setup').hidden = true;
    $('security-credentials').hidden = true; $('security-code-field').hidden = true; $('security-regenerate').hidden = true;
    $('security-submit').disabled = true;
    $('security-close').disabled = false; $('manager-logout').disabled = false;
    dialog.showModal();
    try { const state = await api.request('security/totp'); if (dialog.open) render(state); }
    catch (caught) { if (dialog.open) { $('security-status').textContent = caught.message; } }
  });
  $('security-close').addEventListener('click', () => { if (!busy && stage !== 'recovery') { clearSecrets(); dialog.close(); } });
  dialog.addEventListener('cancel', event => { if (busy || stage === 'recovery') event.preventDefault(); });
  dialog.addEventListener('close', () => { if (!dialog.open) clearSecrets(); });
  $('security-saved').addEventListener('click', () => { clearSecrets(); $('security-close').disabled = false; dialog.close(); });
  async function copy(value, message) {
    try { await clipboard.write(value); notify(message); }
    catch { notify('复制失败，请手动选择并复制。', true); }
  }
  $('security-copy-secret').addEventListener('click', () => copy($('security-secret').textContent, '密钥已复制'));
  $('security-copy-codes').addEventListener('click', () => copy($('security-recovery-codes').textContent, '恢复码已复制'));
  async function submit(regenerate = false) {
    if (busy || stage === 'loading' || stage === 'recovery') return;
    busy = true; error();
    for (const id of navigation) $(id).disabled = true;
    $('password-fields').disabled = true;
    $('username-fields').disabled = true;
    $('security-submit').disabled = true; $('security-regenerate').disabled = true; $('security-close').disabled = true; $('manager-logout').disabled = true;
    try {
      const password = $('security-password').value;
      const code = $('security-code').value.trim();
      if (stage === 'enrolling') {
        showCodes(await api.request('security/totp/enable', { method: 'POST', body: { code } }));
      } else if (!enabled) {
        const setup = await api.request('security/totp/setup', { method: 'POST', body: { password } });
        $('security-password').value = ''; $('security-password').required = false;
        $('security-credentials').hidden = true;
        $('security-account').textContent = `${setup.issuer}: ${setup.account}`;
        $('security-secret').textContent = setup.secret;
        $('security-qr').src = totpQrImage(setup); $('security-qr').hidden = false;
        $('security-setup').hidden = false; $('security-code-field').hidden = false;
        $('security-code').required = true; $('security-code').inputMode = 'numeric';
        $('security-code-label').textContent = '6 位动态验证码';
        $('security-submit').textContent = '验证并启用';
        $('password-section').hidden = true;
        stage = 'enrolling'; $('security-code').focus();
      } else {
        const route = regenerate ? 'recovery-codes' : 'disable';
        const result = await api.request('security/totp/' + route, { method: 'POST', body: { password, code } });
        if (regenerate) showCodes(result);
        else { render(result); notify('二次验证已关闭，其他设备需要重新登录'); }
      }
    } catch (caught) { error(caught.message); }
    finally {
      busy = false; $('security-submit').disabled = false; $('security-regenerate').disabled = false;
      for (const id of navigation) $(id).disabled = stage === 'recovery';
      $('password-fields').disabled = stage !== 'settings';
      $('username-fields').disabled = stage !== 'settings';
      $('security-close').disabled = stage === 'recovery'; $('manager-logout').disabled = stage === 'recovery';
    }
  }
  function validatePasswordConfirmation() {
    $('password-confirm').setCustomValidity($('password-confirm').value === $('password-new').value ? '' : '两次输入的新密码不一致。');
  }
  function passwordChanged() {
    validatePasswordConfirmation();
    $('password-generated').hidden = true;
  }
  $('password-new').addEventListener('input', passwordChanged);
  $('password-confirm').addEventListener('input', passwordChanged);
  $('password-generate').addEventListener('click', () => {
    if (busy || stage !== 'settings') return;
    const password = generateRandomPassword();
    $('password-new').value = password; $('password-confirm').value = password;
    passwordChanged();
    $('password-generated').hidden = false;
    $('password-new').focus();
  });
  $('password-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || stage !== 'settings') return;
    validatePasswordConfirmation();
    if (!$('password-form').reportValidity()) return;
    const input = { currentPassword: $('password-current').value, newPassword: $('password-new').value, code: $('password-code').value.trim() };
    busy = true;
    $('password-error').hidden = true;
    $('password-fields').disabled = true;
    $('username-fields').disabled = true;
    for (const id of [...navigation, 'security-submit', 'security-regenerate', 'security-close', 'manager-logout']) $(id).disabled = true;
    try {
      render(await api.request('security/password', { method: 'POST', body: input }));
      notify('密码已修改，其他设备需要重新登录');
    } catch (caught) {
      $('password-error').textContent = caught.message; $('password-error').hidden = false;
    } finally {
      busy = false; $('password-fields').disabled = false;
      $('username-fields').disabled = false;
      for (const id of [...navigation, 'security-submit', 'security-regenerate', 'security-close', 'manager-logout']) $(id).disabled = false;
    }
  });
  function validateUsername() {
    const username = $('username-new').value.trim();
    $('username-new').setCustomValidity(!username ? '请输入新用户名。' : username === lastState?.username ? '新用户名不能与当前用户名相同。' : '');
  }
  $('username-new').addEventListener('input', validateUsername);
  $('username-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || stage !== 'settings') return;
    validateUsername();
    if (!$('username-form').reportValidity()) return;
    const input = { username: $('username-new').value.trim(), currentPassword: $('username-password').value, code: $('username-code').value.trim() };
    busy = true; $('username-error').hidden = true;
    $('username-fields').disabled = true; $('password-fields').disabled = true;
    for (const id of [...navigation, 'security-submit', 'security-regenerate', 'security-close', 'manager-logout']) $(id).disabled = true;
    try {
      render(await api.request('security/username', { method: 'POST', body: input }));
      notify('用户名已修改，其他设备需要使用新用户名重新登录');
    } catch (caught) {
      $('username-error').textContent = caught.message; $('username-error').hidden = false;
    } finally {
      busy = false; $('username-fields').disabled = false; $('password-fields').disabled = false;
      for (const id of [...navigation, 'security-submit', 'security-regenerate', 'security-close', 'manager-logout']) $(id).disabled = false;
    }
  });
  $('manager-logout').addEventListener('click', async () => {
    if (busy || stage === 'recovery') return;
    $('manager-logout').disabled = true;
    try { await api.request('logout', { method: 'POST', body: {} }); clearSecrets(); document.location.assign('/login.html'); }
    catch (caught) { notify(caught.message, true); $('manager-logout').disabled = false; }
  });
  $('security-form').addEventListener('submit', event => { event.preventDefault(); void submit(); });
  $('security-regenerate').addEventListener('click', () => { if ($('security-form').reportValidity()) void submit(true); });
}
