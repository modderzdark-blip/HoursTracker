import { expect, test, type Locator, type Page } from '@playwright/test';
import { collectErrors, enterHub, hook, state, TouchDriver } from './helpers';

const SHOTS = 'test-results/settings';
const SECTIONS = ['camera', 'graphics', 'controls', 'display', 'audio', 'gameplay'] as const;
const BASE_DISTANCE = 5.8;
const BASE_HEIGHT = 5.0;

/** Taps a slider track near one end (left = minimum, right = maximum). */
async function tapSliderEnd(page: Page, slider: Locator, end: 'min' | 'max'): Promise<void> {
  await slider.scrollIntoViewIfNeeded();
  const box = await slider.boundingBox();
  if (box === null) throw new Error('slider not visible');
  const x = end === 'min' ? box.x + 3 : box.x + box.width - 3;
  await page.touchscreen.tap(x, box.y + box.height / 2);
}

async function openSettings(page: Page, section?: (typeof SECTIONS)[number]): Promise<void> {
  await page.getByTestId('dock-settings').tap();
  await expect(page.locator('.menu')).toHaveAttribute('data-screen', 'settings');
  if (section !== undefined) {
    await page.getByTestId(`settings-tab-${section}`).tap();
    await expect(page.getByTestId('settings-content')).toHaveAttribute('data-section', section);
  }
}

