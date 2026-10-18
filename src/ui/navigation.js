export function createNavigation({ dom, window, isDirty, onSave, managed = false }) {
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
  $('nav-game').hidden = !managed;
  function showPage({ focus = false } = {}) {
    const game = managed && window.location.hash !== '#configuration';
    const name = game ? '游戏管理' : '配置管理';
    $('game-page').hidden = !game;
    $('configuration-page').hidden = game;
    $('configuration-profiles').hidden = game;
    $('configuration-actions').hidden = game;
    $('current-page').textContent = name;
    $('page-title').textContent = name;
    $('page-eyebrow').textContent = game ? 'PALWORLD SERVER' : 'PALWORLD CONFIGURATION';
    $('page-description').textContent = game ? '掌握服务器状态，管理玩家、日志与世界存档。' : managed ? '管理配置预设，编辑保存后应用到游戏服务端。' : '编辑与保存配置，定制你的帕鲁世界。';
    document.title = `Palbox · ${name}`;
    for (const [id, active] of [['nav-game', game], ['nav-configuration', !game]]) {
      $(id).classList.toggle('sidebar-active', active);
      if (active) $(id).setAttribute('aria-current', 'page');
      else $(id).removeAttribute('aria-current');
    }
    closeSidebar();
    if (focus) { window.scrollTo(0, 0); $('page-title').focus({ preventScroll: true }); }
  }
  window.addEventListener('hashchange', () => {
    if (['', '#game', '#configuration'].includes(window.location.hash)) showPage({ focus: true });
  });
  for (const id of ['nav-game', 'nav-configuration']) $(id).addEventListener('click', closeSidebar);
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
