export function createFieldFeedback({ dom, editor, onChanged }) {
  function show(key, control, errorNode) {
    const error = editor.error(key);
    control.setAttribute('aria-invalid', String(Boolean(error)));
    if (errorNode) errorNode.textContent = error;
    const label = control.closest('.field')?.querySelector('.field-label');
    label?.querySelector('.modified-dot')?.remove();
    if (editor.isModified(key)) {
      const dot = dom.el('span', 'modified-dot');
      dot.title = '本次已修改';
      label?.append(dot);
    }
    control.closest('tr')?.classList.toggle('modified', editor.isModified(key));
    onChanged();
  }
  return {
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
