export function createParameterEvidence(dom, field, descriptionId) {
  const community = field.verification.status === 'community';
  const hint = dom.el('span', 'parameter-evidence');
  const badge = dom.el('span', `verification-badge ${community ? 'community-badge' : 'official-badge'}`, community ? '未验证' : '官方说明');
  badge.tabIndex = 0;
  badge.setAttribute('aria-describedby', descriptionId);
  badge.setAttribute('aria-label', `${field.key}：${community ? '未验证' : '官方说明'}`);
  const description = dom.el('span', 'parameter-details-panel', field.description);
  description.id = descriptionId;
  description.setAttribute('role', 'tooltip');
  hint.append(badge, description);
  return hint;
}
