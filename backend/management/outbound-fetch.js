import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { Readable } from 'node:stream';

const REDIRECT = new Set([301, 302, 303, 307, 308]);

/** HTTP(S) 下载代理。未配置、或目标命中 NO_PROXY 时返回 null。 */
export function downloadProxy(url, env = process.env) {
  const target = new URL(url);
  if (bypassed(target.hostname, env)) return null;
  const raw = target.protocol === 'http:'
    ? env.http_proxy || env.HTTP_PROXY || ''
    : env.https_proxy || env.HTTPS_PROXY || env.http_proxy || env.HTTP_PROXY || '';
  if (!raw) return null;
  let proxy;
  try { proxy = new URL(raw); } catch { throw new Error('下载代理地址无效。'); }
  if (proxy.protocol !== 'http:' && proxy.protocol !== 'https:') throw new Error('下载代理仅支持 HTTP 代理，例如 http://127.0.0.1:7890。');
  if (!proxy.hostname) throw new Error('下载代理地址无效。');
  return proxy;
}

function bypassed(hostname, env) {
  const list = env.no_proxy || env.NO_PROXY || '';
  const host = hostname.toLowerCase();
  return list.split(',').some(item => {
    const rule = item.trim().toLowerCase().replace(/:\d+$/, '').replace(/^\./, '');
    return rule === '*' || (rule !== '' && (host === rule || host.endsWith(`.${rule}`)));
  });
}

function connectProxy(proxy, target, signal) {
  const transport = proxy.protocol === 'https:' ? https : http;
  const port = target.port || (target.protocol === 'https:' ? 443 : 80);
  const host = target.hostname.includes(':') ? `[${target.hostname}]` : target.hostname;
  const headers = {};
  if (proxy.username || proxy.password) {
    headers['Proxy-Authorization'] = `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}`;
  }
  return new Promise((resolve, reject) => {
    const request = transport.request({
      host: proxy.hostname, port: proxy.port || (proxy.protocol === 'https:' ? 443 : 80),
      method: 'CONNECT', path: `${host}:${port}`, headers, signal
    });
    request.once('connect', (response, socket, head) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`代理拒绝连接（HTTP ${response.statusCode}）。`));
        return;
      }
      if (head?.length) socket.unshift(head);
      resolve(socket);
    });
    request.once('error', error => reject(error.name === 'AbortError' ? error : new Error(`无法连接下载代理：${error.message}`)));
    request.end();
  });
}

function secureSocket(socket, hostname, signal) {
  return new Promise((resolve, reject) => {
    const tlsSocket = tls.connect({ socket, servername: hostname });
    const fail = error => { tlsSocket.destroy(); reject(error.name === 'AbortError' ? error : new Error(`代理下载失败：${error.message}`)); };
    tlsSocket.once('secureConnect', () => resolve(tlsSocket));
    tlsSocket.once('error', fail);
    signal?.addEventListener('abort', () => fail(signal.reason), { once: true });
  });
}

async function requestViaProxy(url, options, proxy) {
  const target = new URL(url);
  if (target.protocol !== 'https:' && target.protocol !== 'http:') throw new Error('下载地址必须是 HTTP(S)。');
  const tunnel = await connectProxy(proxy, target, options.signal);
  const socket = target.protocol === 'https:' ? await secureSocket(tunnel, target.hostname, options.signal) : tunnel;
  const transport = target.protocol === 'https:' ? https : http;
  const headers = {};
  if (options.headers && typeof options.headers === 'object') {
    for (const [key, value] of Object.entries(options.headers)) headers[key] = value;
  }
  return new Promise((resolve, reject) => {
    const fail = error => { socket.destroy(); reject(error.name === 'AbortError' ? error : new Error(`代理下载失败：${error.message}`)); };
    const request = transport.request({
      host: target.hostname, path: `${target.pathname}${target.search}`, method: options.method || 'GET',
      headers, createConnection: () => socket, signal: options.signal
    }, response => resolve(new Response(Readable.toWeb(response), { status: response.statusCode, headers: response.headers })));
    request.once('error', fail);
    request.end();
  });
}

/** SteamCMD 只认 http_proxy。仅配置了 HTTPS 代理时补上，不覆盖已有值。 */
export function withDownloadProxy(env) {
  const proxy = env.https_proxy || env.HTTPS_PROXY || env.http_proxy || env.HTTP_PROXY;
  if (!proxy || env.http_proxy || env.HTTP_PROXY) return env;
  return { ...env, http_proxy: proxy };
}

/** 配置了 HTTP(S)_PROXY 时经代理下载，否则使用普通 fetch。 */
export async function outboundFetch(url, options = {}, fetchImpl = globalThis.fetch, redirects = 0, env = process.env) {
  const proxy = downloadProxy(url, env);
  if (!proxy) return fetchImpl(url, options);
  const response = await requestViaProxy(url, options, proxy);
  if (!REDIRECT.has(response.status) || redirects >= 5) return response;
  const location = response.headers.get('location');
  await response.body?.cancel().catch(() => {});
  if (!location) return response;
  return outboundFetch(new URL(location, url), options, fetchImpl, redirects + 1, env);
}
