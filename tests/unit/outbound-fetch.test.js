import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { downloadProxy, outboundFetch, withDownloadProxy } from '../../backend/management/outbound-fetch.js';

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

test('未配置代理时直接使用普通 fetch，NO_PROXY 不走代理', async () => {
  const seen = [];
  assert.equal(downloadProxy('https://example.com/file', { HTTPS_PROXY: 'http://127.0.0.1:9', NO_PROXY: 'example.com' }), null);
  assert.equal(downloadProxy('https://cdn.example.com/a', { HTTPS_PROXY: 'http://127.0.0.1:9', no_proxy: '.example.com' }), null);
  assert.equal(downloadProxy('https://valve.example.com/file', {}), null);
  const response = await outboundFetch('https://example.com/file', { signal: AbortSignal.timeout(1000) }, async (url, options) => {
    seen.push({ url, signal: options.signal instanceof AbortSignal });
    return new Response('ok');
  }, 0, {});
  assert.equal(await response.text(), 'ok');
  assert.deepEqual(seen, [{ url: 'https://example.com/file', signal: true }]);
});

test('HTTP 代理收到 CONNECT，并跟随重定向', async t => {
  const bodies = [];
  const proxy = http.createServer();
  proxy.on('connect', (request, socket, head) => {
    bodies.push({ path: request.url, auth: request.headers['proxy-authorization'] || '' });
    let received = head?.length ? head.toString() : '';
    const finish = () => {
      if (!received.includes('\r\n\r\n')) return;
      socket.off('data', onData);
      const payload = bodies.length === 1
        ? 'HTTP/1.1 302 Found\r\nLocation: http://example.com/final\r\nContent-Length: 0\r\n\r\n'
        : 'HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\npack';
      socket.end(payload);
    };
    const onData = chunk => { received += chunk.toString(); finish(); };
    socket.on('data', onData);
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    finish();
  });
  const port = await listen(proxy);
  t.after(() => new Promise(resolve => proxy.close(resolve)));
  const env = { HTTP_PROXY: `http://user:secret@127.0.0.1:${port}`, HTTPS_PROXY: `http://user:secret@127.0.0.1:${port}` };
  const response = await outboundFetch('http://example.com/start', { signal: AbortSignal.timeout(2000) }, () => { throw new Error('不应直连'); }, 0, env);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'pack');
  assert.deepEqual(bodies.map(item => item.path), ['example.com:80', 'example.com:80']);
  assert.equal(bodies[0].auth, `Basic ${Buffer.from('user:secret').toString('base64')}`);
});

test('HTTPS 下载经代理发出 TLS 握手', async t => {
  let target;
  let firstByte;
  const proxy = http.createServer();
  proxy.on('connect', (request, socket) => {
    target = request.url;
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    socket.once('data', chunk => { firstByte = chunk[0]; socket.destroy(); });
  });
  const port = await listen(proxy);
  t.after(() => new Promise(resolve => proxy.close(resolve)));
  await assert.rejects(
    outboundFetch('https://example.com/steamcmd_linux.tar.gz', { signal: AbortSignal.timeout(2000) }, () => { throw new Error('不应直连'); }, 0, { HTTPS_PROXY: `http://127.0.0.1:${port}` }),
    /代理下载失败|aborted|ECONNRESET/
  );
  assert.equal(target, 'example.com:443');
  assert.equal(firstByte, 0x16);
});

test('只配置 HTTPS_PROXY 时为 SteamCMD 补上 http_proxy', () => {
  const env = withDownloadProxy({ HTTPS_PROXY: 'http://127.0.0.1:7890', HOME: '/tmp' });
  assert.equal(env.http_proxy, 'http://127.0.0.1:7890');
  assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:7890');
  assert.equal(withDownloadProxy({ HTTP_PROXY: 'http://10.0.0.1:8080', HTTPS_PROXY: 'http://127.0.0.1:7890' }).http_proxy, undefined);
  assert.equal(withDownloadProxy({}).http_proxy, undefined);
});

test('无效或非 HTTP 代理地址会被拒绝', () => {
  assert.throws(() => downloadProxy('https://example.com', { HTTPS_PROXY: 'not a url' }), /下载代理地址无效/);
  assert.throws(() => downloadProxy('https://example.com', { HTTPS_PROXY: 'socks5://127.0.0.1:1080' }), /仅支持 HTTP 代理/);
});
