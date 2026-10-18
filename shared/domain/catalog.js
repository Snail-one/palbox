import template from './template.js';
import { fields, groups, validate } from './schema.js';
import { parse } from './config.js';
import { padDecimal } from './number-format.js';

export function createCatalog({ source = template, metadata = fields, categories = groups, validateField = validate } = {}) {
  const recognized = Object.create(null);
  const templateEntries = parse(source).entries;
  const templateKeys = new Set(templateEntries.map(entry => entry.key));
  const decimalPlaces = new Map(templateEntries.flatMap(({ key, raw }) => {
    const fraction = /^[+-]?\d+\.(\d+)$/.exec(raw)?.[1];
    return fraction ? [[key, fraction.length]] : [];
  }));
  for (const [key, field] of Object.entries(metadata)) {
    const eligible = field.verification?.status === 'verified' || (field.verification?.status === 'community' && templateKeys.has(key));
    if (eligible && field.verification.source && field.label?.trim() && field.description?.trim()) {
      recognized[key] = field;
    }
  }
  return {
    template: source,
    fields: recognized,
    groups: categories,
    validate: (key, raw) => Object.hasOwn(recognized, key) ? validateField(key, raw) : null,
    formatOutput(key, raw) {
      const field = recognized[key];
      const places = decimalPlaces.get(key);
      if (field?.type !== 'number' || field.integer || !places || validateField(key, raw)) return raw;
      return padDecimal(raw, places);
    },
    isUnknown: entry => !Object.hasOwn(recognized, entry.key),
    isCommunity: entry => recognized[entry.key]?.verification.status === 'community',
    summarize(entries) {
      const counts = { official: 0, community: 0, unknown: 0 };
      for (const { key } of entries) {
        const status = recognized[key]?.verification.status;
        counts[status === 'verified' ? 'official' : status === 'community' ? 'community' : 'unknown']++;
      }
      return counts;
    },
    matches(entry, query = '') {
      const field = recognized[entry.key];
      return `${entry.key} ${field?.label || ''} ${field?.description || ''}`.toLowerCase().includes(query.trim().toLowerCase());
    }
  };
}
