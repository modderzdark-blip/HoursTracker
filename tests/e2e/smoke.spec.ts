import { expect, test } from '@playwright/test';
import {
  TouchDriver,
  centerOf,
  collectErrors,
  heapAfterGC,
  hook,
  slope,
  startGame,
  state,
} from './helpers';

const SHOTS = 'test-results/screenshots';

test.describe('Ashbound smoke (Pixel 7 landscape, touch)', () => {
  test('title loads with zero console errors', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./');
    await expect(page.getByTestId('title-screen')).toBeVisible();
    await page.locator('.title-start.is-pulsing').waitFor({ timeout: 90_000 });
    await expect(page.locator('.title-name')).toHaveText('ASHBOUND');
    await page.screenshot({ path: `${SHOTS}/01-title.png` });
    expect(errors).toEqual([]);
  });

  test('battle renders: arena, hero, dummy, HUD; within the draw-call budget', async ({ page }) => {
    const errors = collectErrors(page);
    await startGame(page);
    await page.waitForTimeout(1500);
    const s = await state(page);
    expect(s.stage.phase).toBe('countdown');
    expect(s.player.grounded).toBe(true);
    expect(s.player.hp).toBe(s.player.maxHp);
    expect(s.drawCalls).toBeGreaterThan(5);
    expect(s.drawCalls).toBeLessThan(150);
    await expect(page.getByTestId('touch-layer')).toBeVisible();
    await expect(page.getByTestId('start-now')).toBeVisible();
    const shot = await page.screenshot({ path: `${SHOTS}/02-practice.png` });
    const variance = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = 96;
      c.height = 48;
      const ctx = c.getContext('2d');
      if (ctx === null) return 0;
      ctx.drawImage(img, 0, 0, 96, 48);
      const d = ctx.getImageData(0, 0, 96, 48).data;
      let sum = 0;
      let sq = 0;
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        const l = (d[i] ?? 0) + (d[i + 1] ?? 0) + (d[i + 2] ?? 0);
        sum += l;
        sq += l * l;
      }
      return sq / n - (sum / n) ** 2;
    }, shot.toString('base64'));
    expect(variance).toBeGreaterThan(50);
    expect(errors).toEqual([]);
  });

  test('joystick moves the hero; ATTACK with a second finger runs the combo; nothing sticks', async ({
    page,
    context,
  }) => {
    const errors = collectErrors(page);
    await startGame(page);
    const touch = await TouchDriver.create(context, page);
    const before = await state(page);
    await touch.down(1, 160, 300);
    for (let i = 1; i <= 8; i++) await touch.move(1, 160 + i * 6, 300 - i * 8);
    await page.waitForTimeout(900);
    const moving = await state(page);
    expect(moving.joystickActive).toBe(true);
    expect(moving.player.z).toBeLessThan(before.player.z - 0.3);
    expect(moving.player.x).toBeGreaterThan(before.player.x + 0.1);

    const attack = await centerOf(page.locator('.tc-attack'));
    const states = new Set<string>();
    for (let i = 0; i < 4; i++) {
      await touch.tap(2, attack.x, attack.y, 40);
      for (let k = 0; k < 4; k++) {
        await page.waitForTimeout(60);
        const s = await state(page);
        if (s.player.action !== null) states.add(s.player.action);
      }
    }
    expect((await state(page)).presses['attack']).toBe(4);
    expect([...states].some((a) => a.startsWith('kael_atk'))).toBe(true);
    await touch.upAll();
    const after = await state(page);
    expect(after.joystickActive).toBe(false);
    expect(after.activeTouches).toBe(0);
    expect(after.move).toEqual({ x: 0, y: 0 });
    await expect
      .poll(async () => (await state(page)).player.speed, { timeout: 15_000 })
      .toBeLessThan(0.01);
    expect(errors).toEqual([]);
  });

  test('a skill button starts the skill, shows its cooldown, and releases on slide-off', async ({
    page,
    context,
  }) => {
    await startGame(page);
    const touch = await TouchDriver.create(context, page);
    const skill = await centerOf(page.locator('.tc-skill1'));
    await touch.down(3, skill.x, skill.y);
    expect((await state(page)).activeTouches).toBe(1);
    await expect.poll(async () => (await state(page)).skillReady[0]).toBe(false);
    await touch.move(3, skill.x - 150, skill.y - 120);
    expect((await state(page)).activeTouches).toBe(0);
    await touch.up(3);
    await expect(page.locator('.tc-skill1')).toHaveClass(/is-cooling/);
  });

  test('wave combat with real touch input kills enemies', async ({ page, context }) => {
    test.setTimeout(240_000);
    const errors = collectErrors(page);
    await startGame(page);
    await hook(page, 'setGod', true);
    await page.getByTestId('start-now').tap();
    await expect
      .poll(async () => (await state(page)).stage.enemiesAlive, { timeout: 20_000 })
      .toBeGreaterThan(0);
    const touch = await TouchDriver.create(context, page);
    const attack = await centerOf(page.locator('.tc-attack'));
    const t0 = Date.now();
    // Software WebGL runs game time at ~⅓ speed under load, so allow up to 2 real minutes.
    while (Date.now() - t0 < 120_000) {
      await touch.tap(2, attack.x, attack.y, 40);
      await page.waitForTimeout(140);
      if ((await state(page)).stage.killed >= 1) break;
    }
    const s = await state(page);
    expect(s.stage.killed).toBeGreaterThanOrEqual(1);
    expect(s.ultimate).toBeGreaterThan(0);
    await page.screenshot({ path: `${SHOTS}/03-wave.png` });
    expect(errors).toEqual([]);
  });

  test('boss: intro cinematic → phased fight → victory screen with rewards', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await startGame(page);
    await hook(page, 'setGod', true);
    const gemsBefore = (await state(page)).wallet['gems'] ?? 0;
    await hook(page, 'skipToBoss');
    await expect.poll(async () => (await state(page)).boss.active, { timeout: 30_000 }).toBe(true);
    expect((await state(page)).cinematic).toBe(true);
    await page.screenshot({ path: `${SHOTS}/04-boss-intro.png` });
    await expect
      .poll(async () => (await state(page)).stage.phase, { timeout: 30_000 })
      .toBe('boss');
    await expect(page.getByTestId('boss-bar')).toBeVisible();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/05-boss-fight.png` });
    await hook(page, 'damageBoss', 0.45);
    await expect.poll(async () => (await state(page)).boss.phase, { timeout: 30_000 }).toBe(1);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SHOTS}/06-boss-phase2.png` });
    await hook(page, 'killBoss');
    await expect(page.getByTestId('result-screen')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('result-screen')).toHaveAttribute('data-result', 'victory');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${SHOTS}/07-victory.png` });
    const s = await state(page);
    expect(s.wallet['gems']).toBe(gemsBefore + 5);
    expect(s.wallet['souls']).toBeGreaterThanOrEqual(25);
    await page.getByTestId('result-again').tap();
    await expect(page.getByTestId('result-screen')).toBeHidden();
    expect((await state(page)).stage.phase).toBe('countdown');
    expect(errors).toEqual([]);
  });

  test('defeat → revive costs gems, restores HP and continues; revive limit enforced', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await startGame(page);
    const gems = (await state(page)).wallet['gems'] ?? 0;
    await hook(page, 'damagePlayer', 1);
    await expect(page.getByTestId('result-screen')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('result-screen')).toHaveAttribute('data-result', 'defeat');
    await page.screenshot({ path: `${SHOTS}/08-defeat.png` });
    await page.getByTestId('result-revive').tap();
    await expect(page.getByTestId('result-screen')).toBeHidden();
    let s = await state(page);
    expect(s.wallet['gems']).toBe(gems - 10);
    expect(s.player.hp).toBeGreaterThan(0);
    await page.waitForTimeout(3000);
    await hook(page, 'damagePlayer', 1);
    await expect(page.getByTestId('result-screen')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('result-revive')).toHaveClass(/is-disabled/);
    await page.getByTestId('result-retry').tap();
    s = await state(page);
    expect(s.player.hp).toBe(s.player.maxHp);
    expect(errors).toEqual([]);
  });

  test('pause menu: settings + Copy debug log puts a report on the clipboard', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const errors = collectErrors(page);
    await startGame(page);
    await page.getByTestId('hud-pause').tap();
    await expect(page.getByTestId('pause-menu')).toBeVisible();
    expect((await state(page)).paused).toBe(true);
    await page.screenshot({ path: `${SHOTS}/09-pause.png` });
    await page.getByTestId('copy-log').tap();
    await expect(page.getByTestId('copy-result')).toContainText('copied');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('=== ASHBOUND DEBUG LOG ===');
    expect(clip).toContain('gpuRenderer');
    expect(clip).toContain('stage countdown');
    await page.locator('.segment[data-value="30"]').tap();
    await page.locator('.segment[data-value="high"]').tap();
    await page.waitForFunction(
      () =>
        (
          window as unknown as { __ashbound: { state: () => { quality: string } } }
        ).__ashbound.state().quality === 'high',
    );
    await page.getByTestId('pause-resume').tap();
    await expect(page.getByTestId('pause-menu')).toBeHidden();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${SHOTS}/10-high.png` });
    expect((await state(page)).paused).toBe(false);
    expect(errors).toEqual([]);
  });

  test('hidden gesture: triple-tap top-left corner toggles the debug overlay', async ({
    page,
    context,
  }) => {
    await startGame(page);
    const touch = await TouchDriver.create(context, page);
    for (let i = 0; i < 3; i++) await touch.tap(4, 20, 20, 30);
    await expect(page.getByTestId('debug-overlay')).toBeVisible();
    await page.waitForTimeout(600);
    await expect(page.locator('.debug-text')).toContainText('FPS');
    await expect(page.locator('.debug-text')).toContainText('draws');
    await page.screenshot({ path: `${SHOTS}/11-debug.png` });
    // The first CDP touch after a quiet period takes ~2 s to dispatch in headless Chromium
    // (measured: no long tasks in the page). Warm the input path with a tap on empty screen.
    await touch.tap(5, 450, 220, 30);
    for (let i = 0; i < 3; i++) await touch.tap(4, 20, 20, 30);
    await expect(page.getByTestId('debug-overlay')).toBeHidden();
  });

  test('60 s soak: live combat with continuous touch play, zero errors, no heap growth trend', async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    const errors = collectErrors(page);
    await startGame(page);
    await hook(page, 'setGod', true);
    await page.getByTestId('start-now').tap();
    const touch = await TouchDriver.create(context, page);
    const cdp = await context.newCDPSession(page);
    const attack = await centerOf(page.locator('.tc-attack'));
    const dodge = await centerOf(page.locator('.tc-dodge'));
    const skills = [
      await centerOf(page.locator('.tc-skill1')),
      await centerOf(page.locator('.tc-skill2')),
      await centerOf(page.locator('.tc-skill3')),
    ];
    const t0 = Date.now();
    const times: number[] = [];
    const heaps: number[] = [];
    let last = -Infinity;
    let angle = 0;
    let tick = 0;
    let attackTaps = 0;
    await touch.down(1, 170, 300);
    while (Date.now() - t0 < 60_000) {
      angle += 0.1;
      await touch.move(1, 170 + Math.cos(angle) * 45, 300 + Math.sin(angle) * 45);
      if (tick % 5 === 0) {
        await touch.tap(2, attack.x, attack.y, 30);
        attackTaps++;
      }
      if (tick % 23 === 0) await touch.tap(3, dodge.x, dodge.y, 30);
      if (tick % 37 === 0) {
        const s = skills[(tick / 37) % 3];
        if (s !== undefined) await touch.tap(3, s.x, s.y, 30);
      }
      if (tick % 150 === 75) {
        await touch.up(1);
        await touch.down(1, 170, 300);
      }
      const e = (Date.now() - t0) / 1000;
      if (e - last >= 10) {
        last = e;
        times.push(e);
        heaps.push(await heapAfterGC(cdp));
      }
      tick++;
      await page.waitForTimeout(50);
    }
    await touch.upAll();
    times.push((Date.now() - t0) / 1000);
    heaps.push(await heapAfterGC(cdp));
    const s = await state(page);
    const growthKBps = slope(times, heaps) / 1024;
    console.info(
      `[soak] frames ${s.frames}, fps(swiftshader) ${s.fps.toFixed(1)}, killed ${s.stage.killed}, wave ${s.stage.wave + 1}, ` +
        `draws ${s.drawCalls}, heap MB ${heaps.map((h) => (h / 1048576).toFixed(2)).join(' → ')}, trend ${growthKBps.toFixed(1)} KB/s`,
    );
    expect(errors).toEqual([]);
    expect(s.errors).toBe(0);
    expect(s.presses['attack']).toBe(attackTaps);
    // Combat happened: the wave is running and hits landed (ultimate charges from damage dealt).
    // Kills aren't asserted here — at ~7 FPS software WebGL a minute is ~20 s of game time while
    // the scripted thumb runs in circles; the wave-combat test covers kills.
    expect(s.stage.wave).toBeGreaterThanOrEqual(0);
    expect(s.ultimate + s.stage.killed).toBeGreaterThan(0);
    expect(s.activeTouches).toBe(0);
    expect(s.move).toEqual({ x: 0, y: 0 });
    expect(growthKBps).toBeLessThan(40);
    expect((heaps.at(-1) ?? 0) - (heaps[0] ?? 0)).toBeLessThan(6 * 1048576);
  });
});
