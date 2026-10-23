export function updatePendingBadge(dom, container, pending) {
  if (!container) return;
  const previous = container.querySelector('.pending-badge');
  if (!pending) { previous?.remove(); return; }
  if (previous) return;
  const badge = dom.el('span', 'pending-badge', '待生效');
  badge.title = '已保存的参数尚未写入游戏配置，或需要重启游戏后生效';
  const reset = container.querySelector('.field-reset');
  if (reset) container.insertBefore(badge, reset);
  else container.append(badge);
}
