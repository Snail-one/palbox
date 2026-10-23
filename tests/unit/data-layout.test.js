import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, writeFile, readFile, readdir, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import paths from '../../shared/data-paths.cjs';

test('运行配置、依赖、缓存、暂存和测试产物统一位于指定数据目录', () => {
  const root = path.resolve('custom-data');
  const locations = paths.dataPaths(root);
  for (const value of Object.values(locations)) assert.ok(value === root || value.startsWith(root + path.sep));
  assert.equal(locations.configuration, path.join(root, 'palbox/.env'));
  assert.equal(locations.runtime, path.join(root, 'runtime'));
});

test('开发依赖和测试产物从根目录迁入数据目录，重复安装保留原依赖副本', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'palbox-layout-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = path.join(root, 'project');
  const data = path.join(root, 'data');
  const source = fileURLToPath(new URL('../../', import.meta.url));
  for (const name of ['scripts', 'shared', 'node_modules', 'test-results']) await mkdir(path.join(app, name), { recursive: true });
  await cp(path.join(source, 'scripts/test-dependencies.cjs'), path.join(app, 'scripts/test-dependencies.cjs'));
  await cp(path.join(source, 'shared/data-paths.cjs'), path.join(app, 'shared/data-paths.cjs'));
  await writeFile(path.join(app, 'node_modules/old.txt'), 'old dependency');
  await writeFile(path.join(app, 'test-results/old.txt'), 'old report');
  const env = { ...process.env, PALBOX_DATA_DIR: data, HOME: path.join(root, 'home') };
  const run = () => promisify(execFile)(process.execPath, [path.join(app, 'scripts/test-dependencies.cjs'), '--migrate-only'], { env });
  await run();
  assert.equal(await readFile(path.join(data, 'dependencies/node_modules/old.txt'), 'utf8'), 'old dependency');
  assert.equal(await readFile(path.join(data, 'test-results/old.txt'), 'utf8'), 'old report');
  await assert.rejects(access(path.join(app, 'node_modules')), { code: 'ENOENT' });
  await assert.rejects(access(path.join(app, 'test-results')), { code: 'ENOENT' });
  await mkdir(path.join(app, 'node_modules'));
  await writeFile(path.join(app, 'node_modules/new.txt'), 'new dependency');
  await run();
  assert.equal(await readFile(path.join(data, 'dependencies/node_modules/new.txt'), 'utf8'), 'new dependency');
  const previous = (await readdir(path.join(data, 'dependencies'))).find(name => name.startsWith('previous-node_modules-'));
  assert.equal(await readFile(path.join(data, 'dependencies', previous, 'old.txt'), 'utf8'), 'old dependency');
  assert.deepEqual((await readdir(app)).sort(), ['scripts', 'shared']);
});

test('测试依赖初始化按包的 bin 声明运行浏览器安装，缓存和临时文件均在数据目录', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'palbox-test-setup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = path.join(root, 'project'), data = path.join(root, 'data');
  const source = fileURLToPath(new URL('../../', import.meta.url));
  const browser = path.join(data, 'dependencies/node_modules/playwright');
  for (const directory of [path.join(app, 'scripts'), path.join(app, 'shared'), path.join(root, 'bin'), browser]) await mkdir(directory, { recursive: true });
  for (const name of ['scripts/test-dependencies.cjs', 'shared/data-paths.cjs']) await cp(path.join(source, name), path.join(app, name));
  await writeFile(path.join(app, 'package.json'), JSON.stringify({ devDependencies: { playwright: '1.64.1' } }));
  await writeFile(path.join(root, 'bin/npm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await writeFile(path.join(browser, 'package.json'), JSON.stringify({ exports: { './package.json': './package.json' }, bin: { playwright: 'cli.cjs' } }));
  await writeFile(path.join(browser, 'cli.cjs'), 'require("node:fs").writeFileSync(process.env.TMPDIR+"/browser-invocation.json", JSON.stringify({args:process.argv.slice(2),cache:process.env.PLAYWRIGHT_BROWSERS_PATH}));');
  await promisify(execFile)(process.execPath, [path.join(app, 'scripts/test-dependencies.cjs')], {
    env: { ...process.env, PALBOX_DATA_DIR: data, HOME: path.join(root, 'home'), PATH: path.join(root, 'bin') + path.delimiter + process.env.PATH }
  });
  const invocation = JSON.parse(await readFile(path.join(data, 'tmp/browser-invocation.json'), 'utf8'));
  assert.deepEqual(invocation, { args: ['install', 'chromium'], cache: path.join(data, 'cache/playwright') });
  const manifest = JSON.parse(await readFile(path.join(data, 'dependencies/package.json'), 'utf8'));
  assert.equal(manifest.dependencies.playwright, '1.64.1');
});
