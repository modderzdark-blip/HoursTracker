import { HEROES } from '../../data/heroes';
import { RARITY_DEFS } from '../../data/items';
import { HERO_LINES } from '../../data/story';
import type { RewardSummary } from '../../modes/rewards';
import { celebrationsFor, planReveal, xpSegments, type RevealStep } from '../../progression/feel';
import { formatStat, itemName, mainValue } from '../../progression/gear';
import type { Attention } from '../../progression/PlayerProfile';
import { iconBox } from '../icons';
import { el } from '../dom';
import { playCelebrations } from './celebrate';
import type { MenuContext } from './context';
import { fmtInt, fmtTime, type View } from './View';

export interface ResultButton {
  readonly label: string;
  readonly primary?: boolean;
  readonly testid: string;
  readonly run: () => void;
}

/** Duration of the currency count-up. */
const COUNT_MS = 900;
/** Duration of one XP-bar segment fill. */
const XP_FILL_MS = 560;

function buttonRow(ctx: MenuContext, v: View, buttons: readonly ResultButton[]): HTMLElement {
  const row = el('div', 'button-row');
  for (const b of buttons) {
    row.append(
      v.button(
        b.label,
        b.primary === true ? 'btn btn-primary' : 'btn',
        () => {
          ctx.uiTap();
          b.run();
        },
        { testid: b.testid },
      ),
    );
  }
  return row;
}

/**
 * Victory screen, revealed as a sequence: stars stamp in one by one, gold / XP counters tick
 * up, the XP bar fills (bursting into LEVEL UP with the stats gained), loot cards flip one by
 * one with rarity beams, then the first-clear badge — followed by full-screen celebrations
 * for a completed chapter, a new hero or a new mode. The buttons work from the first frame;
 * tapping anywhere else jumps to the end.
 */
