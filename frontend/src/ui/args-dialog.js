export function createArgsDialog({ dom, prefix, onSave }) {
  const { $ } = dom;
  const dialog = $(`${prefix}-dialog`);
  const input = $(`${prefix}-input`);
  const error = $(`${prefix}-error`);
  const save = $(`${prefix}-save`);
  const cancel = $(`${prefix}-cancel`);
  const close = $(`${prefix}-close`);
  let busy = false;

  function setBusy(value) {
    busy = value;
    save.disabled = value; cancel.disabled = value; close.disabled = value;
  }
  function open(value) {
    input.value = value;
    error.textContent = ''; error.hidden = true;
    setBusy(false);
    dialog.showModal();
    input.focus();
  }
  async function submit() {
    if (busy) return;
    const args = input.value.split('\n').map(line => line.endsWith('\r') ? line.slice(0, -1) : line).filter(line => line.trim() !== '');
    setBusy(true); error.hidden = true;
    try {
      await onSave(args);
      dialog.close();
    } catch (caught) {
      error.textContent = caught.message; error.hidden = false;
    } finally { setBusy(false); }
  }
  save.addEventListener('click', submit);
  cancel.addEventListener('click', () => { if (!busy) dialog.close(); });
  close.addEventListener('click', () => { if (!busy) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  input.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); submit(); }
  });
  return { open };
}
