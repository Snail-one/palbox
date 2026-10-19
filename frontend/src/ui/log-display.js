// A combined log can decorate an empty game line with only time/source labels.
const EMPTY_LINE = /^\s*(?:\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})? UTC\]\s*)?(?:\[(?:game|update|PalBox|游戏|安装更新|面板)\]\s*)?$/;

export function compactLogDisplay(text) {
  const lines = text.split('\n').filter(line => !EMPTY_LINE.test(line));
  return lines.join('\n') + (lines.length && text.endsWith('\n') ? '\n' : '');
}
