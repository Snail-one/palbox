const ROUTINE_STATUS = /REST accessed endpoint \/v1\/api\/(?:info|metrics|players) OK/;
const PREFIX = /^(?:\[[^\]]*\]\s*)+/;

/**
 * Hide the panel's own status polling from the log view. The game logs every
 * REST access, so without this filter routine info/metrics/players calls flood
 * the window every few seconds. Errors and user actions are kept.
 */
export function filterPollingLogs(text) {
  const lines = text.split('\n');
  const kept = [];
  let afterPollingLine = false;
  for (const line of lines) {
    if (ROUTINE_STATUS.test(line)) { afterPollingLine = true; continue; }
    if (afterPollingLine && line.replace(PREFIX, '').trim() === '') continue;
    afterPollingLine = false;
    kept.push(line);
  }
  return kept.join('\n');
}
