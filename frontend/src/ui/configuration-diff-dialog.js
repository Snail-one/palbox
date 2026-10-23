import { fields } from '../../../shared/domain/schema.js';
import { configurationValue } from './components/configuration-value.js';

/** Read differences only when requested; keep values out of status streams. */
export function createConfigurationDiffDialog({ dom, api, onRead }) {
  const { $, el } = dom;
  const dialog = $('pending-config-dialog');
  let reading = 0;
  const valueBox = (...args) => configurationValue(dom, ...args);

  function render(value) {
    const note = $('pending-config-note');
    const messages = [`配置「${value.profileName}」有 ${value.changes.length} 项参数差异。`];
    messages.push(value.running ? '本次启动值与已保存的面板配置进行比较，应用并重启后生效。' : '对比已写入文件与已保存的面板配置，应用后将在下次启动时使用。');
    if (!value.diskExists) messages.push('游戏配置尚未写入文件。');
    if (value.running && !value.runningKnown) messages.push('无法确认本次启动值，仅列出文件与面板配置的差异。');
    if (!value.changes.length) messages.push(value.formatOnly ? '参数值一致，文件格式或参数排列不同不影响生效。' : '当前各参数值一致。');
    note.textContent = messages.join(' ');
    const list = $('pending-config-list');
    for (const change of value.changes) {
      const card = el('section', 'pending-config-entry');
      card.dataset.configurationKey = change.key;
      const heading = el('div', 'pending-config-heading');
      heading.append(el('h3', '', fields[change.key]?.label || change.key));
      if (change.needsWrite) heading.append(el('span', 'subtle-tag', '待写入'));
      if (change.needsRestart) heading.append(el('span', 'subtle-tag', '待重启'));
      const values = el('div', `pending-config-values${value.running && value.runningKnown ? ' with-running' : ''}`);
      if (value.running && value.runningKnown) values.append(valueBox('本次启动值', change.runningValue, change.key, 'running'));
      values.append(valueBox('已写入文件', change.writtenValue, change.key, 'written'), valueBox('待应用值', change.desiredValue, change.key, 'desired'));
      card.append(heading, el('div', 'field-key', change.key), values);
      list.append(card);
    }
  }

  $('show-pending-config').addEventListener('click', async () => {
    if (dialog.open) return;
    const request = ++reading;
    $('pending-config-list').replaceChildren(); $('pending-config-error').hidden = true;
    $('pending-config-note').textContent = '正在读取配置差异…';
    dialog.showModal();
    try {
      const value = await api.request('configuration-diff');
      if (dialog.open && request === reading) { render(value); onRead?.(value); }
    } catch (error) {
      if (!dialog.open || request !== reading) return;
      $('pending-config-note').textContent = '';
      $('pending-config-error').textContent = error.message; $('pending-config-error').hidden = false;
    }
  });
  dialog.addEventListener('close', () => { reading++; $('pending-config-list').replaceChildren(); $('pending-config-note').textContent = ''; });
  for (const id of ['pending-config-close', 'pending-config-done']) $(id).addEventListener('click', () => dialog.close());
}
