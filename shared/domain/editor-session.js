import { parse, serialize, validateRaw } from './config.js';

/** Config editing state. No DOM, browser storage or UI navigation dependencies. */
export class EditorSession {
  #validate;
  #formatOutput;
  #doc;
  #baseline;
  #changes = new Map();
  #errors = new Map();
  #drafts = new Map();
  #sourceDraft = null;

  constructor(source, { validate = () => null, formatOutput = (key, raw) => raw, baselineSource = source } = {}) {
    this.#validate = validate;
    this.#formatOutput = formatOutput;
    this.reset(source, { baselineSource });
  }

  get entries() { return this.#doc.entries; }
  get sourceDraft() { return this.#sourceDraft; }
  get errorCount() { return this.#errors.size; }
  get dirty() { return this.#sourceDraft !== null || this.errorCount > 0 || this.source() !== this.#baseline.source; }
  get blockReason() {
    if (this.#sourceDraft !== null) return '请先应用源码修改，或还原源码后再操作。';
    return this.errorCount ? '请先修正标记的输入错误。' : null;
  }

  reset(source, { baselineSource = source } = {}) {
    const doc = parse(source);
    const baseline = baselineSource === source ? doc : parse(baselineSource);
    this.#doc = doc;
    this.#baseline = baseline;
    this.#changes.clear();
    this.#errors.clear();
    this.#drafts.clear();
    this.#sourceDraft = null;
  }

  raw(key) { return this.#changes.has(key) ? this.#changes.get(key) : this.entries.find(entry => entry.key === key)?.raw; }
  outputRaw(key) { return this.#formatOutput(key, this.raw(key)); }
  error(key) { return this.#errors.get(key) || ''; }
  draft(key) { return this.#drafts.get(key); }
  canRestoreField(key) {
    return this.entries.some(entry => entry.key === key) && this.#baseline.entries.some(entry => entry.key === key);
  }
  restoreField(key) {
    if (!this.canRestoreField(key)) return false;
    const raw = this.#baseline.entries.find(entry => entry.key === key).raw;
    // An imported baseline may contain values the current catalog cannot validate.
    // Restore its exact value, as with restoring the complete input configuration.
    this.#errors.delete(key);
    this.#drafts.delete(key);
    if (raw === this.entries.find(entry => entry.key === key).raw) this.#changes.delete(key);
    else this.#changes.set(key, raw);
    return true;
  }
  source() { return serialize(this.#doc, this.#changes); }
  toIni() {
    const output = new Map(this.entries.map(({ key }) => [key, this.outputRaw(key)]));
    return serialize(this.#doc, output, { download: true });
  }
  isModified(key) {
    const before = this.#baseline.entries.find(entry => entry.key === key)?.raw;
    const after = this.raw(key);
    if (before === undefined || after === undefined) return before !== after;
    return this.#formatOutput(key, before) !== this.#formatOutput(key, after);
  }

  changedKeys() {
    const before = this.#baseline.entries.map(entry => entry.key);
    const after = this.entries.map(entry => entry.key);
    return [...new Set([...before, ...after])].filter(key => this.isModified(key));
  }

  update(key, raw, draft = raw) {
    if (!this.entries.some(entry => entry.key === key)) throw new Error(`参数 ${key} 不存在。`);
    let error = null;
    try { validateRaw(raw); error = this.#validate(key, raw); }
    catch (caught) { error = caught.message; }
    if (error) {
      this.#errors.set(key, error);
      this.#drafts.set(key, draft);
    } else {
      this.#errors.delete(key);
      this.#drafts.delete(key);
      if (raw === this.entries.find(entry => entry.key === key).raw) this.#changes.delete(key);
      else this.#changes.set(key, raw);
    }
    return error;
  }

  reject(key, message, draft) {
    this.#errors.set(key, message);
    this.#drafts.set(key, draft);
  }

  setSourceDraft(text) { this.#sourceDraft = text === this.source() ? null : text; }
  discardSourceDraft() { this.#sourceDraft = null; }

  applySource(text) {
    const doc = parse(text);
    for (const entry of doc.entries) {
      if (this.raw(entry.key) === entry.raw) continue;
      const error = this.#validate(entry.key, entry.raw);
      if (error) throw new Error(`${entry.key}：${error}`);
    }
    this.#doc = doc;
    this.#changes.clear();
    this.#errors.clear();
    this.#drafts.clear();
    this.#sourceDraft = null;
  }
}
