import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../src/', import.meta.url));
async function sources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const children = await Promise.all(entries.map(entry => entry.isDirectory() ? sources(path.join(directory, entry.name)) : [path.join(directory, entry.name)]));
  return children.flat().filter(file => file.endsWith('.js'));
}

test('模块依赖无环，领域、应用和服务层不反向依赖界面', async () => {
  const graph = new Map();
  for (const file of await sources(root)) {
    const source = await readFile(file, 'utf8');
    const imports = [...source.matchAll(/(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]/g)].map(match => path.resolve(path.dirname(file), match[1]));
    graph.set(file, imports);
    const layer = path.relative(root, file).split(path.sep)[0];
    const allowed = { domain: ['domain'], application: ['domain', 'application'], services: ['domain', 'services'], ui: ['domain', 'ui'] }[layer];
    if (allowed) for (const dependency of imports) {
      assert.ok(allowed.includes(path.relative(root, dependency).split(path.sep)[0]), `${file} 不应依赖 ${dependency}`);
    }
    if (layer === 'domain' || layer === 'application') assert.doesNotMatch(source, /\b(window|document|localStorage)\s*[.(]/);
    assert.doesNotMatch(source, /window\.Pal|module\.exports|require\(/);
  }
  function visit(file, stack = []) {
    assert.ok(!stack.includes(file), `发现循环依赖：${[...stack, file].join(' → ')}`);
    for (const dependency of graph.get(file) || []) visit(dependency, [...stack, file]);
  }
  for (const file of graph.keys()) visit(file);
});
