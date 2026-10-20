import { updateModifiedBadge } from './modified-badge.js';

export function createFieldFeedback({ dom, editor, catalog, ask, onChanged, onRestored }) {
  function updateResetButton(key, container) {
    if (!container) return;
    const existing = container.querySelector('.field-reset');
    if ((!editor.isModified(key) && !editor.error(key)) || !editor.canRestoreField(key)) { existing?.remove(); return; }
    if (existing) return;
    const button = dom.el('button', 'field-reset', '恢复默认');
    button.type = 'button';
    button.dataset.resetField = key;
    button.title = '仅恢复此项为这套配置最初输入或导入的值';
    button.setAttribute('aria-label', `${key} 恢复默认`);
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const label = catalog.fields[key]?.label || key;
        const confirmed = await ask({ title: `恢复「${label}」的默认值？`, description: '仅将此参数恢复为这套配置最初输入或导入的值，恢复后会自动保存。', confirm: '恢复默认', symbol: 'restore' });
        if (!confirmed || !editor.restoreField(key)) return;
        onChanged();
        onRestored?.(key);
      } finally { button.disabled = false; }
    });
    container.append(button);
  }
  function show(key, control, errorNode) {
    const error = editor.error(key);
    control.setAttribute('aria-invalid', String(Boolean(error)));
    if (errorNode) errorNode.textContent = error;
    const row = control.closest('tr');
    const heading = control.closest('.field')?.querySelector('.parameter-heading') || row?.querySelector('.parameter-heading') || row?.firstElementChild;
    const modified = editor.isModified(key);
    updateModifiedBadge(dom, heading, modified);
    updateResetButton(key, heading);
    row?.classList.toggle('modified', modified);
    onChanged();
  }
  return {
    updateResetButton,
    formatOnBlur(key, control, errorNode) {
      control.addEventListener('blur', () => {
        if (editor.error(key)) return;
        const formatted = editor.outputRaw(key);
        if (control.value === formatted) return;
        control.value = formatted;
        editor.update(key, formatted);
        show(key, control, errorNode);
      });
    },
    updateValue(key, raw, control, errorNode) {
      editor.update(key, raw, control.value);
      show(key, control, errorNode);
    },
    rejectValue(key, error, control, errorNode) {
      editor.reject(key, error, control.value);
      show(key, control, errorNode);
    }
  };
}
