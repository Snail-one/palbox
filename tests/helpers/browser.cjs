const path = require('node:path');
const { dataPaths } = require('../../shared/data-paths.cjs');
const locations = dataPaths();
process.env.PLAYWRIGHT_BROWSERS_PATH ??= locations.browsers;
process.env.TMPDIR = locations.temporary;
module.exports = {
  ...require(require.resolve('playwright', { paths: [locations.dependencies] })),
  testOutput: (...parts) => path.join(locations.testResults, ...parts)
};
