export function updateModifiedBadge(dom, container, modified) {
  if (!container) return;
  const badge = container.querySelector('.modified-badge');
  if (!modified) { badge?.remove(); return; }
  if (badge) return;
  const next = dom.el('span', 'modified-badge', '已修改');
  next.title = '与这套配置最初输入的参数值不同';
  container.append(next);
}
