const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { dataPaths, projectRoot } = require('../shared/data-paths.cjs');

function moveGenerated(source, target) {
  if (!fs.existsSync(source)) return;
  if (fs.existsSync(target)) throw new Error(`迁移目标已存在，未覆盖：${source} → ${target}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try { fs.renameSync(source, target); }
  catch (error) {
    if (error.code !== 'EXDEV') throw error;
    const stage = fs.mkdtempSync(path.join(path.dirname(target), '.migration-'));
    try {
      fs.cpSync(source, path.join(stage, 'contents'), { recursive: true, verbatimSymlinks: true });
      fs.renameSync(path.join(stage, 'contents'), target);
      fs.rmSync(source, { recursive: true });
    } finally { fs.rmSync(stage, { recursive: true, force: true }); }
  }
}

function prepare() {
  const locations = dataPaths();
  for (const directory of [locations.dependencies, locations.browsers, locations.temporary]) fs.mkdirSync(directory, { recursive: true });
  const legacy = path.join(projectRoot, 'node_modules');
  const target = path.join(locations.dependencies, 'node_modules');
  if (fs.existsSync(legacy)) {
    let previous;
    if (fs.existsSync(target)) {
      previous = path.join(locations.dependencies, 'previous-node_modules-' + Date.now());
      moveGenerated(target, previous);
    }
    try { moveGenerated(legacy, target); }
    catch (error) {
      if (previous && !fs.existsSync(target)) moveGenerated(previous, target);
      throw error;
    }
  }
  for (const [name, destination] of [['test-results', locations.testResults], ['playwright-report', path.join(locations.root, 'playwright-report')], ['.cache', path.join(locations.cache, 'legacy-project')]]) {
    if (fs.existsSync(path.join(projectRoot, name))) moveGenerated(path.join(projectRoot, name), fs.existsSync(destination) ? destination + '-legacy-' + Date.now() : destination);
  }
  const browsers = path.join(os.homedir(), '.cache/ms-playwright');
  if (fs.existsSync(browsers)) {
    for (const entry of fs.readdirSync(browsers)) {
      if (!/^(?:chromium|chromium_headless_shell|ffmpeg)-\d+$/.test(entry)) continue;
      const destination = path.join(locations.browsers, entry);
      if (!fs.existsSync(destination)) fs.cpSync(path.join(browsers, entry), destination, { recursive: true });
    }
  }
  return locations;
}

if (require.main === module) {
  const locations = prepare();
  if (!process.argv.includes('--migrate-only')) {
    const manifest = require('../package.json');
    fs.writeFileSync(path.join(locations.dependencies, 'package.json'), JSON.stringify({ private: true, dependencies: manifest.devDependencies }, null, 2) + '\n');
    const environment = { ...process.env, TMPDIR: locations.temporary, PLAYWRIGHT_BROWSERS_PATH: locations.browsers };
    const npm = spawnSync('npm', ['install', '--prefix', locations.dependencies, '--cache', path.join(locations.cache, 'npm'), '--ignore-scripts'], { env: environment, stdio: 'inherit' });
    if (npm.status !== 0) process.exit(npm.status || 1);
    const packageFile = require.resolve('playwright/package.json', { paths: [locations.dependencies] });
    const browserPackage = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
    const cli = path.resolve(path.dirname(packageFile), browserPackage.bin.playwright);
    const browser = spawnSync(process.execPath, [cli, 'install', 'chromium'], { env: environment, stdio: 'inherit' });
    if (browser.status !== 0) process.exit(browser.status || 1);
  }
  console.log(`开发测试依赖：${locations.dependencies}\n浏览器缓存：${locations.browsers}`);
}

module.exports = { prepare };
