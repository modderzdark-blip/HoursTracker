import type { BrowserContext, CDPSession, Locator, Page } from '@playwright/test';

export interface HookState {
  ready: boolean;
  running: boolean;
  paused: boolean;
  player: { x: number; y: number; z: number; grounded: boolean; speed: number; yaw: number };
  attacks: number;
  dodges: number;
  presses: Record<string, number>;
  ultimate: number;
  skillReady: boolean[];
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
  debugOverlay: boolean;
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

export async function startGame(page: Page): Promise<void> {
  await page.goto('./');
  await page.locator('.title-start.is-pulsing').waitFor({ timeout: 90_000 });
  await page.touchscreen.tap(450, 300);
  await page.waitForFunction(
    () =>
      (
        window as unknown as { __ashbound?: { state: () => { running: boolean; frames: number } } }
      ).__ashbound?.state().running === true,
  );
  // Let a few frames render.
  await page.waitForFunction(
    () =>
      ((window as unknown as { __ashbound: { state: () => { frames: number } } }).__ashbound.state()
        .frames ?? 0) > 10,
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
