export const logTimestamp = at => `[${at.replace('T', ' ').replace(/Z$/, ' UTC')}]`;
const sources = { game: '游戏', steamcmd: '安装更新', palbox: '面板' };
const isLogin = text => /^(?:\[[^\]\r\n]+\]\s+)?登录(?:成功|失败|尝试过于频繁)（/.test(text);

export function readableLog(text) {
  text = text.replace(/\x1b(?:\[[0-?]*[ -/]*|\][^\x07\x1b]*)?$/, '')
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[P^_X][\s\S]*?\x1b\\/g, '')
    .replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]|\x1b[@-_]/g, '').replace(/\r\n/g, '\n');
  return text.split('\n').map(line => {
    const frames = line.split('\r');
    const result = [];
    for (const character of frames.at(-1) || frames.at(-2) || '') {
      if (character === '\b') result.pop();
      else if (!/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(character)) result.push(character);
    }
    return result.join('');
  }).join('\n');
}

/** Decode adjoining raw blocks together, including UTF-8/JSON split across pages. */
export function formatLogBlocks(blocks, channel) {
  const regions = [];
  let decoder, previous, text = '';
  for (const block of blocks) {
    const bytes = Uint8Array.from(atob(block.data), character => character.charCodeAt(0));
    let start = 0;
    if (!previous || block.file !== previous.file || block.start !== previous.end) {
      if (previous) regions.push(text);
      text = ''; decoder = new TextDecoder();
      while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
    }
    text += decoder.decode(bytes.subarray(start), { stream: true });
    previous = { file: block.file, end: block.start + bytes.length };
  }
  if (previous) regions.push(text);
  if (channel !== 'all') {
    const result = readableLog(regions.join(''));
    return channel === 'palbox' ? result.split(/(?<=\n)/).filter(line => !isLogin(line)).join('') : result;
  }
  const rows = [], pending = new Map();
  for (const region of regions) for (const line of region.split('\n')) {
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    if (!Object.hasOwn(sources, record?.channel) || typeof record.text !== 'string') continue;
    const parts = record.text.split('\n');
    for (let index = 0; index < parts.length; index++) {
      if (index === parts.length - 1 && !parts[index]) break;
      let row = pending.get(record.channel);
      if (!row) {
        row = { channel: record.channel, at: record.at, text: '' };
        rows.push(row); pending.set(record.channel, row);
      }
      row.text += parts[index];
      if (index < parts.length - 1) pending.delete(record.channel);
    }
  }
  return rows.map(row => {
    const value = readableLog(row.text);
    if (row.channel === 'palbox' && isLogin(value)) return '';
    return `${row.at ? logTimestamp(row.at) + ' ' : ''}[${sources[row.channel]}] ${value}\n`;
  }).join('');
}
