export function createAdminPasswordControl({ dom, input, wrap, onGenerate }) {
  const controls = dom.el('div', 'admin-password-controls');
  const generate = dom.el('button', 'button secondary', '随机生成');
  generate.type = 'button';
  generate.setAttribute('aria-label', '随机生成管理员密码');
  generate.title = '生成随机密码，应用配置后生效';
  generate.addEventListener('click', () => {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(24));
    const password = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    onGenerate(password);
    input.focus();
  });
  controls.append(wrap, generate);
  return controls;
}
