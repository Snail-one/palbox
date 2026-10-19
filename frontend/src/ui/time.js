/** Format absolute server timestamps in the browser's system time zone. */
export function createTimeFormatter({ timeZone } = {}) {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', timeZoneName: 'longOffset', ...(timeZone ? { timeZone } : {})
  });
  function parts(value) {
    if (value === null || value === undefined || value === '') return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const fields = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
    return {
      date: `${fields.year}/${fields.month}/${fields.day}`,
      time: `${fields.hour}:${fields.minute}:${fields.second}`,
      milliseconds: String(date.getUTCMilliseconds()).padStart(3, '0'),
      zone: fields.timeZoneName.replace(/^GMT/, 'UTC').replace(/^UTC[+-]00:00$/, 'UTC')
    };
  }
  return {
    timeZone: formatter.resolvedOptions().timeZone,
    date(value) { return parts(value)?.date ?? '—'; },
    time(value) { return parts(value)?.time ?? '—'; },
    dateTime(value, { milliseconds = false, showZone = false } = {}) {
      const fields = parts(value);
      return fields ? `${fields.date} ${fields.time}${milliseconds ? '.' + fields.milliseconds : ''}${showZone ? ' ' + fields.zone : ''}` : '—';
    }
  };
}
