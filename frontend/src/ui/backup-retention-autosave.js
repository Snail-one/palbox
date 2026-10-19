const valid = value => value.trim() !== '' && Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 20;

export function createBackupRetentionAutosave({ getSaved, save, onState, delay = 400 }) {
  const states = new Map();
  function state(category) {
    if (!states.has(category)) states.set(category, { value: String(getSaved(category)), status: 'saved', error: '', timer: null, saving: false, requested: null, queued: false, promise: null });
    return states.get(category);
  }
  function publish(category) { onState(category, { ...state(category) }); }
  function settled(entry, category) {
    entry.status = !valid(entry.value) ? 'invalid' : Number(entry.value) === getSaved(category) ? 'saved' : 'pending';
  }
  function input(category, value) {
    const entry = state(category);
    clearTimeout(entry.timer); entry.timer = null;
    entry.value = String(value); entry.error = '';
    settled(entry, category);
    if (entry.saving && valid(entry.value)) entry.status = 'pending';
    if (entry.status === 'pending' || entry.saving && valid(entry.value)) entry.timer = setTimeout(() => { void flush(category); }, delay);
    publish(category);
  }
  function flush(category) {
    const entry = state(category);
    clearTimeout(entry.timer); entry.timer = null;
    if (!valid(entry.value)) { entry.status = 'invalid'; publish(category); return Promise.resolve(); }
    if (entry.saving) { entry.queued = Number(entry.value) !== Number(entry.requested); return entry.promise; }
    if (Number(entry.value) === getSaved(category)) { entry.status = 'saved'; entry.error = ''; publish(category); return Promise.resolve(); }
    const value = entry.value;
    entry.requested = value;
    entry.saving = true; entry.status = 'saving'; entry.error = ''; publish(category);
    entry.promise = (async () => {
      try {
        await save(category, Number(value));
        settled(entry, category);
      } catch (error) {
        if (entry.value === value) { entry.status = 'error'; entry.error = error.message; }
        else settled(entry, category);
      } finally {
        entry.saving = false;
        publish(category);
        const queued = entry.queued; entry.queued = false;
        if (queued) void flush(category);
      }
    })();
    return entry.promise;
  }
  return { input, flush, getState: category => ({ ...state(category) }) };
}
