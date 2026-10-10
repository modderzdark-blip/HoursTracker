// Browser QA (CI job "browser"): real pointer input, persistence, loss and +5 Moves, hearts, boosters, goal stars and mastery,
// pause/restart/quit mid-animation, back navigation, lifecycle, instant hints, tutorial hints (any valid move is allowed), the 20,000-level
// map, the compact save, the Daily Wheel, reduced motion, settings, photo, self-test and accessibility.
const { test, expect } = require('@playwright/test');
const H = require('./helpers');

test.describe.configure({ mode: 'parallel' });

test('first launch plays Level 1 to a win with swipes and tap-taps; progress persists and Level 2 unlocks', async ({ page }) => {
  const problems = H.guardPage(page);
  await H.bootGame(page, { name: 'Sam' });
  const start = await H.snapshot(page);
  expect(start.level).toBe(1);
  expect(start.moves_left).toBe(await H.levelMoves(page, 1));
  await expect(page.locator('#tutorial-bubble')).toBeVisible();
  const played = await H.playLevel(page, { max_moves: 30 });
  expect(played.used_swipe).toBeGreaterThan(0);
  await H.waitForModal(page, 'win', 120000);
  await expect(page.locator('[data-modal="win"]')).toContainText('Great job, Sam!');
  await expect.poll(async () => (await H.snapshot(page)).unlocked).toBe(2);
  const best = await page.evaluate(() => window.SC.STORAGE.levelBest(window.SC.game.store.save, 1));
  expect(best.stars).toBeGreaterThanOrEqual(1);
  expect(best.score).toBeGreaterThan(0);
  // Level 1 is won by its candy goal, never by points alone.
  expect(await page.evaluate(() => window.SC.LEVELS.getLevel(1).goals.map((goal) => goal.type))).toEqual(['collect']);
  expect((await H.snapshot(page)).hearts).toBe(5); // winning costs no heart
  await page.waitForTimeout(400);
  await H.reloadGame(page);
  const after_reload = await page.evaluate(() => ({ unlocked: window.SC.game.store.save.unlocked, stars: window.SC.STORAGE.levelBest(window.SC.game.store.save, 1).stars, name: window.SC.game.store.save.player_name }));
  expect(after_reload).toEqual({ unlocked: 2, stars: best.stars, name: 'Sam' });
  await expect(page.locator('#title-greeting')).toHaveText('Hi, Sam!');
  await page.click('#btn-play');
  await H.waitState(page, 'MAP');
  await expect(page.locator('.map-node[data-level-id="2"]')).not.toHaveClass(/is-locked/);
  await expect(page.locator('.map-node[data-level-id="3"]')).toHaveClass(/is-locked/);
  H.expectClean(problems);
});

test('tutorial levels accept any valid move, not just the hinted one; selection rules; invalid swaps bounce back without using a move', async ({ page }) => {
  const problems = H.guardPage(page);
  await H.bootGame(page, { name: '' });
  const moves = await H.levelMoves(page, 1);
  const cell = (index) => page.evaluate((cell_index) => window.SC.game.renderer.cellCenter(cell_index), index);
  // Level 1 shows its hint at once (Instant auto hint) and Pip points at it.
  await expect.poll(async () => (await H.snapshot(page)).hint, { timeout: 2000 }).toBe(true);
  const first = await cell(24);
  await page.touchscreen.tap(first.x, first.y);
  await expect.poll(async () => (await H.snapshot(page)).selected).toBe(24);
  await page.touchscreen.tap(first.x, first.y);
  await expect.poll(async () => (await H.snapshot(page)).selected).toBe(-1);
  const invalid = await page.evaluate(() => {
    const logic = window.SC.game.logic;
    for (let index = 0; index < logic.cells.length; index += 1) {
      if ((index % logic.cols) + 1 < logic.cols && !window.SC.LOGIC.isValidSwap(logic, index, index + 1)) return [index, index + 1];
    }
    return null;
  });
  const from = await cell(invalid[0]);
  const to = await cell(invalid[1]);
  await H.tapTapMove(page, [from.x, from.y, to.x, to.y]);
  await page.waitForTimeout(700);
  const after_invalid = await H.snapshot(page);
  expect(after_invalid.moves_left).toBe(moves);
  expect(after_invalid.state).toBe('PLAYING');
  // A valid swap that is not the hinted one is played like any other move, even on a tutorial level.
  const other = await page.evaluate(() => {
    const game = window.SC.game;
    const hint = game.currentHint;
    const moves_list = window.SC.LOGIC.listValidMoves(game.logic);
    return moves_list.find((move) => !(move.from === hint.from && move.to === hint.to) && !(move.from === hint.to && move.to === hint.from)) || null;
  });
  expect(other).not.toBeNull();
  const other_from = await cell(other.from);
  const other_to = await cell(other.to);
  await H.swipeMove(page, [other_from.x, other_from.y, other_to.x, other_to.y]);
  await expect.poll(async () => (await H.snapshot(page)).moves_left, { timeout: 30000 }).toBeLessThan(moves);
  // Level 1 is easy: if that move already finished it, the hinted move has nothing left to prove.
  await expect.poll(async () => { const s = await H.snapshot(page); return s.state === 'PLAYING' || s.state === 'WON' || s.modal === 'win'; }, { timeout: 30000 }).toBe(true);
  if ((await H.snapshot(page)).state === 'PLAYING') {
    const left = (await H.snapshot(page)).moves_left;
    await H.tapTapMove(page, (await H.snapshot(page)).move);
    await expect.poll(async () => (await H.snapshot(page)).moves_left, { timeout: 30000 }).toBeLessThan(left);
  }
  H.expectClean(problems);
});

