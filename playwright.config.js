// Playwright configuration for the browser QA job (Chromium with mobile emulation).
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests/browser',
  timeout: 180000,
  fullyParallel: false,
  workers: 3,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'qa/playwright-report', open: 'never' }]],
  outputDir: 'qa/test-results',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node tests/browser/static-server.mjs',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
