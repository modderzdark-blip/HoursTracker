import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env['BASE_URL'] ?? 'http://localhost:4173/';
const useLocalServer = process.env['BASE_URL'] === undefined;

/** Pixel 7 in landscape with touch. Headless Chromium renders WebGL through SwiftShader (CPU). */
const pixelLandscape = {
  ...devices['Pixel 7'],
  viewport: { width: 915, height: 412 },
  screen: { width: 915, height: 412 },
  isMobile: true,
  hasTouch: true,
};

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'pixel7-landscape',
      use: {
        ...pixelLandscape,
        launchOptions: {
          args: [
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--enable-precise-memory-info',
            '--js-flags=--expose-gc',
          ],
        },
      },
    },
  ],
  webServer: useLocalServer
    ? {
        // Always rebuild so tests never run against a stale dist/.
        command: 'npm run build && npm run preview',
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
      }
    : undefined,
});
