// Visual QA screenshots: every screen at six phone/tablet sizes in all three candy themes (title; map at levels 1, 40,
// 5,000 and 19,000 from a seeded 19,000-level save; intro; gameplay idle and mid-cascade; specials; every blocker and
// board feature; win; lose; settings; hearts-empty; Daily Wheel), plus landscape and desktop, plus a zoomed art sheet
// per theme. Output: qa/screenshots/<size>/<theme>/<screen>.png (uploaded by CI).
const { test, expect } = require('@playwright/test');
const H = require('./helpers');

const SIZES = [
  { name: '360x640', width: 360, height: 640 },
  { name: '390x844', width: 390, height: 844 },
  { name: '412x915', width: 412, height: 915 },
  { name: '430x932', width: 430, height: 932 },
  { name: '673x841-foldable', width: 673, height: 841 },
  { name: '768x1024-tablet', width: 768, height: 1024 },
];
const THEMES = ['gummy', 'hard', 'sprinkle'];
// Real shipped levels that show each board piece: cages, portals, cocoa, fuse, belt, thick frosting, hazelnuts, jelly.
const FEATURE_LEVELS = [[19, 'cage'], [21, 'portals'], [22, 'cocoa'], [24, 'fuse'], [31, 'belt'], [36, 'frosting-3plus'], [41, 'hazelnut'], [14, 'jelly-frosting'], [17, 'timed']];

test.describe.configure({ mode: 'parallel' });

async function prepare(page, theme) {
  await H.bootGame(page, { name: 'Sam' });
  await H.seedSave(page, { unlocked: 19001, stars_upto: 19000, name: 'Sam', settings: { theme } });
}

async function settle(page, milliseconds) {
  await page.waitForTimeout(milliseconds || 700);
}

async function playLevelScreen(page, level_id) {
  await page.evaluate((id) => window.SC.game.startLevel(id), level_id);
  await H.waitState(page, 'PLAYING');
  await page.evaluate(() => {
    window.SC.game.ui.tutorial(null);
    window.SC.game.renderer.setHint(null);
  });
}

