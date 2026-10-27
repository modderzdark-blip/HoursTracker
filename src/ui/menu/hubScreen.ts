import { chapterDef, isGeneratedChapter, MAX_CHAPTER } from '../../data/adventure';
import { ENDLESS_CONFIG } from '../../data/endless';
import { HEROES, type HeroId } from '../../data/heroes';
import { MODE_ORDER, MODES, type ModeId } from '../../data/modes';
import { HEARTH_CONFIG } from '../../data/goals';
import { chapterProgress } from '../../progression/feel';
import { xpToNext } from '../../progression/xp';
import { el } from '../dom';
import { icon, type IconName } from '../icons';
import type { MenuContext } from './context';
import { fmtInt } from './View';

const MODE_ICONS: Readonly<Record<ModeId, IconName>> = {
  adventure: 'sword',
  dungeon: 'dungeon',
  challenge: 'crown',
  hunts: 'claw',
  arena: 'arena',
  tower: 'tower',
};

/**
 * Main hub: the hero in 3D behind, hero summary with quick hero switching (left), the Adventure
 * card with the next stage and the endless chapters, a grid of the other modes (right), the
 * Ember Hearth and the menu dock.
 */
export function renderHub(ctx: MenuContext): void {
  const v = ctx.shell.begin('', null, 'hub');
  const p = ctx.profile;
  const id = p.selectedHero;
  const def = HEROES[id];
  const h = p.hero(id);

  const hub = el('div', 'hub');
  const info = el('div', 'hub-hero');
  const need = xpToNext(h.level);
  const xpBar = el('div', 'xp-bar');
  const xpFill = el('div', 'xp-fill');
  xpFill.style.width = need > 0 ? `${Math.min(100, (h.xp / need) * 100).toFixed(1)}%` : '100%';
  xpBar.append(xpFill);
  // Quick switch between unlocked heroes (the 3D preview follows).
  const owned = (Object.keys(HEROES) as HeroId[]).filter((k) => p.hero(k).unlocked);
  const nameRow = el('div', 'hub-hero-namerow');
  const cycle = (dir: number): void => {
    ctx.uiTap();
    const i = owned.indexOf(id);
    const nextId = owned[(i + dir + owned.length) % owned.length];
    if (nextId === undefined || nextId === id) return;
    p.selectHero(nextId);
    ctx.onHeroChanged(nextId);
    ctx.nav.hub();
  };
  if (owned.length > 1)
    nameRow.append(v.button('‹', 'hero-cycle', () => cycle(-1), { testid: 'hub-hero-prev' }));
  nameRow.append(el('div', 'hub-hero-name', def.name));
  if (owned.length > 1)
    nameRow.append(v.button('›', 'hero-cycle', () => cycle(1), { testid: 'hub-hero-next' }));
  const level = el('div', 'hub-level');
  level.append(el('span', 'hub-level-num', String(h.level)), el('span', 'hub-level-tag', 'LV'));
  const power = el('div', 'hub-power');
  power.append(icon('bolt'), el('span', '', fmtInt(p.power(id))));
  const stats = el('div', 'hub-hero-stats');
  stats.append(level, power);
  info.append(nameRow, el('div', 'hub-hero-epithet', def.epithet), stats, xpBar);

  const attention = p.attention();
  const modes = el('div', 'hub-modes');
  modes.append(adventureCard(ctx, v, attention.newModes.includes('adventure')));
  const grid = el('div', 'hub-grid');
  for (const m of MODE_ORDER) {
    if (m === 'adventure') continue;
    const info2 = MODES[m];
    const open = p.modeUnlocked(m);
    const isNew = attention.newModes.includes(m);
    const b = v.button(
      '',
      `mode-btn mode-tile mode-${m}${open ? '' : ' is-locked'}${isNew ? ' is-new' : ''}`,
      () => {
        ctx.uiTap();
        if (open) ctx.nav.mode(m);
        else ctx.toast(`Locked — ${info2.requiresLabel}`);
      },
      { testid: `mode-${m}` },
    );
    const name = el('span', 'mode-name', info2.name);
    if (isNew) b.append(el('span', 'mode-new', 'NEW'));
    b.append(
      icon(open ? MODE_ICONS[m] : 'lock', 'mode-icon'),
      name,
      el('span', 'mode-sub', open ? info2.blurb : info2.requiresLabel),
    );
    grid.append(b);
  }
  grid.append(endlessTile(ctx, v));
  modes.append(grid);

  // Ember Hearth: rewards that build up while away.
  const y = p.hearth();
  const hearth = el('div', `hub-hearth${y.full ? ' is-full' : ''}`);
  const hh = Math.floor(y.minutes / 60);
  hearth.append(
    icon('flame', 'hearth-icon'),
    el('div', 'hearth-title', 'Ember Hearth'),
    el(
      'div',
      'hearth-line',
      y.minutes < HEARTH_CONFIG.minCollectMinutes
        ? 'Kindling… rewards build up over time'
        : `${hh > 0 ? `${hh}h ` : ''}${y.minutes % 60}m${y.full ? ' (full)' : ''} · ${fmtInt(y.gold)} gold · ${fmtInt(y.xp)} XP${y.materials > 0 ? ` · ${y.materials} mat.` : ''}`,
    ),
  );
  v.tap(hearth, () => {
    ctx.uiTap();
    const powerBefore = p.power(id);
    const got = p.collectHearth();
    if (got === null) {
      ctx.toast(`The hearth is still kindling (fills over ${HEARTH_CONFIG.capHours} h)`);
      return;
    }
    ctx.toast(
      `Hearth: +${fmtInt(got.gold)} gold, +${fmtInt(got.xp)} XP${got.materials > 0 ? `, +${got.materials} materials` : ''}${got.levelsGained > 0 ? ' — LEVEL UP!' : ''}`,
    );
    if (got.levelsGained > 0) {
      ctx.onHeroChanged(id);
      ctx.stingers.play('levelUp');
    }
    ctx.nav.hub();
    ctx.shell.showPower(powerBefore, p.power(id));
  });
  hearth.dataset['testid'] = 'hub-hearth';

  const newItems = p.data.items.filter((i) => i.isNew).length;
  const dock = el('div', 'hub-dock');
  const dockBtn = (
    label: string,
    glyph: IconName,
    testid: string,
    fn: () => void,
    badge = 0,
    dot = false,
  ): HTMLElement => {
    const b = v.button(
      '',
      'dock-btn',
      () => {
        ctx.uiTap();
        fn();
      },
      { testid },
    );
    b.append(icon(glyph, 'dock-icon'), el('span', 'dock-label', label));
    if (badge > 0) b.append(el('span', 'badge', String(badge)));
    else if (dot) b.append(el('span', 'dot-new'));
    return b;
  };
  dock.append(
    dockBtn('Heroes', 'helmet', 'dock-heroes', () => ctx.nav.heroes(), 0, attention.heroes > 0),
    dockBtn(
      'Gear',
      'shield',
      'dock-gear',
      () => ctx.nav.gear(null),
      newItems,
      attention.gearUpgrade,
    ),
    dockBtn('Skills', 'star', 'dock-skills', () => ctx.nav.skills(), 0, attention.skills > 0),
    dockBtn('Journal', 'book', 'dock-quests', () => ctx.nav.quests(), attention.journal),
    dockBtn('Settings', 'cog', 'dock-settings', () => ctx.nav.settings()),
  );
  hub.append(hearth, info, modes, dock);
  v.root.append(hub);
}

