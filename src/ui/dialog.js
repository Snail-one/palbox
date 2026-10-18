export function createDialog({ $, icon }) {
  let pending = null;
  let nameRequired = true;
  function finish(value) {
    $('action-dialog').close();
    const resolve = pending;
    pending = null;
    resolve?.(value);
  }
  $('action-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!$('dialog-name-label').hidden && nameRequired && !$('dialog-name').value.trim()) {
      $('dialog-error').textContent = `请输入${$('dialog-name-text').textContent}。`;
      $('dialog-error').hidden = false;
      return;
    }
    finish($('dialog-name-label').hidden ? true : $('dialog-name').value.trim());
  });
  $('dialog-cancel').addEventListener('click', () => finish(null));
  $('dialog-close').addEventListener('click', () => finish(null));
  $('action-dialog').addEventListener('cancel', event => { event.preventDefault(); finish(null); });

  return ({ title, description, name, nameLabel = '配置名称', namePlaceholder = '例如：和朋友的冒险', nameMaxLength = 60, required = true, confirm = '确认', danger = false, symbol = 'file' }) => new Promise(resolve => {
    pending = resolve;
    nameRequired = required;
    $('dialog-title').textContent = title;
    $('dialog-description').textContent = description;
    $('dialog-icon').replaceChildren(icon(symbol));
    $('dialog-name-text').textContent = nameLabel;
    $('dialog-name').placeholder = namePlaceholder;
    $('dialog-name').maxLength = nameMaxLength;
    $('dialog-name-label').hidden = name === undefined;
    $('dialog-name').value = name ?? '';
    $('dialog-name').required = name !== undefined && nameRequired;
    $('dialog-error').hidden = true;
    $('dialog-confirm').textContent = confirm;
    $('dialog-confirm').style.backgroundColor = danger ? 'var(--red)' : '';
    $('action-dialog').showModal();
    if (name !== undefined) { $('dialog-name').focus(); $('dialog-name').select(); }
    else $('dialog-cancel').focus();
  });
}
