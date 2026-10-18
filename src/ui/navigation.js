export function createNavigation({ dom, window, isDirty, onSave }) {
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
    const game = window.location.hash !== '#configuration';
    const routes = {
      '#game/players': { view: 'players', title: '玩家管理', description: '查看在线玩家，发送广播与管理玩家。' },
      '#game/saves': { view: 'saves', title: '存档管理', description: '保存世界进度，管理存档备份与恢复。' }
    };
    const route = routes[window.location.hash] || { view: 'overview', title: '服务器概况', description: '掌握服务器状态，管理游戏服务的安装与运行。' };
    const name = game ? '游戏管理' : '配置管理';
    $('game-page').hidden = !game;
    $('game-navigation').hidden = !game;
    for (const link of $('game-navigation').querySelectorAll('a')) {
      const selected = game && link.dataset.gameView === route.view;
      $(link.getAttribute('aria-controls')).hidden = !selected;
      if (selected) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    $('configuration-page').hidden = game;
    $('configuration-profiles').hidden = game;
    $('configuration-actions').hidden = game;
    $('current-page').textContent = name;
    $('current-section').hidden = !game;
    $('current-section').textContent = route.title;
    $('page-title').textContent = game ? route.title : name;
    $('page-eyebrow').textContent = game ? 'PALWORLD SERVER' : 'PALWORLD CONFIGURATION';
    $('page-description').textContent = game ? route.description : '管理配置预设，编辑保存后应用到游戏服务端。';
    document.title = `Palbox · ${name}${game ? ` · ${route.title}` : ''}`;
    for (const [id, active] of [['nav-game', game], ['nav-configuration', !game]]) {
      $(id).classList.toggle('sidebar-active', active);
      if (active) $(id).setAttribute('aria-current', 'page');
      else $(id).removeAttribute('aria-current');
    }
    closeSidebar();
    if (focus) { window.scrollTo(0, 0); $('page-title').focus({ preventScroll: true }); }
  }
  window.addEventListener('hashchange', () => {
    if (['', '#game', '#game/players', '#game/saves', '#configuration'].includes(window.location.hash)) showPage({ focus: true });
  });
  for (const link of document.querySelectorAll('.workspace-nav a')) link.addEventListener('click', closeSidebar);
  showPage();
  window.addEventListener('beforeunload', event => {
    if (isDirty()) { event.preventDefault(); event.returnValue = ''; }
  });
  document.addEventListener('keydown', event => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    const modalOpen = $('action-dialog').open || $('import-dialog').open;
    const configuring = !$('configuration-page').hidden;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && !modalOpen && configuring) { event.preventDefault(); onSave(); }
    if (event.key === '/' && !typing && !modalOpen && configuring) { event.preventDefault(); $('search').focus(); }
    if (event.key === 'Escape' && !modalOpen) closeSidebar();
  });
  return { closeSidebar };
}
