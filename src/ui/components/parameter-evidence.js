export function createParameterEvidence(dom, field, descriptionId) {
  const community = field.verification.status === 'community';
  const details = dom.el('details', 'parameter-evidence');
  details.setAttribute('name', 'parameter-explanations');
  const badge = dom.el('summary', `verification-badge ${community ? 'community-badge' : 'official-badge'}`, community ? '未验证' : '官方说明');
  badge.setAttribute('aria-label', `${field.key}：${community ? '未验证' : '官方说明'}，点击查看详细说明`);
  const description = dom.el('p', 'parameter-details-panel', field.description);
  description.id = descriptionId;
  details.append(badge, description);
  return details;
}
