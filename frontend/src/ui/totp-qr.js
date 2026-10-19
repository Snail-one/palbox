import qrcode from './vendor/qrcode-generator.js';

export function totpUri({ secret, account, issuer = 'PalBox' }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const parameters = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${parameters}`;
}

export function totpQrImage(setup) {
  const qr = qrcode(0, 'M');
  qr.addData(totpUri(setup), 'Byte');
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
