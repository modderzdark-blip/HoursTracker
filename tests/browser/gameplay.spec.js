// Browser QA (CI job "browser"): real pointer input, persistence, loss, pause/restart/quit mid-animation,
// back navigation, lifecycle, hints, reduced motion, settings, photo, self-test and accessibility.
const { test, expect } = require('@playwright/test');
const H = require('./helpers');

test.describe.configure({ mode: 'parallel' });

test('first launch plays Level 1 to a win with swipes and tap-taps; progress persists and Level 2 unlocks', async ({ page }) => {
  const problems = H.guardPage(page);
  await H.bootGame(page, { name: 'Florin' });
  const start = await H.snapshot(page);
  expect(start.level).toBe(1);
  expect(start.moves_left).toBe(20);
  await expect(page.locator('#tutorial-bubble')).toBeVisible();
  const played = await H.playLevel(page, { max_moves: 20 });
  expect(played.used_swipe).toBeGreaterThan(0);
  await H.waitForModal(page, 'win', 120000);
  await expect(page.locator('[data-modal="win"]')).toContainText('Great job, Florin!');
  await expect.poll(async () => (await H.snapshot(page)).unlocked).toBe(2);
  const best = await page.evaluate(() => window.SC.game.store.save.levels[1]);
  expect(best.best_stars).toBeGreaterThanOrEqual(1);
  expect(best.best_score).toBeGreaterThanOrEqual(1500);
  await page.waitForTimeout(400);
  await H.reloadGame(page);
  const after_reload = await page.evaluate(() => ({ unlocked: window.SC.game.store.save.unlocked, stars: window.SC.game.store.save.levels[1].best_stars, name: window.SC.game.store.save.player_name }));
  expect(after_reload).toEqual({ unlocked: 2, stars: best.best_stars, name: 'Florin' });
  await expect(page.locator('#title-greeting')).toHaveText('Hi, Florin!');
  await page.click('#btn-play');
  await H.waitState(page, 'MAP');
  await expect(page.locator('.map-node[data-level-id="2"]')).not.toHaveClass(/is-locked/);
  await expect(page.locator('.map-node[data-level-id="3"]')).toHaveClass(/is-locked/);
  H.expectClean(problems);
});

test('tap-tap selection rules; invalid swaps bounce back without using a move', async ({ page }) => {
  const problems = H.guardPage(page);
  await H.bootGame(page, { name: '' });
  const cell = (index) => page.evaluate((cell_index) => window.SC.game.renderer.cellCenter(cell_index), index);
  const first = await cell(24);
  await page.touchscreen.tap(first.x, first.y);
  await expect.poll(async () => (await H.snapshot(page)).selected).toBe(24);
  await page.touchscreen.tap(first.x, first.y);
  await expect.poll(async () => (await H.snapshot(page)).selected).toBe(-1);
  await page.touchscreen.tap(first.x, first.y);
  const far = await cell(0);
  await page.touchscreen.tap(far.x, far.y);
  await expect.poll(async () => (await H.snapshot(page)).selected).toBe(0);
  await page.touchscreen.tap(far.x, far.y);
  const invalid = await page.evaluate(() => {
    const logic = window.SC.game.logic;
    for (let index = 0; index < logic.cells.length; index += 1) {
      if ((index % logic.cols) + 1 < logic.cols && !window.SC.LOGIC.isValidSwap(logic, index, index + 1)) return [index, index + 1];
    }
    return null;
  });
  expect(invalid).not.toBeNull();
  const from = await cell(invalid[0]);
  const to = await cell(invalid[1]);
  await H.tapTapMove(page, [from.x, from.y, to.x, to.y]);
  await page.waitForTimeout(700);
  const after_invalid = await H.snapshot(page);
  expect(after_invalid.moves_left).toBe(20);
  expect(after_invalid.state).toBe('PLAYING');
  const valid = (await H.snapshot(page)).move;
  await H.tapTapMove(page, valid);
  await expect.poll(async () => (await H.snapshot(page)).moves_left).toBe(19);
  H.expectClean(problems);
});

