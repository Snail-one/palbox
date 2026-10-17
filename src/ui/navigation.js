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
  window.addEventListener('beforeunload', event => {
    if (isDirty()) { event.preventDefault(); event.returnValue = ''; }
  });
  document.addEventListener('keydown', event => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    const modalOpen = $('action-dialog').open || $('import-dialog').open;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && !modalOpen) { event.preventDefault(); onSave(); }
    if (event.key === '/' && !typing && !modalOpen) { event.preventDefault(); $('search').focus(); }
    if (event.key === 'Escape' && !modalOpen) closeSidebar();
  });
  return { closeSidebar };
}