type HubView = ReturnType<MenuContext['shell']['begin']>;

/** The Adventure card: current chapter, the next stage to beat and the endless chapters ahead. */
function adventureCard(ctx: MenuContext, v: HubView, isNew: boolean): HTMLElement {
  const p = ctx.profile;
  const next = p.nextStage();
  const frontier = p.adventureFrontier();
  const b = v.button(
    '',
    `mode-btn mode-adventure adventure-card${isNew ? ' is-new' : ''}`,
    () => {
      ctx.uiTap();
      ctx.nav.mode('adventure');
    },
    { testid: 'mode-adventure' },
  );
  const chapterNo = next?.chapter ?? frontier;
  const chapter = chapterDef(chapterNo);
  const head = el('div', 'adv-head');
  head.append(
    el('span', 'mode-name', MODES.adventure.name),
    el(
      'span',
      `adv-chapter${isGeneratedChapter(chapterNo) ? ' is-endless' : ''}`,
      `Chapter ${chapterNo}${chapter === undefined ? '' : ` · ${chapter.name}`}`,
    ),
  );
  const body = el('div', 'adv-body');
  const text = el('div', 'adv-text');
  if (next !== null) {
    // The clear next goal: the stage to beat, and how far through its chapter you are.
    const prog = chapterProgress(next.chapter, (sid) => p.stageClearedAnyDifficulty(sid));
    const line = el('span', 'mode-next');
    const bar = el('span', 'mode-next-bar');
    const fill = el('span', 'mode-next-fill');
    fill.style.display = 'block';
    fill.style.transform = `scaleX(${prog.total > 0 ? prog.cleared / prog.total : 0})`;
    bar.append(fill);
    line.append(
      el('span', 'adv-stage', `${next.chapter}-${next.index + 1} · ${next.name}`),
      bar,
      el('span', 'adv-count', `${prog.cleared}/${prog.total}`),
    );
    line.dataset['testid'] = 'hub-next';
    text.append(line);
  } else {
    text.append(el('span', 'mode-next', `Every chapter cleared — all ${MAX_CHAPTER}`));
  }
  const first = ENDLESS_CONFIG.firstChapter;
  const endless = el('span', 'adv-endless');
  endless.append(
    icon('endless'),
    el(
      'span',
      '',
      frontier >= first
        ? `Endless · Chapter ${frontier} of ${MAX_CHAPTER}`
        : `Endless chapters ${first}–${MAX_CHAPTER} ahead`,
    ),
  );
  text.append(endless);
  const play = el('span', 'adv-play');
  play.append(icon('play'));
  body.append(text, play);
  b.append(head, body);
  return b;
}

/** Shortcut into the endless chapters: the deepest one reached, or a look at the first. */
function endlessTile(ctx: MenuContext, v: HubView): HTMLElement {
  const first = ENDLESS_CONFIG.firstChapter;
  const frontier = ctx.profile.adventureFrontier();
  const open = frontier >= first;
  const b = v.button(
    '',
    `mode-btn mode-tile mode-endless${open ? '' : ' is-preview'}`,
    () => {
      ctx.uiTap();
      ctx.nav.stageMap(Math.max(first, frontier));
    },
    { testid: 'hub-endless' },
  );
  b.append(
    icon('endless', 'mode-icon'),
    el('span', 'mode-name', 'Endless'),
    el(
      'span',
      'mode-sub',
      open ? `Chapter ${frontier} of ${MAX_CHAPTER}` : `Opens after Chapter ${first - 1}`,
    ),
  );
  return b;
}
