import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { collectErrors, hook, state } from './helpers';
import { audit, settle, type AuditIssue, type AuditResult } from './uiAudit';

/**
 * Layout audit of every menu, modal and HUD screen at several landscape phone / tablet sizes.
 * For each screen and viewport an in-page check reports overlapping text, clipped or spilling
 * text, content off screen or under the top bar / safe areas, tiny text, small tap targets and
 * scroll areas that touch can't pan. Screenshots and a text report go to test-results/ui-audit/.
 *
 * CI runs three viewports; UI_AUDIT_ALL=1 runs the full set.
 */

interface Viewport {
  readonly width: number;
  readonly height: number;
}

const ALL_VIEWPORTS: readonly Viewport[] = [
  { width: 640, height: 320 },
  { width: 740, height: 360 },
  { width: 800, height: 360 },
  { width: 915, height: 412 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
];
const CI_VIEWPORTS: readonly Viewport[] = [
  { width: 640, height: 320 },
  { width: 800, height: 360 },
  { width: 1280, height: 800 },
];
const VIEWPORTS = process.env['UI_AUDIT_ALL'] === '1' ? ALL_VIEWPORTS : CI_VIEWPORTS;
const HOME: Viewport = { width: 915, height: 412 };
const OUT = 'test-results/ui-audit';

/** Phones in landscape: a punch-hole / notch on either side and the gesture bar at the bottom. */
function insetsFor(vp: Viewport): { l: number; r: number; t: number; b: number } {
  return vp.height <= 480 ? { l: 32, r: 32, t: 0, b: 12 } : { l: 0, r: 0, t: 0, b: 0 };
}

interface Where {
  readonly scope: readonly string[];
  readonly ignore?: readonly string[];
  readonly mustSee?: readonly string[];
}

const MENU: Where = { scope: ['.menu'] };
const MODAL: Where = { scope: ['.menu .modal'], mustSee: ['.modal-panel > .button-row'] };
const REWARD: Where = { scope: ['.menu'], mustSee: ['.reward .button-row'] };
const BATTLE: Where = {
  scope: ['#ui-root'],
  ignore: ['.menu', '.title-screen', '.pause-menu', '.result-screen'],
};
const PAUSE: Where = { scope: ['.pause-menu'], mustSee: ['[data-testid="pause-resume"]'] };
const REVIVE: Where = { scope: ['.result-screen'], mustSee: ['.result-panel .button-row'] };
const TITLE: Where = { scope: ['.title-screen'], mustSee: ['.title-start'] };

interface Finding {
  readonly viewport: string;
  readonly screen: string;
  readonly result: AuditResult;
}

const SEED_URL = '__ui_audit_seed';

async function screen(page: Page, findings: Finding[], name: string, where: Where): Promise<void> {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize(vp);
    const ins = insetsFor(vp);
    await page.evaluate((i) => {
      let s = document.getElementById('ui-audit-insets');
      if (s === null) {
        s = document.createElement('style');
        s.id = 'ui-audit-insets';
        document.head.append(s);
      }
      s.textContent = `:root{--sl:${i.l}px!important;--sr:${i.r}px!important;--st:${i.t}px!important;--sb:${i.b}px!important}`;
    }, ins);
    await page.waitForTimeout(120);
    await settle(page);
    const result = await audit(page, { ...where, insets: ins });
    const label = `${vp.width}x${vp.height}`;
    findings.push({ viewport: label, screen: name, result });
    expect(result.textCount, `${name} @ ${label}: nothing visible to audit`).toBeGreaterThan(0);
    await page.screenshot({ path: `${OUT}/${label}/${name}.png` });
  }
  await page.setViewportSize(HOME);
  await page.waitForTimeout(80);
}

async function waitScreen(page: Page, name: string, timeout = 60_000): Promise<void> {
  await expect.poll(async () => (await state(page)).screen, { timeout }).toBe(name);
}

