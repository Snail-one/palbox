import { createTimeFormatter } from './time.js';

/** Extract chat and successful broadcasts, keeping log-like message text intact. */
export function parseGameChat(text) {
  const records = [];
  for (const line of text.split(/\r?\n/).slice(0, -1)) {
    const prefix = line.match(/^(?:\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?) UTC\]\s+)?(?:\[(game|PalBox|update)\]\s+)?([\s\S]*)$/);
    if (prefix[2] === 'PalBox') {
      const announcement = prefix[3].match(/^\[(?:GM|ANNOUNCE)\] ([\s\S]*)$/);
      if (!announcement) continue;
      try {
        const message = JSON.parse(announcement[1]);
        if (typeof message === 'string') records.push({ at: prefix[1] ? prefix[1].replace(' ', 'T') + 'Z' : null, player: 'GM', message, type: 'broadcast' });
      } catch { /* Ignore incomplete or invalid announcement records. */ }
      continue;
    }
    if (prefix[2] && prefix[2] !== 'game') continue;
    const match = prefix[3].match(/^(?:\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]\s+)?\[CHAT\]\s+<([^>\r\n]+)> ?([\s\S]*)$/);
    if (!match) continue;
    const timestamp = prefix[1] || match[1];
    records.push({ at: timestamp ? timestamp.replace(' ', 'T') + 'Z' : null, player: match[2], message: match[3] });
  }
  return records;
}

export function createChatPanel({ dom, api, window }) {
  const { $, document, el } = dom;
  const timeFormat = createTimeFormatter();
  const panel = el('section', 'management-panel chat-management');
  panel.setAttribute('aria-labelledby', 'chat-title');
  panel.innerHTML = `<div class="management-heading chat-heading"><div><h2 id="chat-title">公告聊天</h2><p class="management-note">查看游戏内聊天，向在线玩家发送全服广播。</p></div><div class="log-history-actions"><button id="chat-older" type="button" class="button secondary" disabled>加载更早聊天</button><button id="chat-latest" type="button" class="button secondary">返回最新</button></div></div>
    <p id="chat-status" class="management-note" role="status">正在连接游戏聊天…</p>
    <p id="chat-history-note" class="management-note" role="status" hidden></p>
    <div id="chat-content" tabindex="0" role="region" aria-label="游戏聊天记录"><p class="chat-empty">正在读取聊天记录…</p></div>
    <form id="manager-announce" class="chat-composer"><label for="announce-message" class="sr-only">全服广播内容</label><textarea id="announce-message" rows="2" maxlength="500" required placeholder="输入公告，和全服玩家说点什么…" aria-describedby="announce-note announce-count"></textarea><div class="chat-composer-toolbar"><div class="chat-composer-context"><span class="chat-broadcast-label"><svg class="icon" aria-hidden="true"><use href="#i-globe"/></svg>全服广播</span><span id="announce-note" class="chat-send-state" role="status">读取中</span></div><div class="chat-composer-actions"><span id="announce-count" class="chat-char-count">0 / 500</span><span class="chat-keyboard-hint">Enter 发送 · Shift+Enter 换行</span><button class="button primary" type="submit" disabled>发送广播</button></div></div></form>`;
  $('game-chat-view').append(panel);
  const content = $('chat-content');
  let history = null, generation = 0, pageActive = true, unauthorized = false;
  let previousText = null, loadingOlder = false, recordCount = 0, scanOlder = true;

  function render(text) {
    const records = parseGameChat(text);
    recordCount = records.length;
    // REST and other game output do not require replacing the message list.
    const next = JSON.stringify(records);
    if (next === previousText) return;
    const bottom = content.scrollHeight - content.scrollTop - content.clientHeight < 30;
    const scrollTop = content.scrollTop, scrollHeight = content.scrollHeight;
    const fragment = document.createDocumentFragment();
    for (const record of records) {
      const row = el('article', 'chat-message');
      if (record.type === 'broadcast') row.classList.add('chat-message-broadcast');
      const avatar = el('span', 'chat-avatar', record.type === 'broadcast' ? 'GM' : Array.from(record.player)[0]);
      avatar.setAttribute('aria-hidden', 'true');
      const body = el('div', 'chat-message-body');
      const header = el('div', 'chat-message-heading');
      const player = el('strong', 'chat-player', record.type === 'broadcast' ? 'GM · 全服广播' : record.player);
      const time = el('time', 'chat-time', timeFormat.dateTime(record.at));
      if (record.at) { time.dateTime = record.at; time.title = timeFormat.dateTime(record.at, { showZone: true }); }
      header.append(player, time);
      body.append(header, el('p', 'chat-text', record.message));
      row.append(avatar, body);
      fragment.append(row);
    }
    if (!records.length) fragment.append(el('p', 'chat-empty', '当前日志范围内暂无聊天记录。玩家在游戏内发言后会显示在这里，也可加载更早聊天。'));
    content.replaceChildren(fragment);
    previousText = next;
    if (loadingOlder) content.scrollTop = scrollTop + content.scrollHeight - scrollHeight;
    else content.scrollTop = bottom ? content.scrollHeight : scrollTop;
  }

  async function loadOlder() {
    if (loadingOlder) return;
    loadingOlder = true;
    try { await history?.loadOlder(); } finally { loadingOlder = false; }
  }
  $('chat-older').addEventListener('click', loadOlder);
  $('chat-latest').addEventListener('click', () => {
    previousText = null; scanOlder = true; content.scrollTop = content.scrollHeight; history?.latest();
  });
  function stop() { generation++; history?.close(); history = null; }
  function sync() {
    if (!pageActive || unauthorized || document.hidden || $('game-page').hidden || $('game-chat-view').hidden) { stop(); return; }
    if (history) return;
    const current = ++generation;
    scanOlder = true;
    $('chat-status').textContent = '正在连接游戏聊天…';
    history = api.watchLogHistory('all', {
      onOpen() {
        if (current === generation) $('chat-status').textContent = `游戏聊天实时更新，断线后自动重连；时间为本地时间（${timeFormat.timeZone}）。`;
      },
      onLog(text) { if (current === generation) render(text); },
      onState(state) {
        if (current !== generation) return;
        $('chat-older').disabled = state.loading || !state.hasMore;
        $('chat-older').textContent = state.loading ? '正在加载…' : state.hasMore ? '加载更早聊天' : '已加载全部保留记录';
        const note = $('chat-history-note');
        note.hidden = !state.paused && !state.gap;
        note.textContent = state.paused ? '实时更新已暂停，可继续查看更早聊天，或返回最新。' : '部分历史记录已被轮换或清理。';
        // Chat may be buried beneath REST logs. Find recent chat on entry.
        if (scanOlder && !recordCount && state.hasMore && !state.loading && !state.paused) queueMicrotask(() => {
          if (current === generation && scanOlder) void history?.loadOlder();
        });
      },
      onError(error) {
        if (current !== generation) return;
        scanOlder = false;
        $('chat-status').textContent = error.message;
        if (error.status === 401) { unauthorized = true; stop(); }
      }
    });
  }
  window.addEventListener('hashchange', sync);
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pagehide', () => { pageActive = false; stop(); });
  window.addEventListener('pageshow', event => { if (event.persisted) { pageActive = true; sync(); } });
  sync();
}
