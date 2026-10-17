(function (root) {
  'use strict';
  const SECTION = '/Script/Pal.PalGameWorldSettings';
  class ConfigError extends Error {
    constructor(message, position, source) {
      const line = source.slice(0, position).split('\n').length;
      super(`${message}（第 ${line} 行）`);
      this.name = 'ConfigError';
      this.line = line;
    }
  }

  // Scan delimiters only outside quoted strings; nested Unreal tuples remain intact.
  function scan(text, start, outer, fail) {
    const stack = outer ? ['('] : [];
    const pairs = { ')': '(', ']': '[', '}': '{' };
    const commas = [];
    let quoted = false;
    for (let i = start; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char === '\r' || char === '\n') fail('字符串中不能包含换行', i);
        if (char === '\\') {
          if (text[i + 1] === '\r' || text[i + 1] === '\n') fail('字符串中不能包含换行', i);
          i++; continue;
        }
        if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') { quoted = true; continue; }
      if ('([{'.includes(char)) stack.push(char);
      else if (')]}'.includes(char)) {
        if (stack.pop() !== pairs[char]) fail('括号不匹配', i);
        if (outer && stack.length === 0) return { end: i, commas };
      } else if (char === ',' && stack.length === (outer ? 1 : 0)) commas.push(i);
    }
    if (quoted) fail('字符串引号未闭合', text.length);
    if (stack.length) fail('括号未闭合', text.length);
    if (outer) fail('OptionSettings 缺少结束括号', text.length);
    return { end: text.length, commas };
  }

  function parse(source) {
    if (typeof source !== 'string' || !source.trim()) throw new Error('配置内容为空，请导入文件或粘贴配置。');
    const fail = (message, position) => { throw new ConfigError(message, position, source); };
    const headers = [...source.matchAll(/^[\t \uFEFF]*\[([^\]\r\n]+)\][\t ]*(?:[;#].*)?\r?$/gm)];
    if (headers.filter(h => h[1] === SECTION).length > 1) fail('目标配置段落重复', 0);
    const candidates = [...source.matchAll(/^[\t \uFEFF]*OptionSettings[\t ]*=[\t ]*/gm)].filter(match => {
      const previous = headers.filter(h => h.index < match.index).at(-1);
      return !headers.length || previous?.[1] === SECTION;
    });
    if (!candidates.length) fail('未找到目标段落中的 OptionSettings=(...)', 0);
    if (candidates.length > 1) fail('存在多个 OptionSettings，无法确定应编辑哪一项', candidates[1].index);
    const match = candidates[0];
    const open = match.index + match[0].length;
    if (source[open] !== '(') fail('OptionSettings 的值必须用括号包裹', open);
    const { end, commas } = scan(source, open + 1, true, fail);
    const lineEnd = source.indexOf('\n', end);
    const tail = source.slice(end + 1, lineEnd === -1 ? source.length : lineEnd);
    if (!/^[\t ]*(?:[;#][^\r\n]*)?\r?$/.test(tail)) fail('结束括号后有无效内容', end + 1);
    const entries = [];
    const seen = new Set();
    const stops = [...commas, end];
    let start = open + 1;
    for (const stop of stops) {
      const token = source.slice(start, stop);
      if (!token.trim() && stops.length === 1) break;
      const field = token.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)([\s\S]*?)\s*$/);
      if (!field) fail('参数格式应为 参数名=值，且不能有多余逗号', start);
      const key = field[2];
      if (seen.has(key)) fail(`参数 ${key} 重复`, start);
      seen.add(key);
      const valueStart = start + field[1].length + key.length + field[3].length;
      const raw = field[4];
      validateRaw(raw);
      entries.push({ key, raw, valueStart, valueEnd: valueStart + raw.length });
      start = stop + 1;
    }
    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    return { source, entries, open, end, newline, hasSection: headers.some(h => h[1] === SECTION) };
  }

  function validateRaw(raw) {
    if (/[\r\n]/.test(raw.trim()) && raw.trim().startsWith('"')) throw new Error('字符串中不能包含换行，请使用单行文本。');
    const fail = message => { throw new Error(message); };
    const result = scan(raw, 0, false, fail);
    if (result.commas.length) throw new Error('值中包含未被引号或括号包裹的逗号。');
    if (raw.trim().startsWith('"') && !/^"(?:[^"\\]|\\[\s\S])*"$/.test(raw.trim())) throw new Error('字符串格式无效。');
    const trimmed = raw.trim();
    if (trimmed.startsWith('(')) {
      const tuple = scan(trimmed, 1, true, fail);
      if (tuple.end !== trimmed.length - 1) throw new Error('列表结束括号后有无效内容。');
    } else if (!trimmed.startsWith('"') && /[=;#"\s]/.test(trimmed)) throw new Error('特殊字符需要使用双引号包裹。');
    return raw;
  }

  function serialize(doc, changes = new Map(), { download = false } = {}) {
    const edits = doc.entries.filter(e => changes.has(e.key)).map(e => {
      const raw = changes.get(e.key);
      validateRaw(raw);
      return { start: e.valueStart, end: e.valueEnd, raw };
    });
    let source = doc.source;
    for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.raw + source.slice(edit.end);
    if (!download) return source;
    const updated = parse(source);
    const option = `OptionSettings=(${updated.entries.map(e => `${e.key}=${e.raw.trim().replace(/[\r\n]+[\t ]*/g, ' ')}`).join(',')})`;
    const assignmentStart = source.lastIndexOf('\n', updated.open) + 1;
    source = source.slice(0, assignmentStart) + option + source.slice(updated.end + 1);
    if (!updated.hasSection) source = `[${SECTION}]${updated.newline}${source.replace(/^\uFEFF/, '')}`;
    return source.endsWith('\n') ? source : source + updated.newline;
  }

  function decodeString(raw) {
    if (!raw.startsWith('"')) return raw;
    return raw.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  function encodeString(value) {
    if (/[\r\n]/.test(value)) throw new Error('请使用单行文本。');
    return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  const api = { SECTION, ConfigError, parse, validateRaw, serialize, decodeString, encodeString };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PalConfig = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