test('a forced loss shows what was left and Try again restarts the level', async ({ page }) => {
  const problems = H.guardPage(page);
  await H.bootGame(page, { name: '' });
  await page.evaluate(() => window.SC.game.startLevel(10));
  await H.waitState(page, 'PLAYING');
  await page.evaluate(() => {
    window.SC.game.logic.moves_left = 1;
  });
  const move = (await H.snapshot(page)).move;
  await H.swipeMove(page, move);
  await H.waitForModal(page, 'lose', 60000);
  await expect(page.locator('[data-modal="lose"]')).toContainText('Out of moves');
  await expect(page.locator('[data-modal="lose"] .intro-goal').first()).toBeVisible();
  await page.click('#btn-retry');
  await H.waitState(page, 'PLAYING');
  const retry = await H.snapshot(page);
  expect(retry.level).toBe(10);
  expect(retry.moves_left).toBe(30);
  const record = await page.evaluate(() => window.SC.game.store.save.levels[10]);
  expect(record.attempts).toBe(1);
  expect(record.wins).toBe(0);
  H.expectClean(problems);
});

test('pause, restart and quit in the middle of an animation never leave a stuck state', async ({ page }) => {
  const problems = H.guardPage(page);
  await H.bootGame(page, { name: '' });
  // Slow the animation clock so "mid-animation" is a wide, deterministic window even on a loaded CI runner.
  await page.evaluate(() => window.SC.game.renderer.setSpeed(0.25));
  await H.swipeMove(page, (await H.snapshot(page)).move);
  await expect.poll(async () => (await H.snapshot(page)).state).toBe('RESOLVING');
  await page.click('#btn-pause');
  await H.waitForModal(page, 'pause');
  expect((await H.snapshot(page)).state).toBe('PAUSED');
  const frozen_at = (await H.snapshot(page)).timeline_now;
  await page.waitForTimeout(600);
  expect((await H.snapshot(page)).timeline_now).toBe(frozen_at);
  await page.click('#btn-restart');
  await H.waitForModal(page, 'confirm-restart');
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await H.waitState(page, 'PLAYING');
  await expect.poll(async () => (await H.snapshot(page)).busy, { timeout: 5000 }).toBe(false);
  expect((await H.snapshot(page)).moves_left).toBe(20);
  expect(await page.evaluate(() => window.SC.game.renderer.speed)).toBe(1);
  const before = (await H.snapshot(page)).moves_played;
  await H.swipeMove(page, (await H.snapshot(page)).move);
  await expect.poll(async () => (await H.snapshot(page)).moves_played, { timeout: 30000 }).toBe(before + 1);
  await H.waitState(page, 'PLAYING');
  // Quit to map in the middle of a cascade.
  await page.evaluate(() => window.SC.game.renderer.setSpeed(0.25));
  await H.swipeMove(page, (await H.snapshot(page)).move);
  await expect.poll(async () => (await H.snapshot(page)).state).toBe('RESOLVING');
  await page.keyboard.press('Escape');
  await H.waitForModal(page, 'pause');
  await page.click('#btn-quit');
  await H.waitForModal(page, 'confirm-quit');
  await page.getByRole('button', { name: 'Quit', exact: true }).click();
  await H.waitState(page, 'MAP');
  expect((await H.snapshot(page)).modal).toBeNull();
  await page.click('.map-node[data-level-id="1"]', { force: true }); // the current node bounces forever
  await H.waitForModal(page, 'intro');
  await page.click('#btn-intro-play');
  await H.waitState(page, 'PLAYING');
  const fresh = await H.snapshot(page);
  expect(fresh.moves_left).toBe(20);
  await H.swipeMove(page, fresh.move);
  await expect.poll(async () => (await H.snapshot(page)).moves_left, { timeout: 30000 }).toBe(19);
  H.expectClean(problems);
});