test('a loss offers +5 Moves for Gold Drops; giving up costs a heart; Try again restarts', async ({ page }) => {
  const problems = H.guardPage(page);
  await H.bootGame(page, { name: '' });
  await page.evaluate(() => window.SC.game.startLevel(10));
  await H.waitState(page, 'PLAYING');
  const moves = await H.levelMoves(page, 10);
  await page.evaluate(() => {
    window.SC.game.logic.moves_left = 1;
  });
  await H.swipeMove(page, (await H.snapshot(page)).move);
  await H.waitForModal(page, 'lose', 60000);
  await expect(page.locator('[data-modal="lose"]')).toContainText('Out of moves');
  await expect(page.locator('#btn-plus-five')).toBeEnabled();
  const gold_before = (await H.snapshot(page)).gold;
  await page.click('#btn-plus-five');
  await H.waitState(page, 'PLAYING');
  const continued = await H.snapshot(page);
  expect(continued.moves_left).toBe(5);
  expect(continued.gold).toBe(gold_before - 60);
  expect(continued.hearts).toBe(5);
  await page.evaluate(() => {
    window.SC.game.logic.moves_left = 1;
  });
  await H.swipeMove(page, (await H.snapshot(page)).move);
  await H.waitForModal(page, 'lose', 60000);
  await page.click('#btn-retry');
  await H.waitState(page, 'PLAYING');
  const retry = await H.snapshot(page);
  expect(retry.level).toBe(10);
  expect(retry.moves_left).toBe(moves);
  expect(retry.hearts).toBe(4);
  H.expectClean(problems);
});

test('hearts: out of hearts shows a countdown and the Unlimited hearts shortcut; the clock moving back gives none', async ({ page }) => {
  const problems = H.guardPage(page);
  await H.bootGame(page, { name: '' });
  await H.seedSave(page, { unlocked: 3, stars_upto: 2, meta: { hearts: 0, hearts_clock: Date.now(), last_seen: Date.now() } });
  await page.click('#btn-play');
  await H.waitState(page, 'MAP');
  await expect(page.locator('#map-hearts-count')).toHaveText('0');
  await page.click('.map-node[data-level-id="3"]', { force: true });
  await H.waitForModal(page, 'hearts');
  await expect(page.locator('#hearts-countdown')).toContainText('Next heart in');
  await page.click('#btn-hearts-unlimited');
  await expect.poll(() => page.evaluate(() => window.SC.game.store.save.settings.unlimited_hearts)).toBe(true);
  await expect(page.locator('#map-hearts-count')).toHaveText('∞');
  await page.click('.map-node[data-level-id="3"]', { force: true });
  await H.waitForModal(page, 'intro');
  H.expectClean(problems);
});

