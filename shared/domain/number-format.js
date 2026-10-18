// Pad decimal text without rounding or passing its significant digits through Number.
export function padDecimal(raw, places) {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(raw);
  if (!match || !(match[2] || match[3]) || !Number.isFinite(Number(raw))) return raw;
  const [, sign, whole, fraction = '', exponent] = match;
  if (exponent === undefined) return `${sign}${whole || '0'}.${fraction.padEnd(places, '0')}`;

  const digits = whole + fraction;
  if (!/[1-9]/.test(digits)) return `${sign}0.${'0'.repeat(places)}`;
  // Preserve underflowing scientific notation rather than generating unbounded text.
  if (Number(raw) === 0) return raw;
  const point = whole.length + Number(exponent);
  const integer = point <= 0 ? '0' : digits.slice(0, point).padEnd(point, '0');
  const decimal = point < 0 ? '0'.repeat(-point) + digits : digits.slice(point);
  return `${sign}${integer}.${decimal.padEnd(places, '0')}`;
}