test('back navigation: modal first, gameplay -> pause -> "Quit to map?", map -> title -> "Exit game?"', async ({ page }) => {
  const problems = H.guardPage(page);
  await H.bootGame(page, { name: '' });
  const back = () => page.evaluate(() => window.SC.game.handleBack());
  expect(await back()).toBe('pause');
  await H.waitForModal(page, 'pause');
  expect(await back()).toBe('modal');
  await H.waitForModal(page, 'confirm-quit');
  expect(await back()).toBe('modal');
  await H.waitForModal(page, 'pause');
  await page.click('#btn-resume');
  await H.waitState(page, 'PLAYING');
  await page.evaluate(() => window.SC.game.goMap());
  await page.click('.map-node[data-level-id="1"]', { force: true }); // the current node bounces forever
  await H.waitForModal(page, 'intro');
  expect(await back()).toBe('modal');
  await expect.poll(async () => (await H.snapshot(page)).modal).toBeNull();
  expect((await H.snapshot(page)).state).toBe('MAP');
  expect(await back()).toBe('title');
  await H.waitState(page, 'TITLE');
  expect(await back()).toBe('exit-confirm');
  await H.waitForModal(page, 'confirm-exit');
  expect(await back()).toBe('modal');
  await expect.poll(async () => (await H.snapshot(page)).modal).toBeNull();
  expect((await H.snapshot(page)).state).toBe('TITLE');
  H.expectClean(problems);
});

test('going to the background pauses audio and timers; coming back resumes cleanly', async ({ page }) => {
  const problems = H.guardPage(page);
  await H.bootGame(page, { name: '' });
  await expect.poll(async () => (await H.snapshot(page)).audio.context).toBe('running');
  const setVisibility = (state) => page.evaluate((visibility) => {
    Object.defineProperty(document, 'visibilityState', { value: visibility, configurable: true });
    Object.defineProperty(document, 'hidden', { value: visibility === 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
  await setVisibility('hidden');
  await expect.poll(async () => (await H.snapshot(page)).audio.context).toBe('suspended');
  const hidden = await H.snapshot(page);
  expect(hidden.audio.lifecycle_paused).toBe(true);
  expect(hidden.audio.music_scheduler).toBe(false);
  expect(hidden.state).toBe('PAUSED');
  const clock = hidden.timeline_now;
  await page.waitForTimeout(800);
  expect((await H.snapshot(page)).timeline_now).toBe(clock);
  await setVisibility('visible');
  await expect.poll(async () => (await H.snapshot(page)).audio.context).toBe('running');
  const visible = await H.snapshot(page);
  expect(visible.audio.lifecycle_paused).toBe(false);
  expect(visible.audio.music_scheduler).toBe(true);
  expect(visible.modal).toBe('pause');
  await page.click('#btn-resume');
  await H.waitState(page, 'PLAYING');
  H.expectClean(problems);
});

test('hint appears after 6 s idle, clears on touch, and the Hint button shows one immediately', async ({ page }) => {
  const problems = H.guardPage(page);
  await H.bootGame(page, { name: '' });
  await page.evaluate(() => window.SC.game.startLevel(2));
  await H.waitState(page, 'PLAYING');
  expect((await H.snapshot(page)).hint).toBe(false);
  await expect.poll(async () => (await H.snapshot(page)).hint, { timeout: 9000 }).toBe(true);
  const center = await page.evaluate(() => window.SC.game.renderer.cellCenter(0));
  await page.touchscreen.tap(center.x, center.y);
  await expect.poll(async () => (await H.snapshot(page)).hint).toBe(false);
  await page.click('#btn-hint');
  await expect.poll(async () => (await H.snapshot(page)).hint).toBe(true);
  H.expectClean(problems);
});

test('settings persist; personal touches (name, photo, accent, message) work and stay local', async ({ page }) => {
  const problems = H.guardPage(page);
  await H.bootGame(page, { name: 'Mia' });
  await page.evaluate(() => window.SC.game.goTitle());
  await page.click('#btn-title-settings');
  await H.waitForModal(page, 'settings');
  await page.click('[data-theme="sprinkle"]');
  await page.click('[data-accent="ocean"]');
  await page.click('#toggle-music_on');
  await page.click('#toggle-colorblind');
  await page.fill('#settings-name', 'Ana');
  await page.press('#settings-name', 'Tab');
  await page.fill('#settings-message', 'You rock!');
  await page.press('#settings-message', 'Tab');
  // Pick a photo through the browser file chooser (the APK uses the Android system photo picker instead).
  const png = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2400;
    canvas.height = 1600;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 2400, 1600);
    gradient.addColorStop(0, '#2b5876');
    gradient.addColorStop(1, '#4e4376');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 2400, 1600);
    return canvas.toDataURL('image/png').split(',')[1];
  }), 'base64');
  const chooser_promise = page.waitForEvent('filechooser');
  await page.click('#btn-choose-photo');
  const chooser = await chooser_promise;
  await chooser.setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
  await expect.poll(() => page.evaluate(() => document.getElementById('app').classList.contains('has-photo'))).toBe(true);
  const stored_photo_size = await page.evaluate(() => {
    const image = new Image();
    return new Promise((resolve) => {
      image.onload = () => resolve([image.naturalWidth, image.naturalHeight]);
      image.src = window.SC.game.photo;
    });
  });
  expect(Math.max(...stored_photo_size)).toBeLessThanOrEqual(1280);
  await page.waitForTimeout(400);
  await H.reloadGame(page);
  const saved = await page.evaluate(() => ({ settings: window.SC.game.store.save.settings, name: window.SC.game.store.save.player_name, photo: !!window.SC.game.photo }));
  expect(saved.settings.theme).toBe('sprinkle');
  expect(saved.settings.accent).toBe('ocean');
  expect(saved.settings.music_on).toBe(false);
  expect(saved.settings.colorblind).toBe(true);
  expect(saved.settings.win_message).toBe('You rock!');
  expect(saved.name).toBe('Ana');
  expect(saved.photo).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('app')).getPropertyValue('--btn2').trim())).toBe('#1468d8');
  await page.click('#btn-title-settings');
  await page.getByRole('button', { name: 'Remove photo' }).click();
  await expect.poll(() => page.evaluate(() => document.getElementById('app').classList.contains('has-photo'))).toBe(false);
  H.expectClean(problems);
});

