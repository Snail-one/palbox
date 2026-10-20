export function createDialog({ $, icon }) {
  let pending = null;
  let nameRequired = true;
  let confirmation = null;
  let activeChoices = [];
  let selectedChoice = null;
  function selectChoice(value) {
    selectedChoice = value;
    for (const button of $('dialog-choice').querySelectorAll('button')) {
      const selected = button.dataset.value === value;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    $('dialog-choice-description').textContent = activeChoices.find(item => item.value === value)?.description || '';
  }
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
      const choice = activeChoices.find(item => item.value === selectedChoice);
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
      const button = $('dialog-choice').ownerDocument.createElement('button');
      button.type = 'button';
      button.dataset.value = choice.value;
      button.textContent = choice.label;
      button.addEventListener('click', () => selectChoice(choice.value));
      return button;
    }));
    selectChoice(choices[0]?.value ?? null);
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
    else if (choices.length) $('dialog-choice').querySelector('button').focus();
    else $('dialog-cancel').focus();
  });
}
