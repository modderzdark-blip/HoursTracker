import type { BrowserContext, CDPSession, Locator, Page } from '@playwright/test';

export interface HookState {
  ready: boolean;
  running: boolean;
  paused: boolean;
  screen: string;
  player: {
    x: number;
    y: number;
    z: number;
    grounded: boolean;
    speed: number;
    yaw: number;
    hp: number;
    maxHp: number;
    state: string;
    comboIndex: number;
    action: string | null;
  };
  presses: Record<string, number>;
  ultimate: number;
  skillReady: boolean[];
  stage: {
    id: string;
    phase: string;
    wave: number;
    enemiesAlive: number;
    killed: number;
    result: string | null;
    timeSec: number;
  };
  boss: {
    active: boolean;
    hp: number;
    maxHp: number;
    phase: number;
    state: string;
    breakFrac: number;
  };
  hero: { id: string; level: number; xp: number; power: number };
  items: number;
  wallet: Record<string, number>;
  tokensInUse: number;
  telegraphs: number;
  cinematic: boolean;
  quality: string;
  benchmarkRunning: boolean;
  fps: number;
  frames: number;
  drawCalls: number;
  triangles: number;
  heapMB: number | null;
  errors: number;
  activeTouches: number;
  joystickActive: boolean;
  move: { x: number; y: number };
  debugOverlay: boolean;
  camera: { distance: number; height: number; fov: number; shake: number };
  pixelRatio: number;
  preset: { shadows: boolean; bloom: boolean; particleCount: number };
}

type HookCommand =
  'skipCountdown' | 'killAll' | 'skipToBoss' | 'killBoss' | 'restart' | 'fillUltimate' | 'goHub';

/** Calls a test-hook command in the page. */
export async function hook(
  page: Page,
  cmd: HookCommand | 'damageBoss' | 'damagePlayer' | 'setGod' | 'setPaused' | 'startStage',
  arg?: number | boolean | string,
): Promise<void> {
  await page.evaluate(
    ([c, a]) => {
      const h = (window as unknown as { __ashbound: Record<string, (x?: unknown) => void> })
        .__ashbound;
      const fn = h[c as string];
      if (fn === undefined) throw new Error(`no hook ${String(c)}`);
      fn(a);
    },
    [cmd, arg] as const,
  );
}

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

export async function state(page: Page): Promise<HookState> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __ashbound?: { state: () => unknown } }).__ashbound;
    if (hook === undefined) throw new Error('test hook missing');
    return hook.state() as HookState;
  });
}

/** Title → tap → hub. */
export async function enterHub(page: Page): Promise<void> {
  await page.goto('./');
  await page.locator('.title-start.is-pulsing').waitFor({ timeout: 90_000 });
  await page.touchscreen.tap(450, 300);
  await page.waitForFunction(
    () =>
      (
        window as unknown as { __ashbound?: { state: () => { running: boolean; screen: string } } }
      ).__ashbound?.state().screen === 'hub',
  );
  // First visit of the day: the daily-gift calendar pops over the hub. Claim it.
  const gift = page.getByTestId('login-modal-claim');
  if (await gift.isVisible()) {
    await gift.tap();
    await gift.waitFor({ state: 'hidden' });
  }
}

/** Title → hub → straight into a stage via the test hook (default: 1-1 with the dummy). */
export async function startGame(page: Page, stageId = 'c1s1'): Promise<void> {
  await enterHub(page);
  await hook(page, 'startStage', stageId);
  await page.waitForFunction(
    () =>
      (window as unknown as { __ashbound: { state: () => { screen: string } } }).__ashbound.state()
        .screen === 'battle',
  );
  // Let a few frames render.
  const start = (await state(page)).frames;
  await page.waitForFunction(
    (f) =>
      ((window as unknown as { __ashbound: { state: () => { frames: number } } }).__ashbound.state()
        .frames ?? 0) >
      f + 10,
    start,
  );
}

export async function centerOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('element not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Real multi-touch via the Chrome DevTools Protocol. Chrome turns these into genuine touch +
 * pointer events, so the game's pointer handling is exercised end to end.
 * touchStart/touchMove send all active points (Chrome diffs them); touchEnd lists the lifted one.
 */
export class TouchDriver {
  private readonly active = new Map<number, { x: number; y: number }>();

  private constructor(private readonly cdp: CDPSession) {}

  static async create(context: BrowserContext, page: Page): Promise<TouchDriver> {
    return new TouchDriver(await context.newCDPSession(page));
  }

  private points(): { x: number; y: number; id: number }[] {
    return [...this.active.entries()].map(([id, p]) => ({ x: p.x, y: p.y, id }));
  }

  async down(id: number, x: number, y: number): Promise<void> {
    this.active.set(id, { x, y });
    await this.cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: this.points(),
    });
  }

  async move(id: number, x: number, y: number): Promise<void> {
    this.active.set(id, { x, y });
    await this.cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: this.points(),
    });
  }

  async up(id: number): Promise<void> {
    const p = this.active.get(id);
    if (p === undefined) return;
    this.active.delete(id);
    await this.cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [{ x: p.x, y: p.y, id }],
    });
  }

  async tap(id: number, x: number, y: number, holdMs = 60): Promise<void> {
    await this.down(id, x, y);
    await new Promise((r) => setTimeout(r, holdMs));
    await this.up(id);
  }

  async upAll(): Promise<void> {
    for (const id of [...this.active.keys()]) await this.up(id);
  }
}

/** JS heap used (bytes) after a forced GC, via CDP. */
export async function heapAfterGC(cdp: CDPSession): Promise<number> {
  await cdp.send('HeapProfiler.collectGarbage');
  const usage = await cdp.send('Runtime.getHeapUsage');
  return usage.usedSize;
}

/** Least-squares slope of y over x. */
export function slope(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += ((xs[i] ?? 0) - mx) * ((ys[i] ?? 0) - my);
    den += ((xs[i] ?? 0) - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}
