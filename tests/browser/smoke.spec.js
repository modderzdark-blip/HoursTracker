// Pipeline bring-up smoke test: the page loads with no console errors and no external requests.
const { test, expect } = require('@playwright/test');

test('placeholder page loads offline', async ({ page }) => {
  const console_errors = [];
  const external_requests = [];
  page.on('console', (message) => { if (message.type() === 'error') console_errors.push(message.text()); });
  page.on('pageerror', (error) => console_errors.push(String(error)));
  page.on('request', (request) => { if (!request.url().startsWith('http://127.0.0.1:4173/') && !request.url().startsWith('data:')) external_requests.push(request.url()); });
  await page.goto('/index.html');
  await expect(page.locator('#title-text')).toHaveText('Sweet Cascade');
  await page.screenshot({ path: 'qa/screenshots/placeholder.png' });
  expect(console_errors).toEqual([]);
  expect(external_requests).toEqual([]);
});
