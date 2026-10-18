export function createProfilePanel({ dom, workspace, ask, beforeLeave, ready, isDirty, actions }) {
  const { $, el, icon, empty } = dom;
  $('new-profile').addEventListener('click', async () => {
    if (!(await beforeLeave())) return;
    const name = await ask({ title: '创建一个新的世界', description: '使用你提供的完整模板，开始一套独立配置。', name: '新的帕鲁世界', confirm: '创建配置', symbol: 'plus' });
    if (name) actions.create(name);
  });
  async function rename(profile) {
    const name = await ask({ title: '给世界起个名字', description: '配置名称用于在工作台中区分不同世界，不会修改服务器名称。', name: profile.name, confirm: '保存名称', symbol: 'edit' });
    if (name && name !== profile.name) actions.rename(name, profile.id);
  }
  async function duplicate(profile, fromList = false) {
    if (profile.id === workspace.active.id && !ready()) return;
    const name = await ask({ title: '复制这套配置', description: `副本包含「${profile.name}」的所有有效参数，并将这些参数作为自己的恢复基准；后续编辑与原配置相互独立。`, name: profile.name + ' · 副本', confirm: '复制配置', symbol: 'copy' });
    if (name) actions.duplicate(name, profile.id, { fromList });
  }
  async function remove(profile, fromList = false) {
    const discardsEdits = profile.id === workspace.active.id && isDirty();
    const yes = await ask({ title: '删除这套配置？', description: `「${profile.name}」将从配置库中删除${discardsEdits ? '，包括尚未保存的更改' : ''}。${workspace.profiles.length === 1 ? '删除后会创建一套默认配置。' : '其他配置不受影响。'}`, confirm: '删除配置', danger: true, symbol: 'trash' });
    if (yes) actions.remove(profile.id, { fromList });
  }
  $('rename-profile').addEventListener('click', () => rename(workspace.active));
  $('copy-profile').addEventListener('click', () => duplicate(workspace.active));
  $('delete-profile').addEventListener('click', () => remove(workspace.active));

  return {
    render() {
      empty($('profile-list'));
      $('profile-count').textContent = workspace.profiles.length;
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
        text.append(el('strong', '', profile.name), el('small', '', `${selected ? '当前配置 · ' : ''}PalWorldSettings.ini`));
        button.append(icon('file'), text);
        if (selected) button.append(icon('arrow'));
        button.addEventListener('click', () => actions.select(profile.id));
        const tools = el('div', 'profile-item-actions');
        for (const [name, label, symbol, handler] of [
          ['rename', '重命名', 'edit', () => rename(profile)],
          ['duplicate', '创建副本', 'copy', () => duplicate(profile, true)],
          ['delete', '删除', 'trash', () => remove(profile, true)]
        ]) {
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
