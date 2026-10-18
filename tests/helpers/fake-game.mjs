import http from 'node:http';
import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { parse, decodeString } from '../../src/domain/config.js';

const file = process.argv[2];
const argvFile = process.argv[3];
await writeFile(argvFile, JSON.stringify(process.argv.slice(4)));
const values = new Map(parse(await readFile(file, 'utf8')).entries.map(e => [e.key, e.raw]));
const password = decodeString(values.get('AdminPassword'));
const saved = path.resolve(path.dirname(file), '../..');
const server = http.createServer(async (request, response) => {
  if (request.headers.authorization !== `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`) { response.writeHead(401); response.end(); return; }
  response.setHeader('Content-Type', 'application/json');
  const endpoint = request.url.split('/').at(-1);
  if (endpoint === 'save') {
    try { await access(path.join(saved, 'fail-save')); response.writeHead(500); response.end('{}'); return; } catch {}
    await writeFile(path.join(saved, 'saved-by-api'), 'saved');
  }
  const value = {
    info: { version: 'test-1.0', servername: '模拟帕鲁服' },
    metrics: { serverfps: 60, currentplayernum: 1, maxplayernum: 32, uptime: 3600 },
    players: { players: [{ name: '<script>test</script>', level: 12, userId: 'steam_test' }] }
  }[endpoint] || { ok: true };
  response.end(JSON.stringify(value));
  if (endpoint === 'shutdown') server.close(() => process.exit(0));
});
server.listen(Number(values.get('RESTAPIPort')), '127.0.0.1', () => console.log('Fake PalServer ready'));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
