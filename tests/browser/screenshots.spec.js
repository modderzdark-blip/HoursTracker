// Visual QA screenshots: every screen at six phone/tablet sizes in all three candy themes, plus landscape and desktop,
// plus a zoomed sprite sheet per theme. Output: qa/screenshots/<size>/<theme>/<screen>.png (uploaded by CI).
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

test.describe.configure({ mode: 'parallel' });

async function prepare(page, theme) {
  await H.bootGame(page, { name: 'Florin' });
  await page.evaluate((theme_id) => {
    const game = window.SC.game;
    game.changeSetting('theme', theme_id);
    game.store.save.unlocked = 10;
    [[1, 3, 34000], [2, 2, 32000], [3, 3, 36000], [4, 1, 25000], [5, 2, 21000], [6, 3, 33000], [7, 1, 9000], [8, 2, 14000], [9, 1, 15000]].forEach(([level_id, stars, score]) => {
      game.store.save.levels[level_id] = { best_score: score, best_stars: stars, attempts: 2, wins: 1 };
    });
    game.store.save.unlocked = 10;
  }, theme);
}

async function settle(page, milliseconds) {
  await page.waitForTimeout(milliseconds || 700);
}

for (const size of SIZES) {
  for (const theme of THEMES) {
    test(`screens ${size.name} ${theme}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      const problems = H.guardPage(page);
      const shot = (screen_name) => page.screenshot({ path: `qa/screenshots/${size.name}/${theme}/${screen_name}.png` });
      await prepare(page, theme);
      await page.evaluate(() => window.SC.game.goTitle());
      await settle(page);
      await shot('01-title');
      await page.evaluate(() => window.SC.game.goMap());
      await settle(page);
      await shot('02-map');
      await page.click('.map-node[data-level-id="7"]', { force: true });
      await H.waitForModal(page, 'intro');
      await settle(page, 600);
      await shot('03-intro');
      await page.click('#btn-intro-play');
      await H.waitState(page, 'PLAYING');
      await settle(page, 900);
      await shot('04-gameplay-idle');
      await H.swipeMove(page, (await H.snapshot(page)).move);
      await page.waitForTimeout(300);
      await shot('05-mid-cascade');
      await H.waitState(page, 'PLAYING', 60000);
      // Special candies, cherries and exits on Level 9.
      await page.evaluate(() => {
        const game = window.SC.game;
        game.startLevel(9);
        const logic = game.logic;
        const specials = ['stripe_row', 'stripe_col', 'wrapped', 'bomb', 'stripe_row', 'wrapped'];
        let placed = 0;
        for (let index = 0; index < logic.cells.length && placed < specials.length; index += 7) {
          const piece = logic.cells[index];
          if (piece && piece.kind === 'candy') {
            piece.special = specials[placed];
            if (piece.special === 'bomb') piece.color = -1;
            placed += 1;
          }
        }
        game.renderer.syncToState(logic);
        game.ui.tutorial(null);
      });
      await settle(page, 900);
      await shot('06-specials-cherries');
      await page.evaluate(() => window.SC.game.startLevel(1));
      await settle(page, 600);
      await page.evaluate(() => window.SC.game.openPause());
      await H.waitForModal(page, 'pause');
      await settle(page, 600);
      await shot('07-pause');
      await page.evaluate(() => {
        const game = window.SC.game;
        game.ui.closeAllModals();
        game.ui.showWin({ score: 34560, stars: 3, is_new_best: true, player_name: 'Florin', win_message: 'You are amazing!', has_next: true }, { next() {}, replay() {}, map() {} });
      });
      await page.waitForTimeout(2200);
      await shot('08-win');
      await page.evaluate(() => {
        const game = window.SC.game;
        game.ui.closeAllModals();
        game.startLevel(9);
        const progress = window.SC.LOGIC.goalProgress(game.logic);
        game.ui.showLose({ progress, goals: game.level.goals, player_name: 'Florin' }, { retry() {}, map() {} });
      });
      await settle(page, 700);
      await shot('09-lose');
      await page.evaluate(() => {
        window.SC.game.ui.closeAllModals();
        window.SC.game.goTitle();
        window.SC.game.openSettings();
      });
      await settle(page, 700);
      await shot('10-settings');
      await page.evaluate(() => {
        const modal = document.querySelector('[data-modal="settings"]');
        modal.scrollTop = modal.scrollHeight;
      });
      await settle(page, 300);
      await shot('11-settings-bottom');
      await page.evaluate(() => {
        window.SC.game.ui.closeAllModals();
        window.SC.game.ui.showHelp();
      });
      await settle(page, 700);
      await shot('12-how-to-play');
      // Layout sanity: nothing important is clipped off-screen.
      const overflow = await page.evaluate(() => {
        const problems = [];
        document.querySelectorAll('.screen.is-active button, .modal').forEach((element) => {
          const rect = element.getBoundingClientRect();
          if (rect.width && (rect.left < -1 || rect.right > window.innerWidth + 1)) problems.push(element.id || element.className);
        });
        return problems;
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
    await page.evaluate(() => window.SC.game.goTitle());
    await settle(page);
    await page.screenshot({ path: `qa/screenshots/${view.name}/01-title.png` });
    await page.evaluate(() => window.SC.game.goMap());
    await settle(page);
    await page.screenshot({ path: `qa/screenshots/${view.name}/02-map.png` });
    await page.evaluate(() => {
      window.SC.game.startLevel(7);
      window.SC.game.ui.tutorial(null);
    });
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

test('art quality sheet: every candy, special and blocker in all three themes, zoomed', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 1100 });
  await H.bootGame(page, { name: '' });
  for (const theme of THEMES) {
    for (const colorblind of [false, true]) {
      await page.evaluate(({ theme_id, colorblind_on }) => {
        const existing = document.getElementById('art-sheet');
        if (existing) existing.remove();
        const canvas = document.createElement('canvas');
        canvas.id = 'art-sheet';
        canvas.width = 960;
        canvas.height = 1100;
        canvas.style.cssText = 'position:fixed;left:0;top:0;z-index:99;background:linear-gradient(135deg,#ff9ad5,#ffd36e 50%,#8ee3ff)';
        document.body.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        const cache = window.SC.ART.createSpriteCache();
        cache.configure(128, theme_id, colorblind_on, 2);
        const specials = ['none', 'stripe_row', 'stripe_col', 'wrapped'];
        specials.forEach((special, row) => {
          for (let color = 0; color < 6; color += 1) {
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.fillRect(10 + color * 158, 10 + row * 158, 150, 150);
            ctx.drawImage(cache.get('candy', color, special, 0), 10 + color * 158, 10 + row * 158, 150, 150);
          }
        });
        [['candy', 0, 'bomb', 0], ['frosting', -1, 'none', 2], ['frosting', -1, 'none', 1], ['cherry', -1, 'none', 0], ['jelly', -1, 'none', 1], ['jelly', -1, 'none', 2]].forEach((args, index) => {
          ctx.fillStyle = 'rgba(255,255,255,0.3)';
          ctx.fillRect(10 + index * 158, 650, 150, 150);
          ctx.drawImage(cache.get(...args), 10 + index * 158, 650, 150, 150);
        });
        const small = window.SC.ART.createSpriteCache();
        small.configure(36, theme_id, colorblind_on, 2);
        for (let color = 0; color < 6; color += 1) ctx.drawImage(small.get('candy', color, 'none', 0), 10 + color * 44, 830, 36, 36);
        ctx.font = '900 22px system-ui';
        ctx.fillStyle = '#6a1b5a';
        ctx.fillText(`${theme_id}${colorblind_on ? ' + color-blind assist' : ''} · bottom row at real 36 px cell size`, 10, 900);
      }, { theme_id: theme, colorblind_on: colorblind });
      await page.screenshot({ path: `qa/screenshots/art/${theme}${colorblind ? '-colorblind' : ''}.png` });
    }
  }
});