async function tapTestId(page: Page, id: string): Promise<void> {
  await page.getByTestId(id).tap();
}

/** Copies the real items in the save many times (varied rarity, upgrades, locks) and equips a full set. */
async function seedInventory(page: Page): Promise<void> {
  await page.route(`**/${SEED_URL}`, (r) =>
    r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>seed</title>' }),
  );
  await page.goto(`./${SEED_URL}`);
  await page.evaluate(async () => {
    const open = (): Promise<IDBDatabase> =>
      new Promise((res, rej) => {
        const req = indexedDB.open('ashbound', 1);
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error ?? new Error('open failed'));
      });
    const db = await open();
    const get = (): Promise<string> =>
      new Promise((res, rej) => {
        const g = db.transaction('kv', 'readonly').objectStore('kv').get('save');
        g.onsuccess = () => res(String(g.result));
        g.onerror = () => rej(g.error ?? new Error('get failed'));
      });
    const save = JSON.parse(await get()) as {
      profile: {
        items: Record<string, unknown>[];
        nextUid: number;
        heroes: Record<string, { equipped: Record<string, number> }>;
      };
    };
    const p = save.profile;
    const source = p.items;
    if (source.length === 0) throw new Error('no items to copy');
    const rarities = ['common', 'rare', 'epic', 'legendary', 'mythic'];
    const slots = ['weapon', 'armor', 'helmet', 'gloves', 'ring', 'amulet'];
    const out: Record<string, unknown>[] = [];
    let uid = 1;
    for (let i = 0; i < 64; i++) {
      const src = source[i % source.length] ?? {};
      out.push({
        ...src,
        uid: uid++,
        slot: slots[i % slots.length],
        rarity: rarities[(i * 7) % rarities.length],
        base: i % 5,
        ilvl: 5 + ((i * 13) % 60),
        plus: (i * 3) % 16,
        locked: i % 9 === 0,
        isNew: i % 4 === 0,
      });
    }
    p.items = out;
    p.nextUid = uid;
    const kael = p.heroes['kael'];
    if (kael !== undefined) {
      kael.equipped = {};
      out.slice(0, 6).forEach((it) => {
        kael.equipped[String(it['slot'])] = Number(it['uid']);
      });
    }
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(JSON.stringify(save), 'save');
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error ?? new Error('put failed'));
    });
    db.close();
  });
  await page.unroute(`**/${SEED_URL}`);
}

async function boot(page: Page): Promise<void> {
  await page.goto('./');
  await page.locator('.title-start.is-pulsing').waitFor({ timeout: 90_000 });
}

async function enter(page: Page): Promise<void> {
  await page.touchscreen.tap(HOME.width / 2, HOME.height * 0.7);
  await waitScreen(page, 'hub');
}

function report(findings: readonly Finding[]): { text: string; issues: number } {
  const lines: string[] = [];
  let issues = 0;
  const byVp = new Map<string, Finding[]>();
  for (const f of findings) byVp.set(f.viewport, [...(byVp.get(f.viewport) ?? []), f]);
  for (const [vp, list] of byVp) {
    lines.push(`=== ${vp} ===`);
    for (const f of list) {
      const n = f.result.issues.length;
      issues += n;
      lines.push(
        `  ${n === 0 ? 'ok  ' : 'FAIL'} ${f.screen} (${f.result.textCount} text elements, ${n} issues)`,
      );
      const kinds = new Map<AuditIssue['kind'], string[]>();
      for (const i of f.result.issues) kinds.set(i.kind, [...(kinds.get(i.kind) ?? []), i.detail]);
      for (const [k, ds] of kinds) for (const d of ds) lines.push(`         [${k}] ${d}`);
      for (const e of f.result.ellipsized) lines.push(`         (ellipsis) ${e}`);
    }
  }
  lines.push(`Total issues: ${issues}`);
  return { text: lines.join('\n'), issues };
}