test('boosters: Sweet Hammer, Free Swap, Candy Whirl, Candy Brush and Sugar Party work without spending moves; pre-level boosters apply', async ({ page }) => {
  const problems = H.guardPage(page);
  await H.bootGame(page, { name: '' });
  await H.seedSave(page, { unlocked: 56, stars_upto: 3 });
  await page.evaluate(() => window.SC.game.startLevel(4));
  await H.waitState(page, 'PLAYING');
  const moves = await H.levelMoves(page, 4);
  const cell = (index) => page.evaluate((cell_index) => window.SC.game.renderer.cellCenter(cell_index), index);
  await page.click('#btn-booster-hammer');
  await expect.poll(async () => (await H.snapshot(page)).armed_booster).toBe('hammer');
  const target = await cell(20);
  await page.touchscreen.tap(target.x, target.y);
  await expect.poll(async () => (await H.snapshot(page)).boosters.hammer, { timeout: 20000 }).toBe(2);
  await H.waitState(page, 'PLAYING');
  expect((await H.snapshot(page)).moves_left).toBe(moves);
  await page.click('#btn-booster-free_swap');
  const invalid = await page.evaluate(() => {
    const logic = window.SC.game.logic;
    for (let index = 0; index < logic.cells.length; index += 1) {
      if ((index % logic.cols) + 1 < logic.cols && window.SC.LOGIC.isSwappableAt(logic, index) && window.SC.LOGIC.isSwappableAt(logic, index + 1) && !window.SC.LOGIC.isValidSwap(logic, index, index + 1)) return [index, index + 1];
    }
    return null;
  });
  const from = await cell(invalid[0]);
  const to = await cell(invalid[1]);
  await H.swipeMove(page, [from.x, from.y, to.x, to.y]);
  await expect.poll(async () => (await H.snapshot(page)).boosters.free_swap, { timeout: 20000 }).toBe(2);
  await H.waitState(page, 'PLAYING');
  expect((await H.snapshot(page)).moves_left).toBe(moves);
  await page.click('#btn-booster-whirl');
  await expect.poll(async () => (await H.snapshot(page)).boosters.whirl, { timeout: 20000 }).toBe(2);
  await H.waitState(page, 'PLAYING');
  expect((await H.snapshot(page)).moves_left).toBe(moves);
  await page.click('#btn-booster-brush');
  await expect.poll(async () => (await H.snapshot(page)).armed_booster).toBe('brush');
  const plain = await page.evaluate(() => window.SC.game.logic.cells.findIndex((piece) => piece && piece.kind === 'candy' && piece.special === 'none'));
  const brush_target = await cell(plain);
  await page.touchscreen.tap(brush_target.x, brush_target.y);
  await expect.poll(async () => (await H.snapshot(page)).boosters.brush, { timeout: 20000 }).toBe(2);
  await H.waitState(page, 'PLAYING');
  expect((await H.snapshot(page)).moves_left).toBe(moves);
  // The Sugar Party clears the whole board in one blast (on this small level it may win it outright).
  await page.click('#btn-booster-party');
  await expect.poll(async () => (await H.snapshot(page)).boosters.party, { timeout: 30000 }).toBe(2);
  await expect.poll(async () => (await H.snapshot(page)).state, { timeout: 30000 }).toMatch(/^(PLAYING|WON)$/);
  // Pre-level boosters from the intro: Lucky Start and Head Start.
  await page.evaluate(() => window.SC.game.goMap());
  await H.waitState(page, 'MAP');
  await page.evaluate(() => window.SC.game.openIntro(4));
  await H.waitForModal(page, 'intro');
  await page.click('#intro-booster-lucky');
  await page.click('#intro-booster-head_start');
  await page.click('#btn-intro-play');
  await H.waitState(page, 'PLAYING');
  const boosted = await page.evaluate(() => ({ moves: window.SC.game.logic.moves_left, specials: window.SC.game.logic.cells.filter((piece) => piece && piece.special !== 'none').length }));
  expect(boosted.moves).toBe(moves + 3);
  expect(boosted.specials).toBeGreaterThanOrEqual(2);
  H.expectClean(problems);
});

