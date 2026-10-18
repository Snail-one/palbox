import { OFFICIAL_DEFAULT_ORIGIN } from '../../../shared/domain/workspace.js';

export function createProfilePanel({ dom, workspace, ask, beforeLeave, ready, isDirty, clipboard, notify, onSaveSource, actions }) {
  const { $, el, icon, empty } = dom;
  const sourceDialog = $('source-view-dialog');
  const sourceText = $('source-view-text');
  const sourceDescription = $('source-view-description');
  let editingProfile = null;
  let sourceReadOnly = false;
  function closeSourceDialog() { sourceDialog.close(); }
  function openSourceDialog(profile = workspace.active) {
    const active = profile.id === workspace.active.id;
    const origin = profile.origin || '已有配置';
    // Only the server-owned game-default entry (and legacy official-origin data)
    // is protected; an imported file with the same name is an editable copy.
    sourceReadOnly = profile.locked === true || origin === OFFICIAL_DEFAULT_ORIGIN;
    editingProfile = profile;
    sourceText.value = profile.source;
    sourceText.readOnly = sourceReadOnly;
    $('source-view-file').textContent = profile.locked ? '输入源码 · DefaultPalWorldSettings.ini' : '输入源码 · PalWorldSettings.ini';
    $('source-view-mode').textContent = sourceReadOnly ? 'UTF-8 · 只读' : 'UTF-8 · 可编辑';
    $('source-view-save').hidden = sourceReadOnly;
    $('source-view-save').disabled = sourceReadOnly;
    $('source-view-error').hidden = true;
    sourceDescription.textContent = `「${profile.name}」的输入源码。来源：${origin}。${sourceReadOnly ? '该条目直接读取游戏目录中的 DefaultPalWorldSettings.ini，源码不可修改；可创建副本后编辑。' : active ? '保存后会替换当前配置的输入源码，当前未应用或无效的编辑将被覆盖。' : '保存后更新该配置，不会切换当前配置。'}`;
    sourceDialog.showModal();
    sourceText.scrollTop = 0;
  }
  $('view-profile-source').addEventListener('click', () => openSourceDialog());
  $('source-view-close').addEventListener('click', closeSourceDialog);
  $('source-view-ok').addEventListener('click', closeSourceDialog);
  sourceDialog.addEventListener('close', () => {
    if (sourceDialog.open) return;
    editingProfile = null; sourceText.value = '';
  });
  $('source-view-copy').addEventListener('click', async () => {
    try { await clipboard.write(sourceText.value); notify('配置源码已复制'); }
    catch { notify('复制失败，请手动选择源码复制', true); }
  });
  $('source-view-save').addEventListener('click', async () => {
    if (!editingProfile || sourceReadOnly) return;
    const button = $('source-view-save');
    button.disabled = true;
    $('source-view-error').hidden = true;
    try {
      await onSaveSource(editingProfile.id, sourceText.value);
      closeSourceDialog();
    } catch (error) {
      $('source-view-error').textContent = error.message;
      $('source-view-error').hidden = false;
    } finally { button.disabled = false; }
  });
  $('new-profile').addEventListener('click', async () => {
    if (!(await beforeLeave())) return;
    const name = await ask({ title: '创建一个新的世界', description: '读取游戏目录中的官方 DefaultPalWorldSettings.ini，创建一套独立配置。', name: '新的帕鲁世界', confirm: '创建配置', symbol: 'plus' });
    if (name) actions.create(name);
  });
  async function rename(profile) {
    const name = await ask({ title: '给世界起个名字', description: '配置名称用于在工作台中区分不同世界，不会修改服务器名称。', name: profile.name, confirm: '保存名称', symbol: 'edit' });
    if (name && name !== profile.name) actions.rename(name, profile.id);
  }
  async function duplicate(profile, fromList = false) {
    if (profile.id === workspace.active.id && !ready()) return;
    const description = profile.locked
      ? '副本读取当前官方默认配置并补入管理模式必需的 REST API 参数，作为自己的恢复基准；后续编辑与原条目相互独立。'
      : `副本包含「${profile.name}」的所有有效参数，并将这些参数作为自己的恢复基准；后续编辑与原配置相互独立。`;
    const name = await ask({ title: '复制这套配置', description, name: profile.name + ' · 副本', confirm: '复制配置', symbol: 'copy' });
    if (name) actions.duplicate(name, profile.id, { fromList });
  }
  async function remove(profile, fromList = false) {
    const discardsEdits = profile.id === workspace.active.id && isDirty();
    const lastEditable = workspace.profiles.filter(candidate => !candidate.locked).length === 1;
    const yes = await ask({ title: '删除这套配置？', description: `「${profile.name}」将从配置库中删除${discardsEdits ? '，包括尚未保存的更改' : ''}。${lastEditable ? '删除后会创建一套新的可编辑配置。' : '其他配置不受影响。'}`, confirm: '删除配置', danger: true, symbol: 'trash' });
    if (yes) actions.remove(profile.id, { fromList });
  }
  $('rename-profile').addEventListener('click', () => rename(workspace.active));
  $('copy-profile').addEventListener('click', () => duplicate(workspace.active));
  $('delete-profile').addEventListener('click', () => remove(workspace.active));

  return {
    render() {
      empty($('profile-list'));
      $('profile-count').textContent = workspace.profiles.length;
      $('profile-origin').textContent = `来源：${workspace.active.origin || '已有配置'}`;
      $('profile-origin').title = workspace.active.origin || '已有配置';
      for (const profile of workspace.profiles) {
        const selected = profile.id === workspace.active.id;
        const row = el('div', `profile-item${selected ? ' selected' : ''}`);
        row.dataset.profileId = profile.id;
        row.setAttribute('role', 'group');
        row.setAttribute('aria-label', profile.name);
        const button = el('button', 'profile-select');
        button.type = 'button';
        button.setAttribute('aria-label', profile.name);
        if (selected) button.setAttribute('aria-current', 'true');
        const text = el('span', 'profile-item-text');
        const origin = profile.origin || '已有配置';
        const originText = el('small', 'profile-origin', `来源：${origin}`);
        originText.title = origin;
        text.append(el('strong', '', profile.name), el('small', '', profile.locked ? '游戏默认文件 · 只读' : `${selected ? '当前配置 · ' : ''}PalWorldSettings.ini`), originText);
        button.append(icon('file'), text);
        if (selected) button.append(icon('arrow'));
        button.addEventListener('click', () => openSourceDialog(profile));
        const tools = el('div', 'profile-item-actions');
        const choose = el('button', 'button secondary');
        choose.type = 'button';
        choose.dataset.profileAction = 'select';
        choose.disabled = selected || profile.locked === true;
        choose.append(icon(profile.locked ? 'eye' : 'check'), el('span', '', profile.locked ? '只读' : selected ? '已选择' : '选择'));
        if (profile.locked) choose.title = '游戏默认配置只读，不能选择；可创建副本后编辑。';
        choose.addEventListener('click', () => {
          if (selected || profile.locked) return;
          Promise.resolve(actions.select(profile.id)).catch(error => notify(error.message, true));
        });
        tools.append(choose);
        for (const [name, label, symbol, handler] of [
          ['rename', '重命名', 'edit', () => rename(profile)],
          ['duplicate', '创建副本', 'copy', () => duplicate(profile, true)],
          ['delete', '删除', 'trash', () => remove(profile, true)]
        ]) {
          if (profile.locked && name !== 'duplicate') continue;
          const action = el('button', `button secondary${name === 'delete' ? ' danger-hover' : ''}`);
          action.type = 'button';
          action.dataset.profileAction = name;
          action.append(icon(symbol), el('span', '', label));
          action.addEventListener('click', handler);
          tools.append(action);
        }
        row.append(button, tools);
        $('profile-list').append(row);
      }
    }
  };
}
