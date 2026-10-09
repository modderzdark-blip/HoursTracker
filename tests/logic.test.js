// Headless logic tests (CI job "logic"): runs the shared suite from www/js/selftest.js with node:assert.
const assert = require('node:assert');
require('../www/js/config.js');
require('../www/js/util.js');
require('../www/js/logic.js');
require('../www/js/levels.js');
require('../www/js/storage.js');
require('../www/js/meta.js');
const SELFTEST = require('../www/js/selftest.js');

(async function runAllTests() {
  const started = Date.now();
  let failed_count = 0;
  for (const entry of SELFTEST.TESTS) {
    const result = await SELFTEST.runTest(entry, assert);
    console.log(`${result.passed ? 'PASS' : 'FAIL'}  [${result.group}] ${result.name}  (${result.ms} ms)`);
    if (!result.passed) {
      failed_count += 1;
      console.log(`      ${result.error}`);
    }
  }
  console.log('------------------------------------------------------------');
  console.log(`${SELFTEST.TESTS.length - failed_count}/${SELFTEST.TESTS.length} passed, ${failed_count} failed, ${Date.now() - started} ms`);
  process.exit(failed_count === 0 ? 0 : 1);
})();