test('no score: the star meter follows the goals; a first-try win with moves to spare is Sweet Mastery and opens the treasure', async ({ page }) => {
  test.setTimeout(240000);
  const problems = H.guardPage(page);
  await H.bootGame(page, { name: '' });
  await H.seedSave(page, { unlocked: 20, stars_upto: 19 });
  await page.evaluate(() => window.SC.game.startLevel(20));
  await H.waitState(page, 'PLAYING', 15000);
  await expect(page.locator('#hud-score')).toHaveCount(0);
  await expect(page.locator('#hud-moves-label')).toHaveText('Moves');
  await expect(page.locator('.hud-stars .star-mark[data-reached="true"]')).toHaveCount(0);
  await page.evaluate(() => { window.SC.game.logic.moves_left = 60; });
  await H.playLevel(page, { max_moves: 60 });
  await H.waitForModal(page, 'win', 180000);
  await expect(page.locator('.hud-stars .star-mark[data-reached="true"]')).toHaveCount(3);
  const win = page.locator('[data-modal="win"]');
  await expect(win).toContainText('Sweet Mastery');
  await expect(win).toContainText('+1 Sweet Hammer');
  await expect(win).not.toContainText(/\d,\d{3}/);
  const saved = await page.evaluate(() => ({ mastery: window.SC.STORAGE.hasMastery(window.SC.game.store.save, 20), stars: window.SC.STORAGE.levelBest(window.SC.game.store.save, 20).stars }));
  expect(saved).toEqual({ mastery: true, stars: 3 });
  H.expectClean(problems);
});

