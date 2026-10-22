import { MAX_PROFILES, GAME_DEFAULT_PROFILE_NAME } from '../../../shared/domain/workspace.js';

export function createProfilePanel({ dom, workspace, ask, beforeLeave, ready, isDirty, clipboard, notify, onSaveSource, onImportSource, readFile, validate, actions }) {
  const { $, el, icon, empty } = dom;
  const sourceDialog = $('source-view-dialog');
  const sourceText = $('source-view-text');
  const sourceDescription = $('source-view-description');
  let editingProfile = null;
  let sourceReadOnly = false;
  let importing = false;
  let readVersion = 0;
  onImportSource ??= async () => {};
  readFile ??= async () => { throw new Error('无法读取文件。'); };
  validate ??= source => source;
  const limitMessage = `最多保留 ${MAX_PROFILES} 套配置（含游戏默认配置），请先删除不需要的配置。`;
  function hasCapacity() {
    if (workspace.profiles.length < MAX_PROFILES) return true;
    notify(limitMessage, true);
    return false;
  }
  function closeSourceDialog() { if (importing) return; sourceDialog.close(); }
  function showDialogMode(mode) {
    const importingMode = mode === 'import';
    $('source-view-import').hidden = !importingMode;
    $('source-view-panel').hidden = importingMode;
    $('source-view-title').textContent = importingMode ? '导入配置' : '查看源配置';
    $('source-view-tab-import').className = importingMode ? 'selected' : '';
    $('source-view-tab-source').className = importingMode ? '' : 'selected';
    $('source-view-tab-import').setAttribute('aria-pressed', String(importingMode));
    $('source-view-tab-source').setAttribute('aria-pressed', String(!importingMode));
  }
  function openSourceDialog(profile = workspace.active, mode = 'source') {
    if (!profile) return;
    const origin = profile.origin || '已有配置';
    const hasOfficial = workspace.profiles.some(entry => entry.locked);
    sourceReadOnly = true;
    editingProfile = profile;
    sourceText.value = profile.source;
    sourceText.readOnly = true;
    $('source-view-file').textContent = hasOfficial ? '输入源码 · DefaultPalWorldSettings.ini' : '输入源码 · PalWorldSettings.ini';
    $('source-view-mode').textContent = 'UTF-8 · 只读';
    $('source-view-save').hidden = true;
    $('source-view-save').disabled = true;
    $('source-view-error').hidden = true;
    $('profile-import-text').value = '';
    $('profile-import-file').value = '';
    $('profile-import-error').hidden = true;
    $('source-view-import-description').textContent = `把导入内容中的同名参数覆盖到「${profile.name}」，未包含的参数保持当前值。底层为官方默认配置。REST API 保持开启，管理员密码沿用这套配置已有的密码；没有密码时会新生成一个。不采用导入内容中的这两项，也不会切换当前选择。`;
    sourceDescription.textContent = hasOfficial
      ? `「${profile.name}」的输入源码只读。来源：${origin}。底层读取官方默认配置 DefaultPalWorldSettings.ini，不能直接修改源码；请在可视化编辑或参数列表中修改参数，或使用「导入配置」。`
      : `「${profile.name}」的输入源码只读。来源：${origin}。安装服务端并检测到官方默认配置后，这套配置会以该文件为底。请在可视化编辑或参数列表中修改参数。`;
    showDialogMode(mode);
    sourceDialog.showModal();
    sourceText.scrollTop = 0;
  }
  $('view-profile-source').addEventListener('click', () => openSourceDialog());
  $('source-view-tab-import').addEventListener('click', () => showDialogMode('import'));
  $('source-view-tab-source').addEventListener('click', () => showDialogMode('source'));
  $('source-view-close').addEventListener('click', closeSourceDialog);
  $('source-view-ok').addEventListener('click', closeSourceDialog);
  sourceDialog.addEventListener('cancel', event => { if (importing) event.preventDefault(); });
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
  async function selectImportFile(file) {
    if (!file || importing) return;
    const version = ++readVersion;
    try {
      const text = await readFile(file);
      if (version !== readVersion || !sourceDialog.open) return;
      $('profile-import-text').value = text;
      $('profile-import-error').hidden = true;
    } catch (error) {
      if (version === readVersion && sourceDialog.open) {
        $('profile-import-error').textContent = error.message;
        $('profile-import-error').hidden = false;
      }
    }
  }
  function setImportDrag(on) {
    const zone = $('profile-import-drop');
    if (zone.classList) zone.classList.toggle('dragover', on);
  }
  $('profile-import-file').addEventListener('change', () => selectImportFile($('profile-import-file').files?.[0]));
  $('profile-import-drop').addEventListener('keydown', event => {
    if (event.target !== $('profile-import-drop')) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('profile-import-file').click(); }
  });
  for (const eventName of ['dragenter', 'dragover']) $('profile-import-drop').addEventListener(eventName, event => {
    event.preventDefault();
    setImportDrag(true);
  });
  $('profile-import-drop').addEventListener('dragleave', () => setImportDrag(false));
  $('profile-import-drop').addEventListener('drop', event => {
    event.preventDefault();
    setImportDrag(false);
    selectImportFile(event.dataTransfer?.files?.[0]);
  });
  $('profile-import-confirm').addEventListener('click', async () => {
    if (!editingProfile || importing) return;
    const button = $('profile-import-confirm');
    try {
      const source = validate($('profile-import-text').value);
      importing = true;
      button.disabled = true;
      $('profile-import-error').hidden = true;
      await onImportSource(editingProfile.id, source);
      importing = false;
      closeSourceDialog();
    } catch (error) {
      $('profile-import-error').textContent = error.message;
      $('profile-import-error').hidden = false;
    } finally {
      importing = false;
      button.disabled = false;
    }
  });
  $('new-profile').addEventListener('click', async () => {
    if (!hasCapacity()) return;
    if (!(await beforeLeave())) return;
    const name = await ask({ title: '创建一个新的世界', description: '创建一套独立配置。检测到官方默认文件时使用该文件的参数，输入源码只读，可在参数表单中修改；尚未安装时只包含管理模式必需项。', name: '新的帕鲁世界', confirm: '创建配置', symbol: 'plus' });
    if (name) actions.create(name);
  });
  async function rename(profile) {
    const name = await ask({ title: '给世界起个名字', description: '配置名称用于在工作台中区分不同世界，不会修改服务器名称。', name: profile.name, confirm: '保存名称', symbol: 'edit' });
    if (name && name !== profile.name) actions.rename(name, profile.id);
  }
  async function duplicate(profile, fromList = false) {
    if (!profile || !hasCapacity()) return;
    if (profile.id === workspace.active?.id && !ready()) return;
    const hasOfficial = workspace.profiles.some(entry => entry.locked);
    const description = hasOfficial
      ? `副本包含「${profile.name}」的当前参数。恢复基准与「${GAME_DEFAULT_PROFILE_NAME}」相同，都是官方默认配置；后续编辑与原配置相互独立。`
      : `副本包含「${profile.name}」的所有有效参数，并将这些参数作为自己的恢复基准；后续编辑与原配置相互独立。`;
    const name = await ask({ title: '复制这套配置', description, name: profile.name + ' · 副本', confirm: '复制配置', symbol: 'copy' });
    if (name) actions.duplicate(name, profile.id, { fromList });
  }
  async function remove(profile, fromList = false) {
    const discardsEdits = profile.id === workspace.active?.id && isDirty();
    const lastEditable = workspace.profiles.filter(candidate => !candidate.locked).length === 1;
    const hasLocked = workspace.profiles.some(candidate => candidate.locked);
    const afterDelete = lastEditable
      ? hasLocked ? '删除后将只保留「游戏默认配置」。' : '删除后配置库为空，可手动新建或等待检测到游戏默认配置。'
      : '其他配置不受影响。';
    const yes = await ask({ title: '删除这套配置？', description: `「${profile.name}」将从配置库中删除${discardsEdits ? '，包括尚未保存的更改' : ''}。${afterDelete}`, confirm: '删除配置', danger: true, symbol: 'trash' });
    if (yes) actions.remove(profile.id, { fromList });
  }
  $('rename-profile').addEventListener('click', () => rename(workspace.active));
  $('copy-profile').addEventListener('click', () => duplicate(workspace.active));
  $('delete-profile').addEventListener('click', () => remove(workspace.active));

  return {
    render() {
      empty($('profile-list'));
      $('profile-count').textContent = workspace.profiles.length;
      const full = workspace.profiles.length >= MAX_PROFILES;
      $('profile-count').title = `${workspace.profiles.length} / ${MAX_PROFILES} 套配置（含游戏默认配置）`;
      for (const id of ['new-profile', 'copy-profile', 'import-button']) {
        $(id).disabled = full;
        $(id).title = full ? limitMessage : '';
      }
      $('profile-origin').textContent = `来源：${workspace.active?.origin || '已有配置'}`;
      $('profile-origin').title = workspace.active?.origin || '已有配置';
      const activeLocked = !workspace.active || workspace.active.locked === true;
      $('rename-profile').disabled = activeLocked;
      $('delete-profile').disabled = activeLocked;
      $('rename-profile').title = activeLocked ? '游戏默认配置不能重命名。' : '';
      $('delete-profile').title = activeLocked ? '游戏默认配置不能删除。' : '';
      const hasActive = Boolean(workspace.active);
      for (const id of ['copy-profile', 'view-profile-source', 'restore-input-button', 'header-copy-button']) {
        if ($(id)) $(id).disabled = !hasActive || (id === 'copy-profile' && full);
      }
      if (!workspace.profiles.some(profile => profile.locked)) {
        const row = el('div', 'profile-item unavailable');
        row.setAttribute('role', 'group');
        row.setAttribute('aria-label', GAME_DEFAULT_PROFILE_NAME);
        row.setAttribute('aria-disabled', 'true');
        const button = el('button', 'profile-select');
        button.type = 'button'; button.disabled = true;
        const text = el('span', 'profile-item-text');
        text.append(el('strong', '', GAME_DEFAULT_PROFILE_NAME), el('small', '', '未检测到游戏默认配置，安装服务端后自动启用'));
        button.append(icon('file'), text);
        row.append(button);
        $('profile-list').append(row);
      }
      for (const profile of workspace.profiles) {
        const selected = profile.id === workspace.active?.id;
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
        const baseLabel = workspace.profiles.some(entry => entry.locked) ? '官方默认 · 源码只读' : '源码只读';
        text.append(el('strong', '', profile.name), el('small', '', `${selected ? '当前配置 · ' : ''}${profile.locked ? '游戏默认来源 · 可导入修改' : baseLabel}`), originText);
        button.append(icon('file'), text);
        if (selected) button.append(icon('arrow'));
        button.addEventListener('click', () => openSourceDialog(profile));
        const tools = el('div', 'profile-item-actions');
        const choose = el('button', 'button secondary');
        choose.type = 'button';
        choose.dataset.profileAction = 'select';
        choose.disabled = selected;
        choose.append(icon('check'), el('span', '', selected ? '已选择' : '选择'));
        if (profile.locked) choose.title = '选择后在可视化编辑中修改参数；也可点击条目导入配置。输入源码只读。';
        choose.addEventListener('click', () => {
          if (selected) return;
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
          if (name === 'duplicate' && full) { action.disabled = true; action.title = limitMessage; }
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
