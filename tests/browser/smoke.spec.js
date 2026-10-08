// Smoke test: the game boots offline with no console errors and no external requests.
const { test, expect } = require('@playwright/test');

test('game boots offline into the first-launch flow', async ({ page }) => {
  const console_errors = [];
  const external_requests = [];
  page.on('console', (message) => { if (message.type() === 'error') console_errors.push(message.text()); });
  page.on('pageerror', (error) => console_errors.push(String(error)));
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith('http://127.0.0.1:4173/') && !url.startsWith('data:') && !url.startsWith('blob:')) external_requests.push(url);
  });
  await page.goto('/index.html');
  await expect(page.locator('[data-modal="name"]')).toBeVisible();
  await page.click('#btn-name-skip');
  await expect.poll(() => page.evaluate(() => window.SC.game.state)).toBe('PLAYING');
  await page.screenshot({ path: 'qa/screenshots/smoke-level1.png' });
  expect(console_errors).toEqual([]);
  expect(external_requests).toEqual([]);
});
