export function createGameArgsDialog({ dom, onSave }) {
  const { $ } = dom;
  const dialog = $('game-args-dialog');
  const input = $('game-args-input');
  const error = $('game-args-error');
  const save = $('game-args-save');
  const cancel = $('game-args-cancel');
  const close = $('game-args-close');
  let busy = false;

  function setBusy(value) {
    busy = value;
    save.disabled = value; cancel.disabled = value; close.disabled = value;
  }
  function open(args) {
    input.value = args.join('\n');
    error.textContent = ''; error.hidden = true;
    setBusy(false);
    dialog.showModal();
    input.focus();
  }
  async function submit() {
    if (busy) return;
    const gameArgs = input.value.split('\n').map(line => line.endsWith('\r') ? line.slice(0, -1) : line).filter(line => line.trim() !== '');
    setBusy(true); error.hidden = true;
    try {
      await onSave(gameArgs);
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
