import { fields } from '../../../../shared/domain/schema.js';
import { decodeString } from '../../../../shared/domain/config.js';

export function configurationValue(dom, label, raw, key, kind) {
  const { el, icon } = dom;
  const box = el('div', 'pending-config-value'); box.dataset.diffValue = kind;
  box.append(el('span', 'pending-config-label', label));
  if (raw === null) box.append(el('span', 'management-note', '未设置'));
  else if (fields[key]?.secret) {
    const wrap = el('div', 'input-wrap');
    const input = el('input', 'field-input field-secret');
    input.type = 'password'; input.readOnly = true; input.autocomplete = 'off';
    input.value = decodeString(raw);
    if (!input.value) input.placeholder = '空字符串（未设置）';
    input.setAttribute('aria-label', `${fields[key].label}：${label}`);
    const reveal = el('button', 'icon-button reveal-button'); reveal.type = 'button';
    reveal.setAttribute('aria-label', `显示${fields[key].label}：${label}`);
    reveal.setAttribute('aria-pressed', 'false'); reveal.append(icon('eye'));
    reveal.addEventListener('click', () => {
      const visible = input.type === 'password'; input.type = visible ? 'text' : 'password';
      reveal.setAttribute('aria-pressed', String(visible));
      reveal.setAttribute('aria-label', `${visible ? '隐藏' : '显示'}${fields[key].label}：${label}`);
    });
    wrap.append(input, reveal); box.append(wrap);
  } else box.append(el('pre', 'pending-config-raw', raw));
  return box;
}
