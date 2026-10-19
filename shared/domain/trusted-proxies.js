import { BlockList, isIP } from 'node:net';

/** Compile an explicit list of proxy IPs/CIDRs. Private addresses carry no implicit trust. */
export function trustedProxies(value = '') {
  const entries = typeof value === 'string' ? value.split(',').map(item => item.trim()).filter(Boolean) : value;
  if (!Array.isArray(entries)) throw new Error('PALBOX_TRUSTED_PROXIES 必须是逗号分隔的 IP 或 CIDR 列表。');
  const list = new BlockList();
  for (const entry of entries) {
    if (typeof entry !== 'string') throw new Error('PALBOX_TRUSTED_PROXIES 包含无效地址。');
    const [address, prefix, extra] = entry.split('/');
    const version = isIP(address);
    if (!version || extra !== undefined || (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) > (version === 4 ? 32 : 128)))) {
      throw new Error(`PALBOX_TRUSTED_PROXIES 包含无效 IP 或 CIDR：${entry}`);
    }
    const family = version === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) list.addAddress(address, family);
    else list.addSubnet(address, Number(prefix), family);
  }
  return address => {
    const version = isIP(address || '');
    return Boolean(version && list.check(address, version === 4 ? 'ipv4' : 'ipv6'));
  };
}
