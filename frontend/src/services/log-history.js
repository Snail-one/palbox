import { formatLogBlocks } from '../../../shared/domain/logs.js';

const MAX_BLOCKS = 128; // Keep the browser's active history window within 2 MiB.
const key = block => `${block.file}:${block.start}`;

export function createLogHistory({ channel, request, watch, onLog, onState = () => {}, onOpen, onError }) {
  let blocks = [], before = null, after = null, hasMore = false;
  let loading = false, paused = false, closed = false, gap = false, windowed = false;
  let closeStream = null, generation = 0;
  const state = () => ({ hasMore, loading, paused, gap, windowed });
  function emit() {
    const text = formatLogBlocks(blocks, channel);
    onLog(text); onState(state());
    // The first page may start halfway through a large JSON record. Fetch its
    // beginning instead of showing an empty log while retained data exists.
    if (channel === 'all' && !text && hasMore && !paused) queueMicrotask(() => history.loadOlder());
  }
  function stop() { closeStream?.(); closeStream = null; }
  function merge(incoming, older) {
    const updates = new Map(incoming.map(block => [key(block), block]));
    const existing = new Set(blocks.map(key));
    const changed = blocks.map(block => updates.get(key(block)) || block);
    const added = incoming.filter(block => !existing.has(key(block)));
    return older ? [...added, ...changed] : [...changed, ...added];
  }
  function connect() {
    const current = ++generation;
    closeStream = watch({
      getCursor: () => after,
      onOpen() { if (!closed && current === generation) onOpen?.(); },
      onError(error) { if (!closed && current === generation) onError?.(error); },
      onPage(page) {
        if (closed || current !== generation || paused) return;
        if (page.gap) { blocks = []; before = null; gap = true; }
        const next = merge(page.blocks, false);
        if (next.length > MAX_BLOCKS) {
          paused = true; stop(); onState(state()); return;
        }
        const initial = !blocks.length;
        blocks = next; after = page.after;
        if (initial) { before = page.before; hasMore = page.hasMore; }
        emit();
      }
    });
  }
  const history = {
    close() { closed = true; generation++; stop(); },
    async loadOlder() {
      if (closed || loading || !hasMore || !before) return;
      loading = true; onState(state());
      const current = generation;
      try {
        const page = await request(`logs/history?channel=${encodeURIComponent(channel)}&before=${encodeURIComponent(before)}`);
        if (closed || current !== generation) return;
        if (page.gap) { gap = true; hasMore = false; return; }
        const next = merge(page.blocks, true);
        if (next.length > MAX_BLOCKS) {
          stop(); paused = true; windowed = true; blocks = page.blocks;
        } else blocks = next;
        before = page.before; hasMore = page.hasMore;
        emit();
      } catch (error) { if (!closed && current === generation) onError?.(error); }
      finally { if (!closed && current === generation) { loading = false; onState(state()); } }
    },
    latest() {
      if (closed) return;
      generation++; stop(); blocks = []; before = null; after = null;
      hasMore = false; loading = false; paused = false; gap = false; windowed = false;
      emit(); connect();
    }
  };
  connect();
  return history;
}
