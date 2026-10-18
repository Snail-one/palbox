import { formatBytes } from './format.js';

export function createSaveImportDialog({ dom, api, onImport }) {
  const { $ } = dom;
  const dialog = $('save-import-dialog');
  const input = $('save-import-file');
  const drop = $('save-import-drop');
  const confirm = $('save-import-confirm');
  const cancel = $('save-import-cancel');
  const close = $('save-import-close');
  const error = $('save-import-error');
  const name = $('save-import-name');
  const progress = $('save-import-progress');
  const status = $('save-import-status');
  let file = null;
  let stagedId = null;
  let busy = false;

  function showError(message) {
    error.textContent = message;
    error.hidden = !message;
  }
  function reset() {
    file = null; stagedId = null; busy = false;
    input.value = ''; input.disabled = false;
    name.textContent = ''; status.textContent = '';
    progress.hidden = true; progress.value = 0;
    showError('');
    confirm.disabled = true; cancel.disabled = false; close.disabled = false;
    drop.setAttribute('aria-disabled', 'false');
  }
  function select(candidate) {
    if (busy || !candidate) return;
    if (!/\.(?:tar\.gz|tgz)$/i.test(candidate.name)) { showError('请选择 .tar.gz 或 .tgz 格式的官方存档。'); return; }
    if (candidate.size > 1024 ** 3) { showError('存档压缩包不能超过 1 GB。'); return; }
    file = candidate; stagedId = null;
    showError('');
    name.textContent = `${candidate.name} · ${formatBytes(candidate.size)}`;
    status.textContent = '准备上传并恢复存档。';
    confirm.disabled = false;
  }
  function setBusy(value) {
    busy = value;
    confirm.disabled = value || !file;
    cancel.disabled = value; close.disabled = value; input.disabled = value;
    drop.setAttribute('aria-disabled', String(value));
  }
  async function submit() {
    if (!file || busy) return;
    showError('');
    setBusy(true);
    progress.hidden = false; progress.value = 0;
    status.textContent = '正在上传存档…';
    try {
      if (!stagedId) {
        const staged = await api.upload('save-import', file, {
          onProgress: ratio => {
            progress.value = ratio;
            status.textContent = `正在上传存档… ${Math.round(ratio * 100)}%`;
          }
        });
        stagedId = staged.id;
      }
      status.textContent = '正在提交恢复任务…';
      await onImport(stagedId);
      dialog.close();
    } catch (caught) {
      showError(caught.message);
    } finally { setBusy(false); }
  }
  function open() {
    reset();
    dialog.showModal();
    drop.focus();
  }

  drop.addEventListener('keydown', event => {
    if (busy || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault(); input.click();
  });
  input.addEventListener('change', () => select(input.files[0]));
  for (const type of ['dragenter', 'dragover']) drop.addEventListener(type, event => event.preventDefault());
  drop.addEventListener('drop', event => {
    event.preventDefault();
    select(event.dataTransfer?.files?.[0]);
  });
  confirm.addEventListener('click', submit);
  cancel.addEventListener('click', () => { if (!busy) dialog.close(); });
  close.addEventListener('click', () => { if (!busy) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', reset);
  return { open };
}
