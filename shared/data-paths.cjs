const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
function dataPaths(directory = process.env.PALBOX_DATA_DIR || path.join(projectRoot, 'data')) {
  const root = path.resolve(directory);
  return {
    root,
    configuration: path.join(root, 'palbox/.env'),
    runtime: path.join(root, 'runtime'),
    dependencies: path.join(root, 'dependencies'),
    cache: path.join(root, 'cache'),
    browsers: path.join(root, 'cache/playwright'),
    temporary: path.join(root, 'tmp'),
    transactions: path.join(root, 'palbox/transactions'),
    testResults: path.join(root, 'test-results')
  };
}

module.exports = { projectRoot, dataPaths };