test('in-game self-test runs the logic tests and a 200-game bot simulation and reports green', async ({ page }) => {
  test.setTimeout(240000);
  const problems = H.guardPage(page);
  await H.bootGame(page, { name: '' });
  await page.evaluate(() => window.SC.game.goTitle());
  await page.click('#btn-title-settings');
  await page.click('#btn-self-test');
  await expect(page.locator('#selftest-status')).toHaveClass(/is-pass/, { timeout: 200000 });
  await expect(page.locator('#selftest-status')).toContainText('ALL GREEN');
  await expect(page.locator('#selftest-report')).toContainText('Bot: ');
  await expect(page.locator('#btn-copy-report')).toBeEnabled();
  const report = await page.locator('#selftest-report').textContent();
  require('node:fs').mkdirSync('qa', { recursive: true });
  require('node:fs').writeFileSync('qa/selftest-report.txt', report);
  H.expectClean(problems);
});

test('accessibility: every button is labelled, focus is visible, the live region announces moves', async ({ page }) => {
  const problems = H.guardPage(page);
  await H.bootGame(page, { name: '' });
  const unlabelled = await page.evaluate(() => Array.from(document.querySelectorAll('button')).filter((button) => !(button.getAttribute('aria-label') || button.textContent.trim())).map((button) => button.outerHTML.slice(0, 80)));
  expect(unlabelled).toEqual([]);
  await H.swipeMove(page, (await H.snapshot(page)).move);
  await expect.poll(() => page.locator('#live-region').textContent(), { timeout: 30000 }).toContain('moves left');
  await page.evaluate(() => window.SC.game.goTitle());
  await page.keyboard.press('Tab');
  const outline = await page.evaluate(() => {
    const focused = document.activeElement;
    return focused && focused.tagName === 'BUTTON' ? getComputedStyle(focused).outlineStyle : 'none';
  });
  expect(outline).not.toBe('none');
  const touch_targets = await page.evaluate(() => Array.from(document.querySelectorAll('.screen.is-active button')).map((button) => {
    const rect = button.getBoundingClientRect();
    return Math.min(rect.width, rect.height);
  }));
  touch_targets.forEach((size) => expect(size).toBeGreaterThanOrEqual(44));
  H.expectClean(problems);
});

