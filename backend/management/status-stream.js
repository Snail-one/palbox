import { API_SECURITY_HEADERS } from '../security-headers.js';
import { failure } from './files.js';

/** Push local task/process changes without querying the game's REST API. */
export async function streamStatus({ request, response, manager, auth }) {
  const initial = await manager.status({ scope: 'local' });
  if (!auth.session(request)) throw failure('请先登录管理面板。', 401);
  if (response.destroyed) return;
  response.writeHead(200, { ...API_SECURITY_HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-store, no-transform', 'X-Accel-Buffering': 'no' });
  response.flushHeaders(); response.write('retry: 1000\n\n');
  request.setTimeout(0); response.setTimeout(0);
  let closed = false, reading = false, dirty = false, previous;
  function authorized() {
    if (closed) return false;
    if (auth.session(request)) return true;
    response.end('event: unauthorized\ndata: {}\n\n'); close();
    return false;
  }
  function publish(value) {
    const text = JSON.stringify(value);
    if (text === previous || response.writableNeedDrain || closed) return;
    response.write(`event: status\ndata: ${text}\n\n`); previous = text;
  }
  async function refresh() {
    if (!authorized()) return;
    if (reading) { dirty = true; return; }
    if (response.writableNeedDrain) return;
    reading = true;
    try {
      do {
        dirty = false;
        const value = await manager.status({ scope: 'local' });
        if (!authorized()) return;
        publish(value);
      } while (dirty && !closed && !response.writableNeedDrain);
    } catch { response.end(); close(); }
    finally { reading = false; }
  }
  const heartbeat = setInterval(() => {
    if (authorized() && !response.writableNeedDrain) response.write(': heartbeat\n\n');
  }, 15000);
  function close() {
    closed = true; clearInterval(heartbeat);
    manager.off('state', refresh); response.off('drain', refresh);
  }
  manager.on('state', refresh);
  response.on('drain', refresh); response.once('close', close);
  publish(initial);
  void refresh(); // Catch changes between the initial snapshot and subscription.
}
