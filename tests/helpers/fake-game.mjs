import http from 'node:http';
import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { parse, decodeString } from '../../shared/domain/config.js';

const file = process.argv[2];
const argvFile = process.argv[3];
await writeFile(argvFile, JSON.stringify(process.argv.slice(4)));
const values = new Map(parse(await readFile(file, 'utf8')).entries.map(e => [e.key, e.raw]));
const password = decodeString(values.get('AdminPassword'));
const saved = path.resolve(path.dirname(file), '../..');
const banFile = path.join(saved, 'SaveGames/banlist.txt');
async function bans() {
  try { return (await readFile(banFile, 'utf8')).trim().split('\n').filter(Boolean); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
const server = http.createServer(async (request, response) => {
  if (request.headers.authorization !== `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`) { response.writeHead(401); response.end(); return; }
  response.setHeader('Content-Type', 'application/json');
  const endpoint = request.url.split('/').at(-1);
  if (endpoint === 'ban' || endpoint === 'unban') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const ids = new Set(await bans());
    if (input.userid === 'steam_rejected') { response.writeHead(400); response.end('{}'); return; }
    if (endpoint === 'ban') ids.add(input.userid);
    else ids.delete(input.userid);
    const { mkdir } = await import('node:fs/promises');
    await mkdir(path.dirname(banFile), { recursive: true });
    await writeFile(banFile, [...ids].map(id => id + '\n').join(''));
  }
  if (endpoint === 'save') {
    try { await access(path.join(saved, 'fail-save')); response.writeHead(500); response.end('{}'); return; } catch {}
    await writeFile(path.join(saved, 'saved-by-api'), 'saved');
  }
  const value = {
    info: { version: 'test-1.0', servername: '模拟帕鲁服' },
    metrics: { serverfps: 60, currentplayernum: 1, maxplayernum: 32, uptime: 3600 },
    players: { players: (await bans()).includes('steam_test') ? [] : [{ name: '<script>test</script>', level: 12, userId: 'steam_test' }] }
  }[endpoint] || { ok: true };
  response.end(JSON.stringify(value));
  if (endpoint === 'shutdown' || endpoint === 'stop') server.close(() => process.exit(0));
});
server.listen(Number(values.get('RESTAPIPort')), '127.0.0.1', () => console.log('Fake PalServer ready'));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
