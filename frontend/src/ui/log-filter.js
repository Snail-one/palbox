const ROUTINE_STATUS = /REST accessed endpoint \/v1\/api\/(?:info|metrics|players|settings) OK(?:\s|$)/;
const PREFIX = /^(?:\[[^\]]*\]\s*)+/;

/**
 * Hide successful status/settings reads, including old polling records.
 * The game logs every REST access; errors and user actions are kept.
 */
export function filterPollingLogs(text) {
  const lines = text.split('\n');
  const kept = [];
  let afterPollingLine = false;
  for (const line of lines) {
    if (ROUTINE_STATUS.test(line)) { afterPollingLine = true; continue; }
    if (line.replace(PREFIX, '').trim() === '' && (afterPollingLine || line.trim())) continue;
    afterPollingLine = false;
    kept.push(line);
  }
  return kept.join('\n');
}