test.describe('Settings', () => {
  test('screenshots of every section on a small phone and a tablet', async ({ page }) => {
    const errors = collectErrors(page);
    await enterHub(page);
    await openSettings(page);
    // The daily-gift toast fades on its own; keep it out of the screenshots.
    await expect(page.locator('.hud-toast')).toBeHidden({ timeout: 10_000 });
    for (const vp of [
      { width: 640, height: 320 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(vp);
      for (const sec of SECTIONS) {
        await page.getByTestId(`settings-tab-${sec}`).tap();
        await expect(page.getByTestId('settings-content')).toHaveAttribute('data-section', sec);
        await page.waitForTimeout(150);
        await page.screenshot({ path: `${SHOTS}/${vp.width}x${vp.height}-${sec}.png` });
      }
    }
    expect(errors).toEqual([]);
  });

  test('options apply immediately, persist across a reload and reset to defaults', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await enterHub(page);
    await openSettings(page);
    await expect(page.getByTestId('settings-content')).toHaveAttribute('data-section', 'camera');
    const before = await state(page);
    expect(before.camera.distance).toBeCloseTo(BASE_DISTANCE);
    expect(before.camera.fov).toBe(48);

    // Camera: presets, angle, FOV, fine slider, shake slider.
    await page.getByTestId('set-cam-dist-1.4').tap();
    await page.getByTestId('set-cam-height-high').tap();
    await page.getByTestId('set-cam-fov-wide').tap();
    let s = await state(page);
    expect(s.camera.distance).toBeCloseTo(BASE_DISTANCE * 1.4);
    expect(s.camera.height).toBeCloseTo(BASE_HEIGHT * 1.4 * 1.3);
    expect(s.camera.fov).toBe(56);
    await expect(page.getByTestId('set-cam-dist-1.4')).toHaveClass(/is-selected/);
    await tapSliderEnd(page, page.getByTestId('set-cam-dist-fine'), 'min');
    await expect
      .poll(async () => (await state(page)).camera.distance)
      .toBeCloseTo(BASE_DISTANCE * 0.7);
    // A custom distance highlights no preset.
    await expect(page.locator('[data-testid^="set-cam-dist-"].is-selected')).toHaveCount(0);
    await tapSliderEnd(page, page.getByTestId('set-shake'), 'max');
    await expect.poll(async () => (await state(page)).camera.shake).toBe(1.5);
    await expect(page.getByTestId('set-shake')).toHaveAttribute('aria-valuetext', '150%');

    // Graphics: overrides reach the active preset, resolution scale reaches the renderer.
    await page.getByTestId('settings-tab-graphics').tap();
    await page.getByTestId('set-shadows-off').tap();
    await page.getByTestId('set-bloom-on').tap();
    const fullParticles = (await state(page)).preset.particleCount;
    await page.getByTestId('set-particles-low').tap();
    s = await state(page);
    expect(s.preset.shadows).toBe(false);
    expect(s.preset.bloom).toBe(true);
    expect(s.preset.particleCount).toBe(Math.round(fullParticles * 0.5));
    await tapSliderEnd(page, page.getByTestId('set-res-scale'), 'min');
    await expect
      .poll(async () => (await state(page)).pixelRatio)
      .toBeCloseTo(Math.max(0.5, before.pixelRatio * 0.5));
    await page.getByTestId('set-show-fps-on').tap();
    await expect(page.getByTestId('fps-counter')).toBeVisible();
    await expect(page.getByTestId('fps-counter')).toContainText('FPS');

    // Accessibility: larger menu text scales the menus right away.
    await page.getByTestId('settings-tab-display').tap();
    await page.getByTestId('set-large-text-on').tap();
    await expect(page.locator('#ui-root')).toHaveClass(/large-text/);
    const t = await page.locator('.menu').evaluate((m) => getComputedStyle(m).transform);
    expect(t).toContain('matrix(1.15');
    await page.screenshot({ path: `${SHOTS}/large-text.png` });

    // Persisted: reload and check the live values again.
    await page.waitForTimeout(900);
    await enterHub(page);
    s = await state(page);
    expect(s.camera.distance).toBeCloseTo(BASE_DISTANCE * 0.7);
    expect(s.camera.fov).toBe(56);
    expect(s.camera.shake).toBe(1.5);
    expect(s.preset.shadows).toBe(false);
    expect(s.pixelRatio).toBeCloseTo(Math.max(0.5, before.pixelRatio * 0.5));
    await expect(page.getByTestId('fps-counter')).toBeVisible();
    await expect(page.locator('#ui-root')).toHaveClass(/large-text/);

    // Reset camera, then reset everything (behind a confirmation).
    await openSettings(page, 'camera');
    await page.getByTestId('set-cam-reset').scrollIntoViewIfNeeded();
    await page.getByTestId('set-cam-reset').tap();
    s = await state(page);
    expect(s.camera.distance).toBeCloseTo(BASE_DISTANCE);
    expect(s.camera.fov).toBe(48);
    expect(s.camera.shake).toBe(1);
    expect(s.preset.shadows).toBe(false);
    await page.getByTestId('settings-tab-gameplay').tap();
    await page.getByTestId('set-reset-all').scrollIntoViewIfNeeded();
    await page.getByTestId('set-reset-all').tap();
    await expect(page.getByTestId('settings-reset-confirm')).toBeVisible();
    await page.getByTestId('settings-reset-cancel').tap();
    await expect(page.getByTestId('fps-counter')).toBeVisible();
    await page.getByTestId('set-reset-all').tap();
    await page.getByTestId('settings-reset-confirm').tap();
    await expect(page.getByTestId('fps-counter')).toBeHidden();
    await expect(page.locator('#ui-root')).not.toHaveClass(/large-text/);
    s = await state(page);
    expect(s.pixelRatio).toBeCloseTo(before.pixelRatio);
    expect(s.preset).toEqual(before.preset);
    expect(errors).toEqual([]);
  });

  test('in battle: fixed joystick, HUD scale, combo / flash options and pause quick settings', async ({
    page,
    context,
  }) => {
    const errors = collectErrors(page);
    await enterHub(page);
    await openSettings(page, 'controls');
    await page.getByTestId('set-joy-mode-fixed').tap();
    await tapSliderEnd(page, page.getByTestId('set-joy-size'), 'max');
    await page.getByTestId('set-autoaim-off').tap();
    await expect(page.getByTestId('row-set-aim-range')).toHaveClass(/is-disabled/);
    await page.getByTestId('settings-tab-display').tap();
    await page.getByTestId('set-combo-off').tap();
    await page.getByTestId('set-reduce-flash-on').tap();
    await tapSliderEnd(page, page.getByTestId('set-hud-scale'), 'max');
    await page.getByTestId('menu-back').tap();

    await hook(page, 'startStage', 'c1s1');
    await expect.poll(async () => (await state(page)).screen, { timeout: 30_000 }).toBe('battle');
    const root = page.locator('#ui-root');
    await expect(root).toHaveClass(/no-combo/);
    await expect(root).toHaveClass(/reduce-flashes/);
    await expect(root).toHaveClass(/hud-scaled/);
    const hudT = await page.locator('.bhud').evaluate((m) => getComputedStyle(m).transform);
    expect(hudT).toContain('matrix(1.3');
    await expect(page.locator('.touch-layer')).toHaveClass(/is-joy-fixed/);
    const base = await page.locator('.tc-joy-base').boundingBox();
    expect(base?.width ?? 0).toBeCloseTo(64 * 2 * 1.35, 0);

    // A fixed stick reads a deflection on touch-down (a floating one would start centred).
    await hook(page, 'skipCountdown');
    const touch = await TouchDriver.create(context, page);
    const cx = (base?.x ?? 0) + (base?.width ?? 0) / 2;
    const cy = (base?.y ?? 0) + (base?.height ?? 0) / 2;
    await touch.down(1, cx + 70, cy);
    await expect.poll(async () => (await state(page)).joystickActive).toBe(true);
    expect((await state(page)).move.x).toBeGreaterThan(0.5);
    await touch.upAll();
    await expect.poll(async () => (await state(page)).joystickActive).toBe(false);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/battle-hud-130.png` });

    // Pause menu quick settings change the live camera.
    await page.getByTestId('hud-pause').tap();
    await expect(page.getByTestId('pause-menu')).toBeVisible();
    await page.getByTestId('pause-camera').locator('.segment[data-value="1.2"]').tap();
    await expect
      .poll(async () => (await state(page)).camera.distance)
      .toBeCloseTo(BASE_DISTANCE * 1.2);
    await page.getByTestId('pause-shake').locator('.segment[data-value="0"]').tap();
    await expect.poll(async () => (await state(page)).camera.shake).toBe(0);
    await page.screenshot({ path: `${SHOTS}/pause-quick-settings.png` });
    await page.getByTestId('pause-resume').tap();
    await expect(page.getByTestId('pause-menu')).toBeHidden();
    expect(errors).toEqual([]);
  });
});
