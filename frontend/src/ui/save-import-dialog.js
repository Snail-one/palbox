import { formatBytes } from './format.js';

/** One review dialog for uploaded archives, world backups, and official snapshots. */
export function createSaveImportDialog({ dom, api, onRestore }) {
  const { $, document } = dom;
  const dialog = $('save-import-dialog');
  const input = $('save-import-file');
  const drop = $('save-import-drop');
  const confirm = $('save-import-confirm');
  const error = $('save-import-error');
  const details = $('save-import-details');
  const progress = $('save-import-progress');
  const status = $('save-import-status');
  const modeButtons = [...$('save-import-mode').querySelectorAll('button')];
  let file = null, candidate = null, preview = null, busy = false, submitting = false, generation = 0, mode = 'world';

  function showError(message) { error.textContent = message; error.hidden = !message; }
  function controls() {
    confirm.disabled = busy || (!candidate && !file);
    confirm.textContent = preview ? '确认导入恢复' : busy ? '正在检测…' : '重新检测';
    input.disabled = busy;
    for (const button of modeButtons) button.disabled = busy;
    $('save-import-cancel').disabled = submitting;
    $('save-import-close').disabled = submitting;
    drop.setAttribute('aria-disabled', String(busy));
    dialog.setAttribute('aria-busy', String(busy));
  }
  function reset() {
    generation++;
    file = null; candidate = null; preview = null; busy = false; submitting = false;
    input.value = ''; drop.hidden = false;
    mode = 'world'; $('save-import-mode-label').hidden = false;
    updateModeDescription();
    $('save-import-name').textContent = ''; status.textContent = '';
    details.replaceChildren(); details.hidden = true;
    progress.hidden = true; progress.value = 0;
    showError(''); controls();
  }
  function updateModeDescription() {
    for (const button of modeButtons) {
      const selected = button.dataset.restoreMode === mode;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    $('save-import-mode-description').textContent = mode === 'source-world'
      ? '恢复到备份原来的世界 ID，并切换服务器加载该世界；已有同 ID 世界会被覆盖。'
      : '保留当前世界 ID，将存档内容恢复到当前世界。';
  }
  function render(value) {
    $('save-import-mode-label').hidden = !value.hasWorld;
    $('save-import-mode-description').hidden = !value.hasWorld;
    const rows = [
      ['检测结果', value.hasWorld ? (value.hasConfiguration ? '检测到存档和配置' : '检测到存档') : '检测到配置'],
      ...(value.hasWorld ? [
        ['来源世界 ID', value.sourceWorldId || '压缩包未提供世界 ID'],
        ['恢复目标世界 ID', value.targetWorldId],
        ['恢复目录', value.targetDirectory],
        ['目标处理', value.targetExists ? '覆盖目标世界现有存档；执行前先备份该世界和当前游戏配置。' : '创建目标世界目录。'],
        ['世界 ID 处理', value.mode === 'source-world' ? '使用备份世界 ID，并将服务器切换到该世界。' : '保留当前世界 ID。']
      ] : []),
      ['配置处理', value.hasConfiguration ? '导入「游戏默认配置」，并设为当前选中的配置；缺项按官方默认补齐。' : '未检测到配置，保留当前游戏配置。'],
      ['恢复范围', value.hasWorld ? '目标世界存档及包内游戏配置。' : '仅游戏配置。'],
      ['保护备份', value.protectionCategory === 'before-import' ? '执行前自动创建「导入前备份」' : '执行前自动创建「恢复前备份」'],
      ['游戏状态', value.running ? '先保存并停服，完成后重新启动' : '当前已停止，完成后保持停止']
    ];
    details.replaceChildren(...rows.flatMap(([label, text]) => {
      const term = document.createElement('dt'); term.textContent = label;
      const description = document.createElement('dd'); description.textContent = text;
      return [term, description];
    }));
    details.hidden = false;
    status.textContent = '检测完成，请核对恢复目标和配置处理方式；目标变化后需重新检测并确认。';
  }
  async function detect() {
    if (busy || (!file && !candidate)) return;
    const version = generation;
    busy = true; preview = null; details.hidden = true; showError(''); controls();
    try {
      if (!candidate) {
        progress.hidden = false; progress.value = 0;
        status.textContent = '正在上传并检测存档…';
        const staged = await api.upload('save-import', file, { onProgress: ratio => {
          if (version !== generation) return;
          progress.value = ratio;
          status.textContent = `正在上传存档… ${Math.round(ratio * 100)}%`;
        } });
        if (version !== generation) return;
        candidate = { action: 'import-save', id: staged.id };
      }
      status.textContent = '正在检测存档、配置和恢复目标…';
      const value = await api.request('restore-preview', { method: 'POST', body: { ...candidate, mode }, timeout: 300000 });
      if (version !== generation) return;
      preview = value; render(value);
    } catch (caught) { if (version === generation) { status.textContent = '检测未完成，未执行恢复。'; showError(caught.message); } }
    finally { if (version === generation) { busy = false; progress.hidden = true; controls(); } }
  }
  function select(selected) {
    if (busy || !selected) return;
    file = null; candidate = null; preview = null; details.hidden = true; controls();
    $('save-import-mode-label').hidden = false;
    $('save-import-mode-description').hidden = false;
    if (!/\.(?:tar\.gz|tgz|zip|7z)$/i.test(selected.name)) { showError('请选择 .tar.gz、.tgz、.zip 或 .7z 格式的存档。'); return; }
    if (selected.size > 1024 ** 3) { showError('存档压缩包不能超过 1 GB。'); return; }
    file = selected;
    $('save-import-name').textContent = `${selected.name} · ${formatBytes(selected.size)}`;
    void detect();
  }
  async function submit() {
    if (busy) return;
    if (!preview) { await detect(); return; }
    busy = true; submitting = true; controls(); showError('');
    status.textContent = '正在提交恢复任务…';
    try {
      await onRestore({ ...candidate, ...(preview.mode === 'source-world' ? { mode: preview.mode } : {}), targetWorldId: preview.targetWorldId });
      dialog.close();
    } catch (caught) {
      showError(caught.message);
      preview = null; details.hidden = true;
      status.textContent = '请重新检测恢复详情后再确认。';
    } finally { busy = false; submitting = false; controls(); }
  }
  function open(selection = null) {
    reset(); dialog.showModal();
    $('save-import-mode-description').hidden = false;
    if (selection) {
      candidate = { action: selection.action, id: selection.id };
      mode = selection.mode || (selection.action === 'restore-native' ? 'source-world' : 'world'); updateModeDescription();
      drop.hidden = true;
      $('save-import-name').textContent = selection.label || selection.id;
      void detect();
    } else { status.textContent = '选择存档文件，检测完成后再确认恢复。'; drop.focus(); }
  }
  drop.addEventListener('keydown', event => {
    if (busy || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault(); input.click();
  });
  input.addEventListener('change', () => select(input.files[0]));
  for (const button of modeButtons) button.addEventListener('click', () => {
    if (busy || mode === button.dataset.restoreMode) return;
    mode = button.dataset.restoreMode;
    updateModeDescription(); preview = null; details.hidden = true; controls(); void detect();
  });
  for (const type of ['dragenter', 'dragover']) drop.addEventListener(type, event => event.preventDefault());
  drop.addEventListener('drop', event => { event.preventDefault(); select(event.dataTransfer?.files?.[0]); });
  confirm.addEventListener('click', submit);
  for (const id of ['save-import-cancel', 'save-import-close']) $(id).addEventListener('click', () => { if (!submitting) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (submitting) event.preventDefault(); });
  dialog.addEventListener('close', reset);
  return { open };
}