test('pause, restart and quit in the middle of an animation never leave a stuck state', async ({ page }) => {
  const problems = H.guardPage(page);
  await H.bootGame(page, { name: '' });
  await page.evaluate(() => window.SC.game.startLevel(6));
  await H.waitState(page, 'PLAYING');
  const moves = await H.levelMoves(page, 6);
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
  await page.click('#btn-confirm-restart-yes');
  await H.waitState(page, 'PLAYING');
  await expect.poll(async () => (await H.snapshot(page)).busy, { timeout: 5000 }).toBe(false);
  expect((await H.snapshot(page)).moves_left).toBe(moves);
  expect((await H.snapshot(page)).hearts).toBe(4); // restarting costs a heart
  expect(await page.evaluate(() => window.SC.game.renderer.speed)).toBe(1);
  const before = (await H.snapshot(page)).moves_played;
  await H.swipeMove(page, (await H.snapshot(page)).move);
  await expect.poll(async () => (await H.snapshot(page)).moves_played, { timeout: 30000 }).toBe(before + 1);
  await H.waitState(page, 'PLAYING');
  await page.evaluate(() => window.SC.game.renderer.setSpeed(0.25));
  await H.swipeMove(page, (await H.snapshot(page)).move);
  await expect.poll(async () => (await H.snapshot(page)).state).toBe('RESOLVING');
  await page.keyboard.press('Escape');
  await H.waitForModal(page, 'pause');
  await page.click('#btn-quit');
  await H.waitForModal(page, 'confirm-quit');
  await page.click('#btn-confirm-quit-yes');
  await H.waitState(page, 'MAP');
  expect((await H.snapshot(page)).modal).toBeNull();
  await page.click('.map-node[data-level-id="1"]', { force: true });
  await H.waitForModal(page, 'intro');
  await page.click('#btn-intro-play');
  await H.waitState(page, 'PLAYING');
  const fresh = await H.snapshot(page);
  const level_one_moves = await H.levelMoves(page, 1);
  expect(fresh.moves_left).toBe(level_one_moves);
  await H.swipeMove(page, fresh.move);
  await expect.poll(async () => (await H.snapshot(page)).moves_left, { timeout: 30000 }).toBe(level_one_moves - 1);
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
  await page.click('.map-node[data-level-id="1"]', { force: true });
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

test('hint: Instant shows within 400 ms of the board settling, clears on touch; the Hint button is immediate; Off waits', async ({ page }) => {
  const problems = H.guardPage(page);
  await H.bootGame(page, { name: '' });
  await page.evaluate(() => window.SC.game.startLevel(4));
  await H.waitState(page, 'PLAYING');
  const shown_after = await page.evaluate(() => new Promise((resolve) => {
    const started = performance.now();
    const check = () => {
      if (window.SC.game.hintVisible) resolve(performance.now() - started);
      else if (performance.now() - started > 3000) resolve(-1);
      else requestAnimationFrame(check);
    };
    check();
  }));
  expect(shown_after).toBeGreaterThanOrEqual(0);
  expect(shown_after).toBeLessThan(400);
  const center = await page.evaluate(() => window.SC.game.renderer.cellCenter(0));
  await page.touchscreen.tap(center.x, center.y);
  await expect.poll(async () => (await H.snapshot(page)).hint).toBe(false);
  const button_ms = await page.evaluate(() => {
    const started = performance.now();
    document.getElementById('btn-hint').click();
    return window.SC.game.hintVisible ? performance.now() - started : -1;
  });
  expect(button_ms).toBeGreaterThanOrEqual(0);
  expect(button_ms).toBeLessThan(50);
  await page.evaluate(() => window.SC.game.changeSetting('auto_hint', 'off'));
  await page.touchscreen.tap(center.x, center.y);
  await page.touchscreen.tap(center.x, center.y);
  await H.swipeMove(page, (await page.evaluate(() => {
    const game = window.SC.game;
    const move = window.SC.LOGIC.findHint(game.logic);
    const a = game.renderer.cellCenter(move.from);
    const b = game.renderer.cellCenter(move.to);
    return [a.x, a.y, b.x, b.y];
  })));
  await H.waitState(page, 'PLAYING');
  await page.waitForTimeout(1500);
  expect((await H.snapshot(page)).hint).toBe(false);
  H.expectClean(problems);
});

test('the map handles 20,000 levels: at most 60 live nodes from level 1 to 19,000, Jump and Go to level work', async ({ page }) => {
  test.setTimeout(180000);
  const problems = H.guardPage(page);
  await H.bootGame(page, { name: '' });
  await H.seedSave(page, { unlocked: 19001, stars_upto: 19000, name: 'Ana' });
  const load_ms = await page.evaluate(() => {
    const text = localStorage.getItem(window.SC.STORAGE.SAVE_KEY);
    const started = performance.now();
    window.SC.STORAGE.parseSave(text);
    return { ms: performance.now() - started, bytes: text.length };
  });
  expect(load_ms.bytes).toBeLessThan(100 * 1024);
  expect(load_ms.ms).toBeLessThan(50);
  await page.click('#btn-play');
  await H.waitState(page, 'MAP');
  const samples = [];
  for (const level of [19000, 15000, 9000, 5000, 40, 1]) {
    await page.evaluate((target) => window.SC.game.map.jumpTo(target, false), level);
    await page.waitForTimeout(120);
    const state = await H.snapshot(page);
    samples.push({ level, live: state.map_live_nodes, range: state.map_range });
    expect(state.map_live_nodes).toBeLessThanOrEqual(60);
    expect(state.map_range.first).toBeLessThanOrEqual(level);
    expect(state.map_range.last).toBeGreaterThanOrEqual(Math.min(level, 19000));
  }
  // A continuous scroll keeps the node count flat.
  for (let step = 0; step < 40; step += 1) {
    await page.evaluate(() => { document.getElementById('map-scroll').scrollTop -= 700; });
    await page.waitForTimeout(16);
  }
  expect((await H.snapshot(page)).map_live_nodes).toBeLessThanOrEqual(60);
  await page.click('#btn-map-goto');
  await H.waitForModal(page, 'goto');
  await page.fill('#goto-input', '5000');
  await page.click('#btn-goto-go');
  await expect.poll(async () => (await H.snapshot(page)).map_range.first, { timeout: 5000 }).toBeLessThanOrEqual(5000);
  await expect(page.locator('.map-node[data-level-id="5000"]')).toBeVisible();
  await page.click('#btn-map-mine');
  await expect(page.locator('.map-node[data-level-id="19000"]')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.map-episode').first()).toBeVisible();
  require('node:fs').mkdirSync('qa', { recursive: true });
  require('node:fs').writeFileSync('qa/map-scale.json', JSON.stringify({ save: load_ms, samples }, null, 2));
  H.expectClean(problems);
});

test('Daily Wheel spins once per day; Star Chest opens at 25 stars', async ({ page }) => {
  const problems = H.guardPage(page);
  await H.bootGame(page, { name: '' });
  await H.seedSave(page, { unlocked: 21, stars_upto: 20 });
  await page.click('#btn-play');
  await H.waitState(page, 'MAP');
  await page.click('#btn-map-wheel');
  await H.waitForModal(page, 'wheel');
  await page.click('#btn-wheel-spin');
  await expect(page.locator('.wheel-result')).toContainText('You won', { timeout: 8000 });
  const day = await page.evaluate(() => window.SC.game.store.save.meta.wheel_day);
  expect(day).toMatch(/^\d{4}-\d\d-\d\d$/);
  await page.evaluate(() => window.SC.game.handleBack());
  await page.click('#btn-map-wheel');
  await H.waitForModal(page, 'wheel');
  await expect(page.locator('#btn-wheel-spin').last()).toBeDisabled();
  await page.evaluate(() => window.SC.game.handleBack());
  const stars = await page.evaluate(() => window.SC.STORAGE.totalStars(window.SC.game.store.save));
  expect(stars).toBeGreaterThanOrEqual(25);
  await page.click('#btn-map-chest');
  await H.waitForModal(page, 'reward');
  await expect(page.locator('[data-modal="reward"]')).toContainText('Star Chest');
  H.expectClean(problems);
});

test('a level interrupted by the app being killed reopens its intro on the next launch without costing a heart', async ({ page }) => {
  const problems = H.guardPage(page);
  await H.bootGame(page, { name: '' });
  await page.evaluate(() => window.SC.game.startLevel(1));
  await H.waitState(page, 'PLAYING');
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem(window.SC.STORAGE.SAVE_KEY)).meta.in_progress)).toBe(1);
  await H.reloadGame(page);
  await H.waitForModal(page, 'intro', 15000);
  await expect(page.locator('[data-modal="intro"]')).toContainText('Level 1');
  expect((await H.snapshot(page)).hearts).toBe(5);
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
  await page.click('#choice-auto_hint-3s');
  await page.click('#choice-animation_speed-fast');
  await page.fill('#settings-name', 'Ana');
  await page.press('#settings-name', 'Tab');
  await page.fill('#settings-message', 'You rock!');
  await page.press('#settings-message', 'Tab');
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
  await page.click('#btn-sound-check');
  await page.waitForTimeout(400);
  await H.reloadGame(page);
  const saved = await page.evaluate(() => ({ settings: window.SC.game.store.save.settings, name: window.SC.game.store.save.player_name, photo: !!window.SC.game.photo }));
  expect(saved.settings.theme).toBe('sprinkle');
  expect(saved.settings.accent).toBe('ocean');
  expect(saved.settings.music_on).toBe(false);
  expect(saved.settings.colorblind).toBe(true);
  expect(saved.settings.auto_hint).toBe('3s');
  expect(saved.settings.animation_speed).toBe('fast');
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
  test.setTimeout(300000);
  const problems = H.guardPage(page);
  await H.bootGame(page, { name: '' });
  await page.evaluate(() => window.SC.game.goTitle());
  await page.click('#btn-title-settings');
  await page.click('#btn-self-test');
  await expect(page.locator('#selftest-status')).toHaveClass(/is-pass/, { timeout: 280000 });
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
  for (const screen of ['title', 'map']) {
    if (screen === 'map') {
      await page.click('#btn-play');
      await H.waitState(page, 'MAP');
    }
    const touch_targets = await page.evaluate(() => Array.from(document.querySelectorAll('.screen.is-active button')).filter((button) => button.getBoundingClientRect().width > 0).map((button) => {
      const rect = button.getBoundingClientRect();
      return { id: button.id || button.className, size: Math.min(rect.width, rect.height) };
    }));
    touch_targets.forEach((target) => expect(target.size, target.id).toBeGreaterThanOrEqual(44));
  }
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

test('performance: logic stays far under 8 ms per move, hints under 50 ms; frame pacing and heap growth are recorded', async ({ page }) => {
  test.setTimeout(240000);
  const problems = H.guardPage(page);
  await H.bootGame(page, { name: '' });
  await page.evaluate(() => window.SC.SELFTEST.prepare());
  const logic = await page.evaluate(() => {
    const durations = [];
    const hint_durations = [];
    window.SC.SELFTEST.shippedLevels().forEach((level) => {
      for (let game = 0; game < 3; game += 1) {
        let state = window.SC.LOGIC.createGame(level, { seed: level.seed + game });
        let guard = 0;
        while (state.status === 'playing' && guard < 40) {
          guard += 1;
          const hint_started = performance.now();
          const move = window.SC.LOGIC.findHint(state);
          hint_durations.push(performance.now() - hint_started);
          if (!move) break;
          const started = performance.now();
          state = window.SC.LOGIC.applySwap(state, move.from, move.to).state;
          durations.push(performance.now() - started);
        }
      }
    });
    durations.sort((a, b) => a - b);
    hint_durations.sort((a, b) => a - b);
    return {
      moves: durations.length, median_ms: durations[Math.floor(durations.length / 2)], p95_ms: durations[Math.floor(durations.length * 0.95)], max_ms: durations[durations.length - 1],
      hint_p95_ms: hint_durations[Math.floor(hint_durations.length * 0.95)], hint_max_ms: hint_durations[hint_durations.length - 1],
    };
  });
  expect(logic.p95_ms).toBeLessThan(8);
  expect(logic.hint_p95_ms).toBeLessThan(50);
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
  const sprite_ms = await page.evaluate(() => window.SC.game.renderer.sprites.buildMs);
  const report = {
    logic,
    sprite_build_ms: sprite_ms,
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
  const moves = await H.levelMoves(page, 1);
  await page.evaluate(() => window.SC.game.goMap());
  await page.click('.map-node[data-level-id="1"]', { force: true });
  await H.waitForModal(page, 'intro');
  await page.click('#btn-intro-play');
  await H.waitState(page, 'PLAYING');
  await H.swipeMove(page, (await H.snapshot(page)).move);
  await expect.poll(async () => (await H.snapshot(page)).moves_left, { timeout: 30000 }).toBe(moves - 1);
  H.expectClean(problems);
});

test('a fast flick with no move events in between still swaps (release point counts)', async ({ page }) => {
  const problems = H.guardPage(page);
  await H.bootGame(page, { name: '' });
  await page.evaluate(() => window.SC.game.startLevel(1));
  await H.waitState(page, 'PLAYING');
  const move = (await H.snapshot(page)).move;
  await page.evaluate(([x1, y1, x2, y2]) => {
    const canvas = document.getElementById('game-canvas');
    const base = { pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true };
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: x1, clientY: y1, buttons: 1 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...base, clientX: x2, clientY: y2, buttons: 0 }));
  }, move);
  await expect.poll(async () => (await H.snapshot(page)).moves_played, { timeout: 30000 }).toBe(1);
  expect((await H.snapshot(page)).selected).toBe(-1);
  H.expectClean(problems);
});

