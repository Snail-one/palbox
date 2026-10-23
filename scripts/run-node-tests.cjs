const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { projectRoot, dataPaths } = require('../shared/data-paths.cjs');
const locations = dataPaths();
fs.mkdirSync(locations.temporary, { recursive: true });
const args = process.argv.slice(2);
const scope = ['unit', 'integration'].includes(args[0]) ? [args.shift()] : ['unit', 'integration'];
const files = scope.flatMap(group => fs.readdirSync(path.join(projectRoot, 'tests', group))
  .filter(name => name.endsWith('.test.js')).sort().map(name => path.join(projectRoot, 'tests', group, name)));
const child = spawn(process.execPath, ['--test', ...args, ...files], {
  cwd: projectRoot, stdio: 'inherit', env: { ...process.env, TMPDIR: locations.temporary }
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
