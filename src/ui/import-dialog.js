export function createImportDialog({ dom, readFile, validate, beforeOpen, onOpened, onImport }) {
  const { $ } = dom;
  let readVersion = 0;
  function showError(error) {
    $('import-error').textContent = error.message;
    $('import-error').hidden = false;
  }
  function close() { readVersion++; $('import-dialog').close(); }
  async function open() {
    if (!(await beforeOpen())) return;
    $('import-text').value = '';
    $('import-name').value = '';
    $('file-input').value = '';
    $('import-error').hidden = true;
    $('import-dialog').showModal();
    onOpened();
  }
  async function selectFile(file) {
    if (!file) return;
    const version = ++readVersion;
    try {
      const text = await readFile(file);
      if (version !== readVersion || !$('import-dialog').open) return;
      $('import-text').value = text;
      $('import-name').value = file.name.replace(/\.(ini|txt)$/i, '') || '导入的配置';
      $('import-error').hidden = true;
    } catch (error) {
      if (version === readVersion && $('import-dialog').open) showError(error);
    }
  }
  $('import-button').addEventListener('click', open);
  $('import-close').addEventListener('click', close);
  $('import-cancel').addEventListener('click', close);
  $('import-dialog').addEventListener('cancel', () => { readVersion++; });
  $('file-input').addEventListener('change', () => selectFile($('file-input').files[0]));
  $('drop-zone').addEventListener('keydown', event => {
    if (event.target !== $('drop-zone')) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('file-input').click(); }
  });
  for (const event of ['dragenter', 'dragover']) $('drop-zone').addEventListener(event, e => {
    e.preventDefault();
    $('drop-zone').classList.add('dragover');
  });
  $('drop-zone').addEventListener('dragleave', () => $('drop-zone').classList.remove('dragover'));
  $('drop-zone').addEventListener('drop', event => {
    event.preventDefault();
    $('drop-zone').classList.remove('dragover');
    selectFile(event.dataTransfer.files[0]);
  });
  $('import-confirm').addEventListener('click', () => {
    try {
      const source = validate($('import-text').value);
      onImport($('import-name').value.trim() || '导入的配置', source);
      close();
    } catch (error) { showError(error); }
  });
}