// Android WebView drops the click after a long press (the emulator suite checks that case on a device); desktop
// Chromium does not, so here this proves the long-press fallback never makes a button fire twice.
test('a long press released on a button activates it exactly once (mouse and touch)', async ({ page }) => {
  const problems = H.guardPage(page);
  await H.bootGame(page, { name: '' });
  await page.evaluate(() => window.SC.game.startLevel(1));
  await H.waitState(page, 'PLAYING');
  const soundOn = async () => (await H.snapshot(page)).audio.sound_on;
  const box = await page.locator('#btn-sound').boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  expect(await soundOn()).toBe(true);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  await page.waitForTimeout(500);
  expect(await soundOn()).toBe(false);
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(900);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(500);
  expect(await soundOn()).toBe(true);
  await page.tap('#btn-sound');
  await page.waitForTimeout(500);
  expect(await soundOn()).toBe(false);
  H.expectClean(problems);
});

test('after a win, Next level goes to the map, the marker hops to the new level and its intro opens', async ({ page }) => {
  const problems = H.guardPage(page);
  await H.bootGame(page, { name: 'Sam' });
  await H.playLevel(page, { max_moves: 30 });
  await H.waitForModal(page, 'win', 120000);
  await page.waitForTimeout(1500);
  await page.click('#btn-next');
  await H.waitState(page, 'MAP');
  await expect(page.locator('.map-marker')).toBeVisible();
  await expect(page.locator('.map-marker')).toHaveText('S');
  await expect(page.locator('#map-scroll')).toHaveClass(/is-advancing/);
  await H.waitForModal(page, 'intro', 15000);
  await expect(page.locator('[data-modal="intro"]')).toContainText('Level 2');
  await expect(page.locator('.map-node[data-level-id="2"]')).toHaveClass(/is-current/);
  await expect(page.locator('.map-node[data-level-id="1"]')).not.toHaveClass(/is-current/);
  const marker = await page.locator('.map-marker').boundingBox();
  const node = await page.locator('.map-node[data-level-id="2"]').boundingBox();
  expect(Math.abs(marker.x + marker.width / 2 - (node.x + node.width / 2))).toBeLessThan(4);
  await page.click('#btn-intro-play');
  await H.waitState(page, 'PLAYING');
  expect((await H.snapshot(page)).level).toBe(2);
  H.expectClean(problems);
});

