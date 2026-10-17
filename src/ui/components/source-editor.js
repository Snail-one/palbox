export function createSourceEditor({ dom, editor, ask, notify, onChanged }) {
  const { $, el } = dom;
  $('source-editor').addEventListener('input', () => {
    editor.setSourceDraft($('source-editor').value);
    $('source-error').hidden = true;
    onChanged();
  });
  const restore = el('button', 'button secondary', '还原源码');
  restore.id = 'restore-source';
  $('apply-source').before(restore);
  restore.addEventListener('click', async () => {
    if (editor.sourceDraft !== null) {
      const discard = await ask({ title: '还原源码？', description: '放弃尚未应用的源码编辑，恢复为当前已应用的配置。', confirm: '还原源码', symbol: 'code' });
      if (!discard) return;
    }
    editor.discardSourceDraft();
    $('source-editor').value = editor.source();
    $('source-error').hidden = true;
    onChanged();
  });
  $('apply-source').addEventListener('click', () => {
    try {
      editor.applySource($('source-editor').value);
      $('source-error').hidden = true;
      onChanged();
      notify('源码已应用，表单已同步');
    } catch (error) {
      $('source-error').textContent = error.message;
      $('source-error').hidden = false;
    }
  });
  return {
    render() {
      $('source-editor').value = editor.sourceDraft ?? editor.source();
      if (editor.sourceDraft === null) $('source-error').hidden = true;
    }
  };
}