for (const size of SIZES) {
  for (const theme of THEMES) {
    test(`screens ${size.name} ${theme}`, async ({ browser }) => {
      test.setTimeout(240000);
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      const problems = H.guardPage(page);
      const shot = (screen_name) => page.screenshot({ path: `qa/screenshots/${size.name}/${theme}/${screen_name}.png` });
      await prepare(page, theme);
      await settle(page);
      await shot('01-title');
      await page.click('#btn-play');
      await H.waitState(page, 'MAP');
      for (const level of [1, 40, 5000, 19000]) {
        await page.evaluate((target) => window.SC.game.map.jumpTo(target, false), level);
        await settle(page, 500);
        await shot(`02-map-level-${level}`);
        expect((await H.snapshot(page)).map_live_nodes).toBeLessThanOrEqual(60);
      }
      await page.evaluate(() => window.SC.game.openIntro(36));
      await H.waitForModal(page, 'intro');
      await settle(page, 600);
      await shot('03-intro');
      await page.evaluate(() => window.SC.game.ui.closeAllModals());
      await playLevelScreen(page, 7);
      await settle(page, 900);
      await shot('04-gameplay-idle');
      await page.evaluate(() => window.SC.game.renderer.setSpeed(0.5));
      await H.swipeMove(page, (await H.snapshot(page)).move);
      await page.waitForTimeout(260);
      await shot('05-mid-cascade');
      await H.waitState(page, 'PLAYING', 60000);
      // Every special candy on one board.
      await page.evaluate(() => {
        const game = window.SC.game;
        const logic = game.logic;
        const specials = ['stripe_row', 'stripe_col', 'wrapped', 'bomb', 'stripe_row', 'wrapped', 'stripe_col', 'wrapped'];
        let placed = 0;
        for (let index = 3; index < logic.cells.length && placed < specials.length; index += 6) {
          const piece = logic.cells[index];
          if (piece && piece.kind === 'candy') {
            piece.special = specials[placed];
            if (piece.special === 'bomb') piece.color = -1;
            placed += 1;
          }
        }
        game.renderer.syncToState(logic);
        game.renderer.setHint(null);
      });
      await settle(page, 900);
      await shot('06-specials');
      for (const [level_id, label] of FEATURE_LEVELS) {
        await playLevelScreen(page, level_id);
        await settle(page, 900);
        await shot(`07-board-${String(level_id).padStart(2, '0')}-${label}`);
      }
      await page.evaluate(() => window.SC.game.openPause());
      await H.waitForModal(page, 'pause');
      await settle(page, 500);
      await shot('08-pause');
      await page.evaluate(() => {
        const game = window.SC.game;
        game.ui.closeAllModals();
        game.ui.showWin({ score: 34560, stars: 3, is_new_best: true, player_name: 'Sam', win_message: 'You are amazing!', has_next: true, rewards: { gold: 25, streak_reward: 'lucky', chest_ready: true }, streak: 3 }, { next() {}, replay() {}, map() {} });
      });
      await page.waitForTimeout(2200);
      await shot('09-win');
      await page.evaluate(() => {
        const game = window.SC.game;
        game.ui.closeAllModals();
        const progress = window.SC.LOGIC.goalProgress(game.logic);
        game.ui.showLose({ progress, goals: game.level.goals, player_name: 'Sam', reason: game.logic.timed ? 'time' : 'moves', can_continue: true, price: 60, gold: 140, timed: game.logic.timed }, { retry() {}, map() {}, plusFive() {} });
      });
      await settle(page, 700);
      await shot('10-lose');
      await page.evaluate(() => {
        window.SC.game.ui.closeAllModals();
        window.SC.game.goTitle();
        window.SC.game.openSettings();
      });
      await settle(page, 700);
      await shot('11-settings');
      await page.evaluate(() => {
        const modal = document.querySelector('[data-modal="settings"]');
        modal.scrollTop = modal.scrollHeight / 2;
      });
      await settle(page, 300);
      await shot('12-settings-middle');
      await page.evaluate(() => {
        const modal = document.querySelector('[data-modal="settings"]');
        modal.scrollTop = modal.scrollHeight;
      });
      await settle(page, 300);
      await shot('13-settings-bottom');
      await page.evaluate(() => {
        window.SC.game.ui.closeAllModals();
        window.SC.game.ui.showHelp();
      });
      await settle(page, 700);
      await shot('14-how-to-play');
      await page.evaluate(() => {
        window.SC.game.ui.closeAllModals();
        window.SC.game.ui.showHeartsEmpty({ nextHeartMs: () => 17 * 60 * 1000 + 42000 }, { unlimited() {} });
      });
      await settle(page, 700);
      await shot('15-hearts-empty');
      await page.evaluate(() => {
        window.SC.game.ui.closeAllModals();
        window.SC.game.ui.showWheel({ can_spin: true }, { spin: () => null, done() {} });
      });
      await settle(page, 700);
      await shot('16-daily-wheel');
      // Layout sanity: nothing important is clipped off-screen.
      const overflow = await page.evaluate(() => {
        const found = [];
        document.querySelectorAll('.screen.is-active button, .modal').forEach((element) => {
          const rect = element.getBoundingClientRect();
          if (rect.width && (rect.left < -1 || rect.right > window.innerWidth + 1)) found.push(element.id || element.className);
        });
        return found;
      });
      expect(overflow).toEqual([]);
      H.expectClean(problems);
      await context.close();
    });
  }
}

test('landscape phone and desktop layouts (HUD beside the board)', async ({ browser }) => {
  for (const view of [{ name: '844x390-landscape', width: 844, height: 390, mobile: true }, { name: '1280x800-desktop', width: 1280, height: 800, mobile: false }]) {
    const context = await browser.newContext({ viewport: { width: view.width, height: view.height }, deviceScaleFactor: view.mobile ? 2 : 1, isMobile: view.mobile, hasTouch: view.mobile });
    const page = await context.newPage();
    const problems = H.guardPage(page);
    await prepare(page, 'gummy');
    await settle(page);
    await page.screenshot({ path: `qa/screenshots/${view.name}/01-title.png` });
    await page.evaluate(() => window.SC.game.goMap());
    await settle(page);
    await page.screenshot({ path: `qa/screenshots/${view.name}/02-map.png` });
    await playLevelScreen(page, 7);
    await settle(page, 900);
    await page.screenshot({ path: `qa/screenshots/${view.name}/04-gameplay-idle.png` });
    const board = await page.evaluate(() => window.SC.game.renderer.boardRect());
    const hud = await page.evaluate(() => document.getElementById('hud').getBoundingClientRect().toJSON());
    expect(board.left + board.width).toBeLessThanOrEqual(view.width);
    expect(board.top + board.height).toBeLessThanOrEqual(view.height);
    expect(board.cell).toBeGreaterThanOrEqual(view.mobile ? 30 : 48);
    if (view.width > view.height) expect(hud.right).toBeLessThanOrEqual(board.left + 2);
    H.expectClean(problems);
    await context.close();
  }
});

