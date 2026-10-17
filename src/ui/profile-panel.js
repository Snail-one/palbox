export function createProfilePanel({ dom, workspace, ask, beforeLeave, ready, isDirty, actions }) {
  const { $, el, icon, empty } = dom;
  $('new-profile').addEventListener('click', async () => {
    if (!(await beforeLeave())) return;
    const name = await ask({ title: '创建一个新的世界', description: '使用你提供的完整模板，开始一套独立配置。', name: '新的帕鲁世界', confirm: '创建配置', symbol: 'plus' });
    if (name) actions.create(name);
  });
  $('rename-profile').addEventListener('click', async () => {
    const name = await ask({ title: '给世界起个名字', description: '配置名称用于在工作台中区分不同世界，不会修改服务器名称。', name: workspace.active.name, confirm: '保存名称', symbol: 'edit' });
    if (name && name !== workspace.active.name) actions.rename(name);
  });
  $('copy-profile').addEventListener('click', async () => {
    if (!ready()) return;
    const name = await ask({ title: '复制这套配置', description: '副本包含当前编辑中的所有有效参数；原配置保留上一次保存的内容。', name: workspace.active.name + ' · 副本', confirm: '复制配置', symbol: 'copy' });
    if (name) actions.duplicate(name);
  });
  $('delete-profile').addEventListener('click', async () => {
    const yes = await ask({ title: '删除这套配置？', description: `「${workspace.active.name}」将从浏览器中删除${isDirty() ? '，包括尚未保存的更改' : ''}。${workspace.profiles.length === 1 ? '删除后会创建一套默认配置。' : '其他配置不受影响。'}`, confirm: '删除配置', danger: true, symbol: 'trash' });
    if (yes) actions.remove();
  });

  return {
    render() {
      empty($('profile-list'));
      $('profile-count').textContent = workspace.profiles.length;
      for (const profile of workspace.profiles) {
        const selected = profile.id === workspace.active.id;
        const button = el('button', `profile-item${selected ? ' selected' : ''}`);
        if (selected) button.setAttribute('aria-current', 'true');
        const text = el('span', 'profile-item-text');
        text.append(el('strong', '', profile.name), el('small', '', 'PalWorldSettings.ini'));
        button.append(icon('file'), text);
        if (selected) button.append(icon('arrow'));
        button.addEventListener('click', () => actions.select(profile.id));
        $('profile-list').append(button);
      }
    }
  };
}
