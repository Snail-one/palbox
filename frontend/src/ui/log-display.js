import { createTimeFormatter } from './time.js';

// A combined log can decorate an empty game line with only time/source labels.
const EMPTY_LINE = /^\s*(?:\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})? UTC\]\s*)?(?:\[(?:game|update|PalBox|游戏|安装更新|面板)\]\s*)?$/;

export function compactLogDisplay(text, options) {
  const formatter = createTimeFormatter(options);
  const times = new Map();
  const lines = text.split('\n').filter(line => !EMPTY_LINE.test(line));
  const local = lines.map(line => line.replace(/^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d{1,3})? UTC\]/, (original, date, time, fraction) => {
    if (!times.has(original)) {
      const formatted = formatter.dateTime(`${date}T${time}${fraction || ''}Z`, { milliseconds: Boolean(fraction), showZone: true });
      times.set(original, formatted === '—' ? original : `[${formatted.replaceAll('/', '-')}]`);
    }
    return times.get(original);
  }));
  return local.join('\n') + (lines.length && text.endsWith('\n') ? '\n' : '');
}
