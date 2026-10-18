import { isIP } from 'node:net';

function privateIpv4(value) {
  const [a, b] = value.split('.').map(Number);
  return a === 10 || a === 127
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254);
}

/**
 * Loopback, RFC1918, link-local and IPv6 ULA addresses.
 * Used to decide whether an immediate peer may be a trusted local proxy and
 * whether first-time setup may come from the network at all.
 */
export function isLoopbackOrPrivate(address) {
  if (typeof address !== 'string' || !address) return false;
  let value = address;
  if (value.toLowerCase().startsWith('::ffff:')) {
    const tail = value.slice(7);
    if (isIP(tail) === 4) value = tail;
    else {
      // IPv4-mapped addresses may also be written as ::ffff:7f00:1.
      const parts = tail.split(':');
      if (parts.length !== 2) return false;
      const high = Number.parseInt(parts[0], 16);
      const low = Number.parseInt(parts[1], 16);
      if (!Number.isInteger(high) || !Number.isInteger(low)) return false;
      value = `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
    }
  }
  if (isIP(value) === 4) return privateIpv4(value);
  if (isIP(value) !== 6) return false;
  const lower = value.toLowerCase();
  if (lower === '::1') return true;
  const first = Number.parseInt(lower.split(':')[0] || '0', 16);
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}
