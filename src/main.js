import { createApp } from './app.js';
import { createCatalog } from './domain/catalog.js';
import { createRepository } from './services/storage.js';
import { createClipboard } from './services/clipboard.js';
import { readConfigFile, validateImport } from './services/config-files.js';

createApp({
  document,
  window,
  catalog: createCatalog(),
  repository: createRepository(() => window.localStorage),
  clipboard: createClipboard({ navigator, document }),
  files: { read: readConfigFile, validate: validateImport }
});