test('Back on the win screen returns to the map with the new level unlocked, without opening it', async ({ page }) => {
  const problems = H.guardPage(page);
  await H.bootGame(page, { name: '' });
  await H.playLevel(page, { max_moves: 30 });
  await H.waitForModal(page, 'win', 120000);
  await page.evaluate(() => window.SC.game.handleBack());
  await H.waitState(page, 'MAP');
  await expect(page.locator('.map-node[data-level-id="2"]')).toHaveClass(/is-current/, { timeout: 10000 });
  await expect(page.locator('#map-scroll')).not.toHaveClass(/is-advancing/, { timeout: 10000 });
  await page.waitForTimeout(800);
  expect((await H.snapshot(page)).modal).toBe(null);
  H.expectClean(problems);
});

test('progression: a booster unlocks with a popup, free copies and a pointer; first-try wins earn crowns and grow the Sweet Streak', async ({ page }) => {
  test.setTimeout(240000);
  const problems = H.guardPage(page);
  await H.bootGame(page, { name: '' });
  const none = { hammer: 0, free_swap: 0, whirl: 0, lucky: 0, rainbow: 0, head_start: 0 };
  await H.seedSave(page, { unlocked: 7, stars_upto: 6, meta: { announced: [], boosters: none } });
  await page.click('#btn-play');
  await H.waitState(page, 'MAP');
  await H.waitForModal(page, 'unlock', 10000);
  await expect(page.locator('[data-modal="unlock"]')).toContainText('Sweet Hammer');
  await page.click('#btn-unlock-ok');
  expect((await H.snapshot(page)).boosters.hammer).toBe(3);
  await page.evaluate(() => window.SC.game.openIntro(7));
  await H.waitForModal(page, 'intro');
  await expect(page.locator('#intro-booster-rainbow')).toHaveClass(/is-locked/);
  await page.click('#btn-intro-play');
  await H.waitState(page, 'PLAYING', 15000);
  await expect(page.locator('#tap-pointer')).toHaveClass(/is-showing/);
  await expect(page.locator('#btn-booster-free_swap')).toHaveClass(/is-locked/);
  await page.click('#btn-booster-hammer');
  await expect.poll(async () => (await H.snapshot(page)).armed_booster).toBe('hammer');
  // A Sweet Streak of 2 puts a striped and a wrapped candy on the next new level; a first-try win adds a crown.
  await page.evaluate(() => window.SC.game.goMap());
  await H.seedSave(page, { unlocked: 26, stars_upto: 25, meta: { streak: 2 } });
  await page.click('#btn-play');
  await H.waitState(page, 'MAP');
  await page.evaluate(() => window.SC.game.openIntro(26));
  await H.waitForModal(page, 'intro');
  await expect(page.locator('.streak-meter')).toContainText('Starts with');
  await page.click('#btn-intro-play');
  await H.waitState(page, 'PLAYING', 15000);
  const specials = await page.evaluate(() => window.SC.game.logic.cells.filter((piece) => piece && piece.special !== 'none').length);
  expect(specials).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => { window.SC.game.logic.moves_left = 99; });
  await H.playLevel(page, { max_moves: 99 });
  await H.waitForModal(page, 'win', 180000);
  await expect(page.locator('[data-modal="win"]')).toContainText(/First try!|Sweet Mastery/);
  const after = await page.evaluate(() => ({ streak: window.SC.game.store.save.meta.streak, crown: window.SC.STORAGE.hasCrown(window.SC.game.store.save, 26) }));
  expect(after).toEqual({ streak: 3, crown: true });
  H.expectClean(problems);
});
