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
    $('main').focus();
  });
  function showPage({ focus = false } = {}) {
    const game = !['#configuration', '#configuration/advanced', '#configuration/profiles'].includes(window.location.hash);
    const gameRoutes = {
      '#game/players': { view: 'players', title: '玩家管理' },
      '#game/saves': { view: 'saves', title: '存档管理' }
    };
    const configurationRoutes = {
      '#configuration/advanced': { view: 'advanced', title: '高级编辑' },
      '#configuration/profiles': { view: 'profiles', title: '配置列表' }
    };
    const route = game
      ? gameRoutes[window.location.hash] || { view: 'overview', title: '服务器概况' }
      : configurationRoutes[window.location.hash] || { view: 'form', title: '可视化编辑' };
    const name = game ? '游戏管理' : '配置管理';
    $('game-page').hidden = !game;
    for (const [id, active] of [['game-navigation', game], ['configuration-navigation', !game]]) {
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
    $('configuration-apply').hidden = game || route.view === 'profiles';
    if (!game && route.view !== 'profiles') onConfigurationView(route.view);
    $('current-page').textContent = name;
    $('current-section').hidden = false;
    $('current-section').textContent = route.title;
    $('main').setAttribute('aria-label', route.title);
    document.title = `Palbox · ${name} · ${route.title}`;
    for (const [id, active] of [['nav-game', game], ['nav-configuration', !game]]) {
      $(id).classList.toggle('sidebar-active', active);
      if (active) $(id).setAttribute('aria-current', 'page');
      else $(id).removeAttribute('aria-current');
    }
    closeSidebar();
    if (focus) { window.scrollTo(0, 0); $('main').focus({ preventScroll: true }); }
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
    const modalOpen = Boolean(document.querySelector('dialog[open]'));
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
