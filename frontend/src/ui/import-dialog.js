export function createImportDialog({ dom, readFile, validate, beforeOpen, onOpened, onImport }) {
  const { $ } = dom;
  let readVersion = 0;
  let selectedFileName = '';
  let importing = false;
  const controls = ['import-confirm', 'import-close', 'import-cancel', 'file-input', 'import-text', 'import-name'];
  function showError(error) {
    $('import-error').textContent = error.message;
    $('import-error').hidden = false;
  }
  function close() { if (importing) return; readVersion++; $('import-dialog').close(); }
  async function open() {
    if (!(await beforeOpen())) return;
    $('import-text').value = '';
    $('import-name').value = '';
    $('file-input').value = '';
    $('import-error').hidden = true;
    selectedFileName = '';
    $('import-dialog').showModal();
    onOpened();
  }
  async function selectFile(file) {
    if (!file || importing) return;
    const version = ++readVersion;
    try {
      const text = await readFile(file);
      if (version !== readVersion || !$('import-dialog').open) return;
      $('import-text').value = text;
      $('import-name').value = file.name.replace(/\.(ini|txt)$/i, '') || '导入的配置';
      $('import-error').hidden = true;
      selectedFileName = file.name.replace(/[\r\n]+/g, ' ').slice(0, 140);
    } catch (error) {
      if (version === readVersion && $('import-dialog').open) showError(error);
    }
  }
  $('import-button').addEventListener('click', open);
  $('import-close').addEventListener('click', close);
  $('import-cancel').addEventListener('click', close);
  $('import-dialog').addEventListener('cancel', event => { if (importing) event.preventDefault(); else readVersion++; });
  $('file-input').addEventListener('change', () => selectFile($('file-input').files[0]));
  $('import-text').addEventListener('input', () => { selectedFileName = ''; });
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
  $('import-confirm').addEventListener('click', async () => {
    if (importing) return;
    try {
      const source = validate($('import-text').value);
      const origin = selectedFileName ? `导入文件：${selectedFileName}` : '粘贴导入的配置';
      readVersion++;
      importing = true;
      controls.forEach(id => { $(id).disabled = true; });
      $('import-dialog').setAttribute('aria-busy', 'true');
      $('import-error').hidden = true;
      await onImport($('import-name').value.trim() || '导入的配置', source, origin);
      $('import-dialog').close();
    } catch (error) { showError(error); }
    finally {
      importing = false;
      controls.forEach(id => { $(id).disabled = false; });
      $('import-dialog').removeAttribute('aria-busy');
    }
  });
}