test.describe('reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });
  test('the system reduced-motion preference turns off shake, wobble and most particles', async ({ page }) => {
    const problems = H.guardPage(page);
    await H.bootGame(page, { name: '' });
    expect((await H.snapshot(page)).reduced_motion).toBe(true);
    await H.swipeMove(page, (await H.snapshot(page)).move);
    let peak_particles = 0;
    for (let sample = 0; sample < 12; sample += 1) {
      peak_particles = Math.max(peak_particles, (await H.snapshot(page)).particles);
      await page.waitForTimeout(80);
    }
    expect(peak_particles).toBeLessThanOrEqual(60);
    await page.evaluate(() => window.SC.game.goTitle());
    const logo_animation = await page.evaluate(() => getComputedStyle(document.querySelector('.logo')).animationName);
    expect(logo_animation).toBe('none');
    H.expectClean(problems);
  });
});

test('performance: logic stays far under 8 ms per move; frame pacing and heap growth are recorded', async ({ page }) => {
  test.setTimeout(240000);
  const problems = H.guardPage(page);
  await H.bootGame(page, { name: '' });
  const logic = await page.evaluate(() => {
    const durations = [];
    window.SC.LEVELS.forEach((level) => {
      for (let game = 0; game < 6; game += 1) {
        let state = window.SC.LOGIC.createGame(level, { seed: level.seed + game });
        let guard = 0;
        while (state.status === 'playing' && guard < 60) {
          guard += 1;
          const move = window.SC.LOGIC.findHint(state);
          const started = performance.now();
          state = window.SC.LOGIC.applySwap(state, move.from, move.to).state;
          durations.push(performance.now() - started);
        }
      }
    });
    durations.sort((a, b) => a - b);
    return { moves: durations.length, median_ms: durations[Math.floor(durations.length / 2)], p95_ms: durations[Math.floor(durations.length * 0.95)], max_ms: durations[durations.length - 1] };
  });
  expect(logic.p95_ms).toBeLessThan(8);
  await page.evaluate(() => window.SC.game.startLevel(10));
  await H.waitState(page, 'PLAYING');
  const heap_before = await page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : 0));
  const frame_samples = [];
  for (let move = 0; move < 12; move += 1) {
    const state = await H.snapshot(page);
    if (state.modal || state.state !== 'PLAYING') break;
    const sampling = page.evaluate(() => new Promise((resolve) => {
      const intervals = [];
      let last = 0;
      const tick = (time) => {
        if (last) intervals.push(time - last);
        last = time;
        if (intervals.length < 90) requestAnimationFrame(tick);
        else resolve(intervals);
      };
      requestAnimationFrame(tick);
    }));
    await H.swipeMove(page, state.move);
    frame_samples.push(...(await sampling));
    await expect.poll(async () => (await H.snapshot(page)).state, { timeout: 30000 }).not.toBe('RESOLVING');
  }
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));
  const heap_after = await page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : 0));
  frame_samples.sort((a, b) => a - b);
  const report = {
    logic,
    frames: { samples: frame_samples.length, median_ms: frame_samples[Math.floor(frame_samples.length / 2)], p95_ms: frame_samples[Math.floor(frame_samples.length * 0.95)] },
    heap_mb: { before: +(heap_before / 1048576).toFixed(1), after: +(heap_after / 1048576).toFixed(1) },
    quality_level: (await H.snapshot(page)).quality,
  };
  require('node:fs').mkdirSync('qa', { recursive: true });
  require('node:fs').writeFileSync('qa/perf.json', JSON.stringify(report, null, 2));
  console.log('PERF', JSON.stringify(report));
  if (heap_before) expect(heap_after - heap_before).toBeLessThan(40 * 1048576);
  H.expectClean(problems);
});

test('a swipe made the instant a modal closes is not swallowed', async ({ page }) => {
  const problems = H.guardPage(page);
  await H.bootGame(page, { name: '' });
  await page.evaluate(() => window.SC.game.goMap());
  await page.click('.map-node[data-level-id="1"]', { force: true });
  await H.waitForModal(page, 'intro');
  await page.click('#btn-intro-play');
  await H.waitState(page, 'PLAYING');
  await H.swipeMove(page, (await H.snapshot(page)).move);
  await expect.poll(async () => (await H.snapshot(page)).moves_left, { timeout: 30000 }).toBe(19);
  H.expectClean(problems);
});
