import { failure } from './files.js';

/** Use the browser's time zone for download names; archive paths stay unchanged. */
export function createBackupDownloadFilename(timeZone = 'UTC') {
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    });
  } catch { throw failure('下载时区无效。'); }
  return (createdAt, attribute, worldId) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(createdAt)).map(part => [part.type, part.value]));
    const timestamp = `${parts.year}.${parts.month}.${parts.day}-${parts.hour}.${parts.minute}.${parts.second}`;
    return `${timestamp}-${attribute}-${worldId || 'unknown'}.tar.gz`;
  };
}
