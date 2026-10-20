export function createDialog({ $, icon }) {
  let pending = null;
  let nameRequired = true;
  let confirmation = null;
  let activeChoices = [];
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
    if (confirmation !== null && $('dialog-name').value !== confirmation) {
      $('dialog-error').textContent = `请输入 ${confirmation} 确认操作。`;
      $('dialog-error').hidden = false;
      return;
    }
    if (activeChoices.length) {
      const choice = activeChoices.find(item => item.value === $('dialog-choice').value);
      if (!choice) return;
      finish(choice.value);
    } else finish($('dialog-name-label').hidden ? true : $('dialog-name').value.trim());
  });
  $('dialog-cancel').addEventListener('click', () => finish(null));
  $('dialog-close').addEventListener('click', () => finish(null));
  $('dialog-name').addEventListener('input', () => {
    if (confirmation !== null) $('dialog-confirm').disabled = $('dialog-name').value !== confirmation;
  });
  $('action-dialog').addEventListener('cancel', event => { event.preventDefault(); finish(null); });
  $('dialog-choice').addEventListener('change', () => {
    $('dialog-choice-description').textContent = activeChoices.find(item => item.value === $('dialog-choice').value)?.description || '';
  });

  return ({ title, description, name, nameLabel = '配置名称', namePlaceholder = '例如：和朋友的冒险', nameMaxLength = 60, required = true, confirmation: expected = null, choices = [], confirm = '确认', danger = false, symbol = 'file' }) => new Promise(resolve => {
    pending = resolve;
    nameRequired = required;
    confirmation = expected;
    activeChoices = choices;
    $('dialog-title').textContent = title;
    $('dialog-description').textContent = description;
    $('dialog-choice-label').hidden = !choices.length;
    $('dialog-choice-description').hidden = !choices.length;
    $('dialog-choice').replaceChildren(...choices.map(choice => {
      const option = $('dialog-choice').ownerDocument.createElement('option');
      option.value = choice.value;
      option.textContent = choice.label;
      return option;
    }));
    $('dialog-choice-description').textContent = choices[0]?.description || '';
    $('dialog-icon').replaceChildren(icon(symbol));
    $('dialog-name-text').textContent = nameLabel;
    $('dialog-name').placeholder = namePlaceholder;
    $('dialog-name').maxLength = nameMaxLength;
    $('dialog-name-label').hidden = name === undefined;
    $('dialog-name').value = name ?? '';
    $('dialog-name').required = name !== undefined && nameRequired;
    $('dialog-error').hidden = true;
    $('dialog-confirm').textContent = confirm;
    $('dialog-confirm').disabled = confirmation !== null && $('dialog-name').value !== confirmation;
    $('dialog-confirm').style.backgroundColor = danger ? 'var(--red)' : '';
    $('action-dialog').showModal();
    if (name !== undefined) { $('dialog-name').focus(); $('dialog-name').select(); }
    else if (choices.length) $('dialog-choice').focus();
    else $('dialog-cancel').focus();
  });
}
