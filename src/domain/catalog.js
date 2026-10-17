import { parse } from './config.js';
import template from './template.js';
import { fields, groups, validate } from './schema.js';

export function createCatalog({ source = template, metadata = fields, categories = groups, validateField = validate } = {}) {
  const known = new Set([...parse(source).entries.map(entry => entry.key), ...Object.keys(metadata)]);
  return {
    template: source,
    fields: metadata,
    groups: categories,
    validate: validateField,
    isUnknown: entry => !known.has(entry.key),
    matches(entry, query = '') {
      return `${entry.key} ${metadata[entry.key]?.label || ''}`.toLowerCase().includes(query.trim().toLowerCase());
    }
  };
}
