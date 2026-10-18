export function createNavigation({ dom, window, isDirty, onSave, onConfigurationView }) {
  const { $, document } = dom;
  function closeSidebar() {
    $('sidebar').classList.remove('open');
    $('sidebar-scrim').hidden = true;
    $('mobile-menu').setAttribute('aria-expanded', 'false');
  }
  $('mobile-menu').addEventListener('click', () => {
    const open = !$('sidebar').classList.contains('open');
    $('sidebar').classList.toggle('open', open);
    $('sidebar-scrim').hidden = !open;
    $('mobile-menu').setAttribute('aria-expanded', String(open));
  });
  $('sidebar-scrim').addEventListener('click', closeSidebar);
  document.querySelector('.skip-link').addEventListener('click', event => {
    event.preventDefault();
    $('page-title').focus();
  });
  function showPage({ focus = false } = {}) {
    const game = !['#configuration', '#configuration/advanced', '#configuration/profiles'].includes(window.location.hash);
    const gameRoutes = {
      '#game/players': { view: 'players', title: '玩家管理', description: '查看在线玩家，发送广播与管理玩家。' },
      '#game/saves': { view: 'saves', title: '存档管理', description: '保存世界进度，管理存档备份与恢复。' }
    };
    const configurationRoutes = {
      '#configuration/advanced': { view: 'advanced', title: '高级编辑', description: '管理完整参数、输入源码与输出源码。' },
      '#configuration/profiles': { view: 'profiles', title: '配置列表', description: '选择、新建、复制和整理你的配置。' }
    };
    const route = game
      ? gameRoutes[window.location.hash] || { view: 'overview', title: '服务器概况', description: '掌握服务器状态，管理游戏服务的安装与运行。' }
      : configurationRoutes[window.location.hash] || { view: 'form', title: '可视化编辑', description: '按参数分类编辑配置，自动保存后应用到游戏。' };
    const name = game ? '游戏管理' : '配置管理';
    $('game-page').hidden = !game;
    for (const [id, active] of [['game-navigation', game], ['configuration-navigation', !game]]) {
      $(id).hidden = !active;
      const links = [...$(id).querySelectorAll('a')];
      for (const link of links) {
        const selected = active && (link.dataset.gameView || link.dataset.configurationView) === route.view;
        if (selected) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }
      for (const target of new Set(links.map(link => link.getAttribute('aria-controls')))) {
        $(target).hidden = !links.some(link => link.hasAttribute('aria-current') && link.getAttribute('aria-controls') === target);
      }
    }
    $('configuration-page').hidden = game;
    $('configuration-actions').hidden = game;
    const deployment = document.querySelector('.configuration-deployment');
    if (deployment) deployment.hidden = game || route.view === 'profiles';
    if (!game && route.view !== 'profiles') onConfigurationView(route.view);
    $('current-page').textContent = name;
    $('current-section').hidden = false;
    $('current-section').textContent = route.title;
    $('page-title').textContent = route.title;
    $('page-eyebrow').textContent = game ? 'PALWORLD SERVER' : 'PALWORLD CONFIGURATION';
    $('page-description').textContent = route.description;
    document.title = `Palbox · ${name} · ${route.title}`;
    for (const [id, active] of [['nav-game', game], ['nav-configuration', !game]]) {
      $(id).classList.toggle('sidebar-active', active);
      if (active) $(id).setAttribute('aria-current', 'page');
      else $(id).removeAttribute('aria-current');
    }
    closeSidebar();
    if (focus) { window.scrollTo(0, 0); $('page-title').focus({ preventScroll: true }); }
  }
  window.addEventListener('hashchange', () => {
    if (['', '#game', '#game/players', '#game/saves', '#configuration', '#configuration/advanced', '#configuration/profiles'].includes(window.location.hash)) showPage({ focus: true });
  });
  for (const link of document.querySelectorAll('.workspace-nav a')) link.addEventListener('click', closeSidebar);
  showPage();
  window.addEventListener('beforeunload', event => {
    if (isDirty()) { event.preventDefault(); event.returnValue = ''; }
  });
  document.addEventListener('keydown', event => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    const modalOpen = $('action-dialog').open || $('import-dialog').open || $('save-import-dialog').open;
    const configuring = !$('configuration-page').hidden;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && !modalOpen && configuring) { event.preventDefault(); onSave(); }
    if (event.key === '/' && !typing && !modalOpen && configuring && !$('configuration-editor').hidden) { event.preventDefault(); $('search').focus(); }
    if (event.key === 'Escape' && !modalOpen) closeSidebar();
  });
  return { closeSidebar, refresh: showPage, openEditor(mode = 'form') {
    const hash = mode === 'advanced' ? '#configuration/advanced' : '#configuration';
    if (window.location.hash === hash) showPage();
    else window.location.hash = hash;
  } };
}