export function renderVictory(
  ctx: MenuContext,
  r: RewardSummary,
  buttons: readonly ResultButton[],
): void {
  const v = ctx.shell.begin('', null, 'victory');
  const wrap = el('div', 'reward reward-victory');
  const timers: number[] = [];
  let raf = 0;
  let finished = false;

  // ---- head: title, hero line, stars
  const head = el('div', 'reward-head');
  const title = el('h2', 'reward-title reward-shine', r.title);
  const stars = el('div', 'result-stars');
  const starEls: HTMLElement[] = [];
  for (let i = 0; i < 3; i++) {
    const s = el('span', 'star', '★');
    starEls.push(s);
    stars.append(s);
  }
  const hero = HEROES[r.heroId];
  head.append(title, stars, el('div', 'reward-sub', r.subtitle));
  const quote = el('div', 'reward-quote', `${hero.name}: “${HERO_LINES[r.heroId].victory}”`);

  // ---- currencies (count up)
  const cur = el('div', 'reward-row');
  const counters: { node: HTMLElement; to: number; fmt: (n: number) => string }[] = [];
  const chip = (to: number, cls: string, fmt: (n: number) => string): void => {
    const node = el('span', `loot ${cls}`, fmt(0));
    counters.push({ node, to, fmt });
    cur.append(node);
  };
  chip(r.gold, 'loot-gold', (n) => `+${fmtInt(n)} gold`);
  if (r.gems > 0) chip(r.gems, 'loot-gems', (n) => `+${Math.round(n)} gems`);
  if (r.souls > 0) chip(r.souls, 'loot-souls', (n) => `+${Math.round(n)} souls`);
  if (r.materials > 0) chip(r.materials, 'loot-mat', (n) => `+${Math.round(n)} materials`);
  if (r.tickets > 0)
    chip(r.tickets, 'loot-ticket', (n) => `+${Math.round(n)} ticket${r.tickets > 1 ? 's' : ''}`);

  // ---- XP bar
  const segments = r.xp > 0 ? xpSegments(r.levelBefore, r.xpBefore, r.heroLevel, r.xpAfter) : [];
  const xp = el('div', `reward-xp${r.levelsGained > 0 ? ' is-levelup' : ''}`);
  const xpLevel = el('span', 'xpr-level', `Lv ${r.levelBefore}`);
  const xpBar = el('div', 'xpr-bar');
  const xpFill = el('div', 'xpr-fill');
  const xpBurst = el('div', 'xpr-burst', 'LEVEL UP!');
  xpBar.append(xpFill, xpBurst);
  const xpGain = el('span', 'xpr-gain', `${hero.name} +${fmtInt(r.xp)} XP`);
  xp.append(xpLevel, xpBar, xpGain);
  const first = segments[0];
  xpFill.style.transform = `scaleX(${first?.from ?? 1})`;
  let gains: HTMLElement | null = null;
  if (r.levelsGained > 0) {
    const a = r.statsBefore;
    const b = r.statsAfter;
    const parts = [
      `HP +${fmtInt(b.maxHp - a.maxHp)}`,
      `ATK +${fmtInt(b.atk - a.atk)}`,
      `DEF +${fmtInt(b.def - a.def)}`,
    ];
    gains = el('div', 'xpr-gains');
    gains.append(
      el('span', '', `LEVEL ${r.heroLevel} · ${parts.join(' · ')} · Power `),
      el('span', 'xpr-power', `${fmtInt(a.power)} → ${fmtInt(b.power)} ▲`),
    );
  }

  // ---- loot
  const loot = el('div', 'loot-cards');
  const cards: HTMLElement[] = [];
  for (const item of r.items) {
    const d = RARITY_DEFS[item.rarity];
    const card = el('div', `loot-card rarity-${item.rarity} is-pending`);
    card.style.setProperty('--rarity', d.color);
    const name = el('div', 'loot-card-name', itemName(item));
    name.style.color = d.color;
    card.append(
      el('div', 'loot-beam'),
      iconBox('loot-card-glyph', item.slot, item.rarity),
      name,
      el('div', 'loot-card-meta', `${d.label} · Lv${item.ilvl}`),
      el('div', 'loot-card-stat', formatStat(item.main.stat, mainValue(item))),
    );
    cards.push(card);
    loot.append(card);
  }
  if (r.autoSalvaged.count > 0) {
    loot.append(
      el(
        'div',
        'loot-note',
        `Bag full: ${r.autoSalvaged.count} item(s) salvaged for ${r.autoSalvaged.materials} materials`,
      ),
    );
  }
  const time = el('div', 'reward-time', `Time ${fmtTime(r.timeSec)}`);
  const badge = el('div', 'reward-badge is-pending', '✦ First clear ✦');
  const unlocks = el('div', 'reward-unlocks');
  for (const u of r.unlocks) unlocks.append(el('div', 'unlock', `✦ ${u}`));

  const row = buttonRow(ctx, v, buttons);
  const body: HTMLElement[] = [head, quote, cur, xp];
  if (gains !== null) body.push(gains);
  body.push(time);
  if (r.firstClear) body.push(badge);
  body.push(loot, unlocks, row);
  wrap.append(...body);
  v.root.append(wrap);
  ctx.shell.refreshCurrencies();

  // ---- the sequence
  const st = ctx.stingers;
  let level = r.levelBefore;
  const runCounters = (instant: boolean): void => {
    cancelAnimationFrame(raf);
    if (instant) {
      for (const c of counters) c.node.textContent = c.fmt(c.to);
      return;
    }
    const t0 = performance.now();
    let ticks = 0;
    const step = (now: number): void => {
      const k = Math.min(1, (now - t0) / COUNT_MS);
      const e = 1 - Math.pow(1 - k, 3);
      for (const c of counters) c.node.textContent = c.fmt(Math.round(c.to * e));
      if (ticks++ % 4 === 0 && k < 1) st.play('coin', ticks % 8, 0.6);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };
  const apply = (s: RevealStep, instant: boolean): void => {
    switch (s.kind) {
      case 'star': {
        const star = starEls[s.index];
        if (star === undefined || !s.highlight) return;
        star.classList.add('is-on');
        if (!instant) {
          star.classList.add('is-stamp');
          st.play('star', s.index);
        }
        if (s.index >= r.previousStars) star.classList.add('is-new');
        return;
      }
      case 'counters':
        runCounters(instant);
        return;
      case 'xp': {
        const seg = segments[s.index];
        if (seg === undefined) return;
        xpFill.style.transition = 'none';
        xpFill.style.transform = `scaleX(${seg.from})`;
        if (!instant) void xpFill.offsetWidth;
        xpFill.style.transition = instant ? 'none' : `transform ${XP_FILL_MS}ms ease-out`;
        xpFill.style.transform = `scaleX(${seg.to})`;
        return;
      }
      case 'levelUp':
        level++;
        xpLevel.textContent = `Lv ${level}`;
        if (!instant) {
          xp.classList.remove('is-bursting');
          void xp.offsetWidth;
          xp.classList.add('is-bursting');
          st.play('levelUp');
        }
        gains?.classList.add('is-shown');
        return;
      case 'loot': {
        const card = cards[s.index];
        const item = r.items[s.index];
        if (card === undefined || item === undefined) return;
        card.classList.remove('is-pending');
        card.classList.add(instant ? 'is-shown' : 'is-revealed');
        if (!instant) st.loot(item.rarity);
        return;
      }
      case 'firstClear':
        badge.classList.remove('is-pending');
        badge.classList.add(instant ? 'is-shown' : 'is-revealed');
        if (!instant) st.play('goal');
        return;
      case 'done':
        finish();
        return;
    }
  };
  const plan = planReveal({
    stars: r.stars,
    previousStars: r.previousStars,
    showStars: true,
    xpSegments: segments,
    loot: r.items.map((i) => i.rarity),
    firstClear: r.firstClear,
  });
  let next = 0;
  for (const s of plan) {
    timers.push(
      window.setTimeout(() => {
        next = plan.indexOf(s) + 1;
        apply(s, false);
      }, s.atMs),
    );
  }
  const celebrations = celebrationsFor(r.unlockEvents, r.chapterComplete);
  function finish(): void {
    if (finished) return;
    finished = true;
    xp.classList.add('is-done');
    if (celebrations.length > 0)
      timers.push(window.setTimeout(() => playCelebrations(ctx, celebrations), 500));
  }
  // Tap anywhere but a button: jump to the end of the reveal.
  v.tap(wrap, () => {
    if (finished) return;
    for (const t of timers) window.clearTimeout(t);
    timers.length = 0;
    // Level-ups count through every step; the rest only needs its final state.
    for (let i = next; i < plan.length; i++) {
      const s = plan[i];
      if (s !== undefined) apply(s, true);
    }
  });
  wrap.removeAttribute('role');
  v.onDispose(() => {
    for (const t of timers) window.clearTimeout(t);
    cancelAnimationFrame(raf);
  });
}

/** Combat tips shown on the defeat screen (Settings → Gameplay → Defeat tips). */
export const DEFEAT_TIPS: readonly string[] = [
  'Stronger gear, levels and skills turn the tide. Try again.',
  'Dodge just as a hit lands for a perfect dodge: time slows and your next attack counters.',
  'Glowing marks on the ground show where an attack will land — step out before they fill.',
  'Hits drain a boss’s break bar. Empty it and the boss is stunned and takes extra damage.',
  'Your ultimate charges as you fight. Save it for a stunned boss or a crowded wave.',
  'Upgrade gear on the Gear screen: every + level raises its stats.',
  'Spend skill points in the skill tree — some nodes make your combo or skills hit harder.',
];

/** Deterministic tip for a seed (e.g. the number of defeats so far). */
export function defeatTip(seed: number): string {
  const n = DEFEAT_TIPS.length;
  const i = ((Math.floor(seed) % n) + n) % n;
  return DEFEAT_TIPS[i] ?? DEFEAT_TIPS[0] ?? '';
}

/** One "grow stronger" suggestion on the defeat screen. */
export interface GrowthAdvice {
  readonly id: 'gear' | 'skills' | 'heroes' | 'level';
  readonly text: string;
}

/**
 * What the player can do right now to win next time, most useful first: better or upgradable
 * gear, skill ranks, a hero to summon, or (when nothing is pending) levelling up elsewhere.
 */
export function growthAdvice(
  a: Attention,
  power: number,
  recommended: number | null,
): GrowthAdvice[] {
  const out: GrowthAdvice[] = [];
  if (a.gearUpgrade || a.newItems > 0)
    out.push({ id: 'gear', text: 'Equip or upgrade gear — a stronger piece is ready' });
  if (a.skills > 0)
    out.push({
      id: 'skills',
      text: `Rank up ${a.skills} skill${a.skills > 1 ? 's' : ''} in the skill tree`,
    });
  if (a.heroes > 0) out.push({ id: 'heroes', text: 'A new hero can be summoned' });
  if (out.length === 0 && recommended !== null && power < recommended)
    out.push({
      id: 'level',
      text: `Power ${fmtInt(power)} of ${fmtInt(recommended)} recommended — replay earlier stages for XP and gear`,
    });
  return out;
}

export interface DefeatExtras {
  /** The boss that won, and what it says. */
  readonly bossLine?: { readonly name: string; readonly line: string };
  /** Recommended power for the stage (for the advice). */
  readonly recommended?: number;
}

let defeatsShown = 0;

/** Short summary screen: a defeat, or an interlude (dungeon room cleared, dungeon left). */
export function renderDefeat(
  ctx: MenuContext,
  subtitle: string,
  buttons: readonly ResultButton[],
  title = 'Defeat',
  extras: DefeatExtras = {},
): void {
  const isDefeat = title === 'Defeat';
  const v = ctx.shell.begin('', null, isDefeat ? 'defeat' : 'interlude');
  const wrap = el('div', `reward${isDefeat ? ' reward-defeat' : ''}`);
  wrap.append(
    el(
      'h2',
      `reward-title${isDefeat ? ' result-defeat' : ''}`,
      isDefeat ? 'You have fallen' : title,
    ),
    el('div', 'reward-sub', subtitle),
  );
  if (isDefeat) {
    const p = ctx.profile;
    const heroId = p.selectedHero;
    if (extras.bossLine !== undefined)
      wrap.append(
        el('div', 'reward-quote is-foe', `${extras.bossLine.name}: “${extras.bossLine.line}”`),
      );
    wrap.append(
      el('div', 'reward-quote', `${HEROES[heroId].name}: “${HERO_LINES[heroId].defeat}”`),
    );
    const advice = growthAdvice(p.attention(), p.power(heroId), extras.recommended ?? null);
    if (advice.length > 0) {
      const list = el('div', 'advice');
      list.append(el('div', 'advice-head', 'Grow stronger'));
      for (const a of advice) {
        const item = v.button(
          `${a.text} ›`,
          'advice-item',
          () => {
            ctx.uiTap();
            if (a.id === 'gear') ctx.nav.gear(null);
            else if (a.id === 'skills') ctx.nav.skills();
            else if (a.id === 'heroes') ctx.nav.heroes();
            else ctx.nav.stageMap();
          },
          { testid: `advice-${a.id}` },
        );
        list.append(item);
      }
      wrap.append(list);
    }
    ctx.stingers.play('defeat', 0, 0.8);
  }
  if (isDefeat && ctx.settings.settings.showDefeatTips) {
    const tip = el('div', 'reward-time reward-tip', defeatTip(defeatsShown++));
    tip.dataset['testid'] = 'defeat-tip';
    wrap.append(tip);
  }
  wrap.append(buttonRow(ctx, v, buttons));
  v.root.append(wrap);
}