test.describe('UI layout audit', () => {
  test('every screen and modal is free of overlaps, clipping and off-screen content', async ({
    page,
  }) => {
    test.setTimeout(900_000);
    mkdirSync(OUT, { recursive: true });
    const errors = collectErrors(page);
    const findings: Finding[] = [];
    try {
      await run(page, findings);
    } finally {
      const r = report(findings);
      writeFileSync(`${OUT}/report.txt`, `${r.text}\n`);
      console.info(`[ui-audit]\n${r.text}`);
    }
    expect(errors).toEqual([]);
    expect(report(findings).issues, 'layout issues — see test-results/ui-audit/report.txt').toBe(0);
  });
});

async function run(page: Page, findings: Finding[]): Promise<void> {
  // ---- Title, daily gift, hub, journal (fresh profile)
  await boot(page);
  await screen(page, findings, 'title', TITLE);
  await enter(page);
  await expect(page.getByTestId('login-modal-claim')).toBeVisible();
  await screen(page, findings, 'daily-gift', MODAL);
  await tapTestId(page, 'login-modal-claim');
  await expect(page.getByTestId('login-modal-claim')).toBeHidden();
  await screen(page, findings, 'hub-new', MENU);
  await tapTestId(page, 'mode-arena');
  await expect(page.locator('.hud-toast')).toBeVisible();
  await screen(page, findings, 'hub-toast', MENU);
  await tapTestId(page, 'dock-quests');
  await waitScreen(page, 'quests');
  await screen(page, findings, 'journal', MENU);
  await tapTestId(page, 'menu-back');
  await waitScreen(page, 'hub');

  // ---- Boss battle: HUD, boss bar, pause, victory with loot + level-up + unlocks
  await hook(page, 'startStage', 'c1s8');
  await waitScreen(page, 'battle');
  await hook(page, 'setPaused', true);
  await page.evaluate(() => document.querySelector('.pause-menu')?.classList.add('is-hidden'));
  // The intro banner with the longest stage label (a blessed boss stage).
  await page.evaluate(() => {
    const banner = document.querySelector<HTMLElement>('.bhud-banner');
    if (banner !== null) {
      banner.className = 'bhud-banner banner-wave';
      banner.textContent = '1-8 · THRONE OF THE WARDEN · EMBER BLESSING ✦✦✦';
      banner.style.opacity = '1';
    }
  });
  await screen(page, findings, 'battle-countdown', BATTLE);
  await page.evaluate(() => {
    document.querySelector('.pause-menu')?.classList.remove('is-hidden');
    const banner = document.querySelector<HTMLElement>('.bhud-banner');
    if (banner !== null) {
      banner.style.opacity = '';
      banner.classList.add('is-hidden');
    }
  });
  await tapTestId(page, 'pause-resume');
  await hook(page, 'setGod', true);
  await hook(page, 'skipToBoss');
  await expect.poll(async () => (await state(page)).stage.phase, { timeout: 60_000 }).toBe('boss');
  await expect(page.getByTestId('boss-bar')).toBeVisible();
  await hook(page, 'damageBoss', 0.3);
  await page.waitForTimeout(1500);
  await hook(page, 'setPaused', true);
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  // Paused: the HUD stays still behind the menu, so audit it first with the menu hidden.
  await page.evaluate(() => document.querySelector('.pause-menu')?.classList.add('is-hidden'));
  // Worst case for the HUD: a status chip, the counter tag, a combo and a banner all at once.
  await page.evaluate(() => {
    document.querySelectorAll('.status-chip').forEach((c, i) => {
      if (i < 2) c.classList.remove('is-hidden');
    });
    document.querySelector('.bhud-counter')?.classList.remove('is-hidden');
    const combo = document.querySelector('.bhud-combo');
    if (combo !== null) {
      combo.classList.remove('is-hidden');
      combo.textContent = '128 HITS';
    }
    const banner = document.querySelector<HTMLElement>('.bhud-banner');
    if (banner !== null) {
      banner.className = 'bhud-banner banner-phase';
      banner.textContent = 'THE HOLLOW WARDEN FALLS';
      banner.style.opacity = '1';
    }
  });
  await screen(page, findings, 'battle-boss', BATTLE);
  // Same HUD with the controls mirrored for left-handed play at the largest button size.
  await page.evaluate(() => {
    const t = document.querySelector<HTMLElement>('.touch-layer');
    t?.classList.add('is-left');
    t?.style.setProperty('--btn-scale', '1.3');
  });
  await screen(page, findings, 'battle-boss-left-xl', BATTLE);
  await page.evaluate(() => {
    const t = document.querySelector<HTMLElement>('.touch-layer');
    t?.classList.remove('is-left');
    t?.style.setProperty('--btn-scale', '1');
  });
  await page.evaluate(() => {
    document.querySelector('.pause-menu')?.classList.remove('is-hidden');
    const banner = document.querySelector<HTMLElement>('.bhud-banner');
    if (banner !== null) {
      banner.style.opacity = '';
      banner.classList.add('is-hidden');
    }
  });
  await screen(page, findings, 'pause', PAUSE);
  await tapTestId(page, 'pause-resume');
  await hook(page, 'killBoss');
  await waitScreen(page, 'victory', 90_000);
  await expect(page.locator('.loot-card').first()).toBeVisible();
  await expect(page.locator('.reward-xp.is-levelup')).toBeVisible();
  await expect(page.locator('.reward-unlocks .unlock').first()).toBeVisible();
  await screen(page, findings, 'victory', REWARD);

  // ---- Stage map + pre-battle, then a defeat (in-battle panel, summary with Ember Blessing)
  await tapTestId(page, 'result-map');
  await waitScreen(page, 'map');
  await screen(page, findings, 'map-ch1', MENU);
  await tapTestId(page, 'stage-c1s1');
  await expect(page.getByTestId('prebattle-start')).toBeVisible();
  await screen(page, findings, 'prebattle', MODAL);
  await page.locator('.modal-panel .btn', { hasText: 'Close' }).tap();
  await hook(page, 'startStage', 'c1s1');
  await waitScreen(page, 'battle');
  await hook(page, 'damagePlayer', 1);
  await expect(page.getByTestId('result-screen')).toBeVisible({ timeout: 30_000 });
  await screen(page, findings, 'defeat-revive', REVIVE);
  await tapTestId(page, 'result-giveup');
  await waitScreen(page, 'defeat');
  await expect(page.locator('.reward-sub')).toContainText('Ember Blessing');
  await screen(page, findings, 'defeat', REWARD);
  await page.locator('[data-testid="result-map"]').tap();
  await waitScreen(page, 'map');
  await tapTestId(page, 'stage-c1s1');
  await expect(page.locator('.pb-blessing')).toBeVisible();
  await screen(page, findings, 'prebattle-blessing', MODAL);
  await page.locator('.modal-panel .btn', { hasText: 'Close' }).tap();
  await hook(page, 'goHub');
  await waitScreen(page, 'hub');
  await page.waitForTimeout(800);

  // ---- A late-game profile: full bag, every stage cleared, rich wallet
  await seedInventory(page);
  await boot(page);
  await enter(page);
  await page.evaluate(() => {
    const h = (
      window as unknown as {
        __ashbound: { clearStages: (n: number) => void; grant: (c: string, n: number) => void };
      }
    ).__ashbound;
    h.clearStages(24);
    h.grant('gold', 2_480_000);
    h.grant('gems', 12_345);
    h.grant('souls', 98_765);
    h.grant('materials', 54_321);
    h.grant('tickets', 1_234);
  });
  await waitScreen(page, 'hub');
  expect((await state(page)).items).toBeGreaterThanOrEqual(60);
  await screen(page, findings, 'hub-late', MENU);

  await tapTestId(page, 'dock-heroes');
  await waitScreen(page, 'heroes');
  await screen(page, findings, 'heroes', MENU);
  await tapTestId(page, 'hero-lyra');
  await screen(page, findings, 'heroes-locked', MENU);
  await tapTestId(page, 'menu-back');

  await tapTestId(page, 'dock-gear');
  await waitScreen(page, 'gear');
  await screen(page, findings, 'gear', MENU);
  await page.locator('.item-grid .item-tile').first().tap();
  await expect(page.getByTestId('item-equip')).toBeVisible();
  await screen(page, findings, 'item-compare', MODAL);
  // Upgrade the first bag item that is not maxed yet.
  const upgrade = page.getByTestId('item-upgrade');
  for (let i = 1; ((await upgrade.getAttribute('class')) ?? '').includes('is-disabled'); i++) {
    await page.locator('.modal-panel .btn', { hasText: 'Close' }).tap();
    await page.locator('.item-grid .item-tile').nth(i).tap();
  }
  await tapTestId(page, 'item-upgrade');
  await expect(page.locator('.hud-toast')).toBeVisible();
  await screen(page, findings, 'item-upgraded', MODAL);
  await page.locator('.modal-panel .btn', { hasText: 'Close' }).tap();
  await tapTestId(page, 'equip-weapon');
  await expect(page.getByTestId('item-equip')).toHaveText('Unequip');
  await screen(page, findings, 'item-worn', MODAL);
  await page.locator('.modal-panel .btn', { hasText: 'Close' }).tap();
  await tapTestId(page, 'filter-amulet');
  await screen(page, findings, 'gear-filtered', MENU);
  await tapTestId(page, 'menu-back');

  await tapTestId(page, 'dock-skills');
  await waitScreen(page, 'skills');
  await screen(page, findings, 'skills', MENU);
  await page.locator('.skill-node').first().tap();
  await expect(page.getByTestId('skill-learn')).toBeVisible();
  await tapTestId(page, 'skill-learn');
  await screen(page, findings, 'skill-node', MODAL);
  await page.locator('.modal-panel .btn', { hasText: 'Close' }).tap();
  await tapTestId(page, 'menu-back');

  await tapTestId(page, 'dock-quests');
  await waitScreen(page, 'quests');
  await screen(page, findings, 'journal-late', MENU);
  await tapTestId(page, 'menu-back');

  await tapTestId(page, 'dock-settings');
  await waitScreen(page, 'settings');
  await screen(page, findings, 'settings', MENU);
  await tapTestId(page, 'menu-back');

  await tapTestId(page, 'mode-adventure');
  await waitScreen(page, 'map');
  for (const ch of [1, 2, 3]) {
    await tapTestId(page, `chapter-${ch}`);
    await expect(page.locator('.menu-title')).toContainText(`Chapter ${ch}`);
    await screen(page, findings, `map-ch${ch}-cleared`, MENU);
  }
  await tapTestId(page, 'menu-back');

  for (const mode of ['tower', 'challenge', 'arena', 'dungeon'] as const) {
    await tapTestId(page, `mode-${mode}`);
    await waitScreen(page, mode);
    await screen(page, findings, mode, MENU);
    if (mode !== 'dungeon') await tapTestId(page, 'menu-back');
  }

  // ---- Dungeon: clear the first room to reach the interlude
  await tapTestId(page, 'dungeon-start');
  await waitScreen(page, 'battle');
  await hook(page, 'setGod', true);
  const t0 = Date.now();
  while ((await state(page)).screen === 'battle' && Date.now() - t0 < 150_000) {
    await hook(page, 'skipCountdown');
    await hook(page, 'killAll');
    await page.waitForTimeout(600);
  }
  await waitScreen(page, 'interlude', 30_000);
  await screen(page, findings, 'dungeon-interlude', REWARD);
}