test('art quality sheet: every candy, special, blocker and Pip in all three themes, zoomed and at real size', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 1360 });
  await H.bootGame(page, { name: '' });
  for (const theme of THEMES) {
    for (const colorblind of [false, true]) {
      const build_ms = await page.evaluate(({ theme_id, colorblind_on }) => {
        const existing = document.getElementById('art-sheet');
        if (existing) existing.remove();
        const canvas = document.createElement('canvas');
        canvas.id = 'art-sheet';
        canvas.width = 960;
        canvas.height = 1360;
        canvas.style.cssText = 'position:fixed;left:0;top:0;z-index:99;background:linear-gradient(135deg,#ff9ad5,#ffd36e 50%,#8ee3ff)';
        document.body.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        const cache = window.SC.SPRITES.createSpriteCache();
        cache.configure(128, theme_id, colorblind_on, 2);
        const started = performance.now();
        const specials = ['none', 'stripe_row', 'stripe_col', 'wrapped'];
        specials.forEach((special, row) => {
          for (let color = 0; color < 6; color += 1) {
            ctx.fillStyle = 'rgba(70,32,110,0.55)';
            ctx.fillRect(10 + color * 158, 10 + row * 158, 150, 150);
            ctx.drawImage(cache.get('candy', color, special, 0), 10 + color * 158, 10 + row * 158, 150, 150);
          }
        });
        const blockers = [['candy', 0, 'bomb', 0], ['frosting', -1, 'none', 1], ['frosting', -1, 'none', 3], ['frosting', -1, 'none', 5], ['cocoa', -1, 'none', 0], ['cherry', -1, 'none', 0],
          ['hazelnut', -1, 'none', 0], ['cage', -1, 'none', 0], ['jelly', -1, 'none', 1], ['jelly', -1, 'none', 2]];
        blockers.forEach((args, index) => {
          const x = 10 + (index % 6) * 158;
          const y = 650 + Math.floor(index / 6) * 158;
          ctx.fillStyle = 'rgba(70,32,110,0.55)';
          ctx.fillRect(x, y, 150, 150);
          if (args[0] === 'cage') ctx.drawImage(cache.get('candy', 4, 'none', 0), x, y, 150, 150);
          ctx.drawImage(cache.get(...args), x, y, 150, 150);
        });
        const elapsed = performance.now() - started;
        window.SC.PIP.EXPRESSIONS.forEach((expression, index) => window.SC.PIP.drawPip(ctx, 60 + index * 112, 1050, 90, expression, 400, { angle: 0.5 }));
        const small = window.SC.SPRITES.createSpriteCache();
        small.configure(36, theme_id, colorblind_on, 2);
        ctx.fillStyle = 'rgba(70,32,110,0.55)';
        ctx.fillRect(10, 1150, 6 * 44, 44);
        for (let color = 0; color < 6; color += 1) ctx.drawImage(small.get('candy', color, 'none', 0), 14 + color * 44, 1154, 36, 36);
        ctx.font = '900 22px system-ui';
        ctx.fillStyle = '#3b1a4a';
        ctx.fillText(`${theme_id}${colorblind_on ? ' + color-blind assist' : ''} · the small row is the real 36 px cell size`, 10, 1230);
        return elapsed;
      }, { theme_id: theme, colorblind_on: colorblind });
      await page.screenshot({ path: `qa/screenshots/art/${theme}${colorblind ? '-colorblind' : ''}.png` });
      require('node:fs').appendFileSync('qa/sprite-build-ms.txt', `${theme}${colorblind ? ' colorblind' : ''}: ${build_ms.toFixed(0)} ms for 34 sprites at 256 px\n`);
    }
  }
});
