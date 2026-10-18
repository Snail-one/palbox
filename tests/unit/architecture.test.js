import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../frontend/src/', import.meta.url));
const domain = fileURLToPath(new URL('../../shared/domain/', import.meta.url));
const backend = fileURLToPath(new URL('../../backend/', import.meta.url));
const layerOf = file => file.startsWith(domain) ? 'domain' : path.relative(root, file).split(path.sep)[0];
async function sources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const children = await Promise.all(entries.map(entry => entry.isDirectory() ? sources(path.join(directory, entry.name)) : [path.join(directory, entry.name)]));
  return children.flat().filter(file => file.endsWith('.js'));
}

test('模块依赖无环，领域、应用和服务层不反向依赖界面', async () => {
  const graph = new Map();
  for (const file of [...await sources(root), ...await sources(domain), ...await sources(backend)]) {
    const source = await readFile(file, 'utf8');
    const imports = [...source.matchAll(/(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]/g)].filter(match => match[1].startsWith('.')).map(match => path.resolve(path.dirname(file), match[1]));
    graph.set(file, imports);
    if (file.startsWith(backend)) {
      for (const dependency of imports) assert.ok(!dependency.startsWith(root), `后端不应依赖前端：${file}`);
    } else {
      for (const dependency of imports) assert.ok(!dependency.startsWith(backend), `前端和共享模块不应依赖后端：${file}`);
    }
    const layer = layerOf(file);
    const allowed = { domain: ['domain'], application: ['domain', 'application'], services: ['domain', 'services'], ui: ['domain', 'ui'] }[layer];
    if (allowed) for (const dependency of imports) {
      assert.ok(allowed.includes(layerOf(dependency)), `${file} 不应依赖 ${dependency}`);
    }
    if (layer === 'domain' || layer === 'application') assert.doesNotMatch(source, /\b(window|document|localStorage)\s*[.(]/);
    if (!file.startsWith(backend)) assert.doesNotMatch(source, /window\.Pal|module\.exports|require\(/);
  }
  function visit(file, stack = []) {
    assert.ok(!stack.includes(file), `发现循环依赖：${[...stack, file].join(' → ')}`);
    for (const dependency of graph.get(file) || []) visit(dependency, [...stack, file]);
  }
  for (const file of graph.keys()) visit(file);
});
