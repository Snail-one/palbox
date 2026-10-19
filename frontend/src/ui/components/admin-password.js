export function generateRandomPassword() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createAdminPasswordControl({ dom, input, wrap, onGenerate, label = '管理员密码' }) {
  const controls = dom.el('div', 'admin-password-controls');
  const generate = dom.el('button', 'button secondary', '随机生成');
  generate.type = 'button';
  generate.setAttribute('aria-label', `随机生成${label}`);
  generate.title = '生成随机密码，应用配置后生效';
  generate.addEventListener('click', () => {
    onGenerate(generateRandomPassword());
    input.focus();
  });
  controls.append(wrap, generate);
  return controls;
}
