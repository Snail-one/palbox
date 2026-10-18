export function createNavigation({ dom, window, isDirty, onSave, onConfigurationView }) {
  const { $, document } = dom;
  const routes = {
    '#game': { page: 'game', view: 'overview', title: '服务器概况' },
    '#game/players': { page: 'game', view: 'players', title: '玩家管理' },
    '#saves': { page: 'saves', view: 'native', title: '官方备份' },
    '#saves/archives': { page: 'saves', view: 'archives', title: '手动备份' },
    '#game/saves': { page: 'saves', view: 'native', title: '官方备份' },
    '#configuration': { page: 'configuration', view: 'editor', mode: 'form', title: '配置编辑' },
    '#configuration/advanced': { page: 'configuration', view: 'editor', mode: 'advanced', title: '配置编辑' },
    '#configuration/profiles': { page: 'configuration', view: 'profiles', title: '配置列表' },
    '#login-logs': { page: 'login-logs', title: '登录日志' }
  };
  const pages = [
    { id: 'game', name: '游戏管理' },
    { id: 'saves', name: '存档管理' },
    { id: 'configuration', name: '配置管理' },
    { id: 'login-logs', name: '登录日志' }
  ];
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
    const route = routes[window.location.hash] || routes['#game'];
    const name = pages.find(page => page.id === route.page).name;
    for (const page of pages) {
      const active = page.id === route.page;
      $(`${page.id}-page`).hidden = !active;
      const parent = $(`nav-${page.id}`);
      parent.classList.toggle('sidebar-active', active);
      if (active) parent.setAttribute('aria-current', 'page');
      else parent.removeAttribute('aria-current');
      const links = [...($(`${page.id}-navigation`)?.querySelectorAll('a') ?? [])];
      for (const link of links) {
        const selected = active && link.dataset.view === route.view;
        if (selected) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }
      for (const target of new Set(links.map(link => link.getAttribute('aria-controls')))) {
        $(target).hidden = !links.some(link => link.hasAttribute('aria-current') && link.getAttribute('aria-controls') === target);
      }
    }
    const configuring = route.page === 'configuration';
    $('configuration-actions').hidden = !configuring;
    $('configuration-apply').hidden = !configuring || route.view === 'profiles';
    if (configuring && route.view !== 'profiles') onConfigurationView(route.mode || 'form');
    $('main').setAttribute('aria-label', route.title);
    document.title = name === route.title ? `PalBox · ${name}` : `PalBox · ${name} · ${route.title}`;
    closeSidebar();
    if (focus) { window.scrollTo(0, 0); $('main').focus({ preventScroll: true }); }
  }
  window.addEventListener('hashchange', () => {
    if (!window.location.hash || Object.hasOwn(routes, window.location.hash)) showPage({ focus: true });
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
