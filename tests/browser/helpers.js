// Shared helpers for the browser QA suite: console/network guards, the test hook, and real pointer input.
const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('@playwright/test');

const HOOK_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'android-debug-assets', 'public', 'test-hook.js'), 'utf8');
const ORIGIN = 'http://127.0.0.1:4173/';

/** Collects console errors, page errors and any request that leaves the local test server. */
function guardPage(page) {
  const problems = { console_errors: [], external_requests: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') problems.console_errors.push(message.text());
  });
  page.on('pageerror', (error) => problems.console_errors.push(String(error)));
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith(ORIGIN) && !url.startsWith('data:') && !url.startsWith('blob:')) problems.external_requests.push(url);
  });
  return problems;
}

function expectClean(problems) {
  expect(problems.console_errors, 'console errors').toEqual([]);
  expect(problems.external_requests, 'network requests outside the bundled game').toEqual([]);
}

/** Loads the game, injects the hook and gets past the first-launch name prompt. */
async function bootGame(page, options) {
  const opts = options || {};
  if (opts.fresh !== false) {
    await page.goto('/index.html');
    await page.evaluate(() => localStorage.clear());
  }
  await page.goto('/index.html');
  await page.addScriptTag({ content: HOOK_SOURCE });
  await expect.poll(() => page.evaluate(() => !!(window.SC && window.SC.game))).toBe(true);
  if (opts.name !== undefined) {
    await expect(page.locator('[data-modal="name"]')).toBeVisible();
    if (opts.name) {
      await page.fill('#name-input', opts.name);
      await page.click('#btn-name-save');
    } else {
      await page.click('#btn-name-skip');
    }
    // First launch also asks "Is this volume comfortable?" before Level 1 starts.
    await expect(page.locator('[data-modal="comfort"]')).toBeVisible();
    await page.click('#btn-comfort-ok');
    await waitState(page, 'PLAYING');
  }
}

async function reloadGame(page) {
  await page.reload();
  await page.addScriptTag({ content: HOOK_SOURCE });
  await expect.poll(() => page.evaluate(() => !!(window.SC && window.SC.game))).toBe(true);
}

function snapshot(page) {
  return page.evaluate(() => window.SC_TEST.snapshot());
}

async function waitState(page, state, timeout) {
  await expect.poll(async () => (await snapshot(page)).state, { timeout: timeout || 30000 }).toBe(state);
}

async function waitForModal(page, modal_id, timeout) {
  await expect.poll(async () => (await snapshot(page)).modal, { timeout: timeout || 30000 }).toBe(modal_id);
}

/** Swipe with real mouse pointer events from one cell to its neighbor. */
async function swipeMove(page, points) {
  const [from_x, from_y, to_x, to_y] = points;
  await page.mouse.move(from_x, from_y);
  await page.mouse.down();
  await page.mouse.move((from_x + to_x) / 2, (from_y + to_y) / 2, { steps: 4 });
  await page.mouse.move(to_x, to_y, { steps: 4 });
  await page.mouse.up();
}

/** Tap one candy, then the neighbor, with real touch events. */
async function tapTapMove(page, points) {
  const [from_x, from_y, to_x, to_y] = points;
  await page.touchscreen.tap(from_x, from_y);
  await page.waitForTimeout(120);
  await page.touchscreen.tap(to_x, to_y);
}

/** Plays hint moves with real input until the level ends (or `max_moves`). Alternates swipe and tap-tap. */
async function playLevel(page, options) {
  const opts = options || {};
  const max_moves = opts.max_moves || 60;
  let made = 0;
  let used_swipe = 0;
  let used_tap = 0;
  for (let attempt = 0; attempt < max_moves * 4 && made < max_moves; attempt += 1) {
    const state = await snapshot(page);
    if (state.state === 'WON' || state.state === 'LOST' || state.modal === 'win' || state.modal === 'lose') break;
    if (state.state !== 'PLAYING' || !state.move || state.modal) {
      await page.waitForTimeout(250);
      continue;
    }
    const before = state.moves_played;
    if (made % 2 === 0) {
      await swipeMove(page, state.move);
      used_swipe += 1;
    } else {
      await tapTapMove(page, state.move);
      used_tap += 1;
    }
    made += 1;
    await expect.poll(async () => {
      const after = await snapshot(page);
      return after.moves_played > before || after.state === 'WON' || after.state === 'LOST';
    }, { timeout: 30000 }).toBe(true);
  }
  return { made, used_swipe, used_tap };
}

/** Seeds a save (in the page) and reloads: { unlocked, stars_upto, name, meta }. */
async function seedSave(page, seed) {
  await page.evaluate((spec) => {
    const STORAGE = window.SC.STORAGE;
    const save = STORAGE.defaultSave();
    save.player_name = spec.name || 'Tester';
    save.name_asked = true;
    save.settings.comfort_done = true;
    for (let level = 1; level <= (spec.stars_upto || 0); level += 1) STORAGE.recordResult(save, level, { won: true, score: 12000 + (level % 7) * 1500, stars: 1 + (level % 3) });
    save.unlocked = Math.max(save.unlocked, spec.unlocked || 1);
    Object.assign(save.meta, spec.meta || {});
    Object.assign(save.settings, spec.settings || {});
    // Replace the running game's save too: on unload the page persists what it holds in memory.
    const live = window.SC.game.store.save;
    Object.keys(live).forEach((key) => delete live[key]);
    Object.assign(live, STORAGE.normalizeSave(save));
    localStorage.setItem(STORAGE.SAVE_KEY, STORAGE.serializeSave(save));
  }, seed);
  await reloadGame(page);
}

/** Level n's move or time budget from its record. */
function levelMoves(page, level_id) {
  return page.evaluate((id) => window.SC.LEVELS.getLevel(id).moves, level_id);
}

module.exports = { seedSave, levelMoves, HOOK_SOURCE, guardPage, expectClean, bootGame, reloadGame, snapshot, waitState, waitForModal, swipeMove, tapTapMove, playLevel };
