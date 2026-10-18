import { expect, test } from '@playwright/test';
import {
  TouchDriver,
  centerOf,
  collectErrors,
  heapAfterGC,
  slope,
  startGame,
  state,
} from './helpers';

const SHOTS = 'test-results/screenshots';

test.describe('M1 smoke (Pixel 7 landscape, touch)', () => {
  test('title loads with zero console errors', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./');
    await expect(page.getByTestId('title-screen')).toBeVisible();
    await page.locator('.title-start.is-pulsing').waitFor({ timeout: 90_000 });
    await expect(page.locator('.title-name')).toHaveText('ASHBOUND');
    await page.screenshot({ path: `${SHOTS}/m1-title.png` });
    expect(errors).toEqual([]);
  });

  test('canvas renders the arena and HUD after tapping start', async ({ page }) => {
    const errors = collectErrors(page);
    await startGame(page);
    await page.waitForTimeout(1500);
    const s = await state(page);
    expect(s.drawCalls).toBeGreaterThan(5);
    expect(s.triangles).toBeGreaterThan(1000);
    expect(s.drawCalls).toBeLessThan(150); // performance budget
    expect(s.player.grounded).toBe(true);
    await expect(page.getByTestId('touch-layer')).toBeVisible();
    // The canvas must not be blank. WebGL's buffer is cleared after compositing
    // (preserveDrawingBuffer: false), so measure pixel variance on a real screenshot instead.
    const shot = await page.screenshot({ path: `${SHOTS}/m1-ingame.png` });
    const variance = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const tmp = document.createElement('canvas');
      tmp.width = 96;
      tmp.height = 48;
      const ctx = tmp.getContext('2d');
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

  test('touch joystick moves the hero; ATTACK triggers a swing while moving (multi-touch)', async ({
    page,
    context,
  }) => {
    const errors = collectErrors(page);
    await startGame(page);
    const touch = await TouchDriver.create(context, page);
    const before = await state(page);

    // Finger 1: joystick, pushed up-right (forward + right relative to the camera).
    await touch.down(1, 160, 300);
    for (let i = 1; i <= 8; i++) await touch.move(1, 160 + i * 6, 300 - i * 8);
    await page.waitForTimeout(800);
    const moving = await state(page);
    expect(moving.joystickActive).toBe(true);
    expect(moving.player.speed).toBeGreaterThan(2);
    expect(moving.player.z).toBeLessThan(before.player.z - 0.5); // forward = -Z
    expect(moving.player.x).toBeGreaterThan(before.player.x + 0.2);

    // Finger 2: tap ATTACK three times while finger 1 keeps steering.
    const attack = await centerOf(page.locator('.tc-attack'));
    for (let i = 0; i < 3; i++) {
      await touch.tap(2, attack.x, attack.y, 50);
      await page.waitForTimeout(320);
    }
    const attacked = await state(page);
    expect(attacked.presses['attack']).toBe(3);
    expect(attacked.attacks).toBeGreaterThanOrEqual(3);
    expect(attacked.joystickActive).toBe(true); // joystick unaffected by the second finger
    await page.screenshot({ path: `${SHOTS}/m1-moving-attack.png` });

    // Release: nothing may stay stuck.
    await touch.upAll();
    await page.waitForTimeout(600);
    const after = await state(page);
    expect(after.joystickActive).toBe(false);
    expect(after.activeTouches).toBe(0);
    expect(after.player.speed).toBeLessThan(0.01);
    expect(errors).toEqual([]);
  });

  test('a finger sliding off a button releases it (no stuck touch)', async ({ page, context }) => {
    await startGame(page);
    const touch = await TouchDriver.create(context, page);
    const skill = await centerOf(page.locator('.tc-skill1'));
    await touch.down(3, skill.x, skill.y);
    expect((await state(page)).activeTouches).toBe(1);
    // The press is consumed on the next fixed logic step.
    await expect.poll(async () => (await state(page)).skillReady[0]).toBe(false);
    await touch.move(3, skill.x - 150, skill.y - 120);
    expect((await state(page)).activeTouches).toBe(0);
    await touch.up(3);
    await expect(page.locator('.tc-skill1')).toHaveClass(/is-cooling/);
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
    await page.screenshot({ path: `${SHOTS}/m1-pause.png` });

    await page.getByTestId('copy-log').tap();
    await expect(page.getByTestId('copy-result')).toContainText('copied');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('=== ASHBOUND DEBUG LOG ===');
    expect(clip).toContain('gpuRenderer');
    expect(clip).toContain('FPS');

    // FPS cap 30 and quality HIGH apply without errors.
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
    await page.screenshot({ path: `${SHOTS}/m1-ingame-high.png` });
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
    await page.screenshot({ path: `${SHOTS}/m1-debug-overlay.png` });
    for (let i = 0; i < 3; i++) await touch.tap(4, 20, 20, 30);
    await expect(page.getByTestId('debug-overlay')).toBeHidden();
  });

  test('scripted 60 s soak: continuous touch play, zero errors, no heap growth trend', async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await startGame(page);
    const touch = await TouchDriver.create(context, page);
    const cdp = await context.newCDPSession(page);
    const attack = await centerOf(page.locator('.tc-attack'));
    const skills = [
      await centerOf(page.locator('.tc-skill1')),
      await centerOf(page.locator('.tc-skill2')),
      await centerOf(page.locator('.tc-skill3')),
    ];

    const t0 = Date.now();
    const times: number[] = [];
    const heaps: number[] = [];
    let lastSample = -Infinity;
    let angle = 0;
    await touch.down(1, 170, 300);
    let tick = 0;
    while (Date.now() - t0 < 60_000) {
      angle += 0.12;
      await touch.move(1, 170 + Math.cos(angle) * 50, 300 + Math.sin(angle) * 50);
      if (tick % 6 === 0) await touch.tap(2, attack.x, attack.y, 30);
      if (tick % 40 === 0) {
        const s = skills[(tick / 40) % 3];
        if (s !== undefined) await touch.tap(3, s.x, s.y, 30);
      }
      if (tick % 150 === 75) {
        // Lift and re-place the stick finger now and then (new pointer id each time).
        await touch.up(1);
        await touch.down(1, 170, 300);
      }
      const elapsed = (Date.now() - t0) / 1000;
      if (elapsed - lastSample >= 10) {
        lastSample = elapsed;
        times.push(elapsed);
        heaps.push(await heapAfterGC(cdp));
      }
      tick++;
      await page.waitForTimeout(50);
    }
    await touch.upAll();
    times.push((Date.now() - t0) / 1000);
    heaps.push(await heapAfterGC(cdp));

    const s = await state(page);
    const mb = heaps.map((h) => h / 1048576);
    const growthKBps = slope(times, heaps) / 1024;
    console.info(
      `[soak] frames ${s.frames}, fps(swiftshader) ${s.fps.toFixed(1)}, attacks ${s.attacks}, heap MB ${mb
        .map((m) => m.toFixed(2))
        .join(
          ' → ',
        )}, trend ${growthKBps.toFixed(1)} KB/s, pos ${s.player.x.toFixed(1)},${s.player.z.toFixed(1)}`,
    );
    expect(errors).toEqual([]);
    expect(s.errors).toBe(0);
    expect(s.attacks).toBeGreaterThan(20);
    expect(s.activeTouches).toBe(0);
    expect(s.joystickActive).toBe(false);
    // No growth trend: under 20 KB/s and under 3 MB net across the minute (after forced GC).
    expect(growthKBps).toBeLessThan(20);
    expect((heaps.at(-1) ?? 0) - (heaps[0] ?? 0)).toBeLessThan(3 * 1048576);
  });
});
