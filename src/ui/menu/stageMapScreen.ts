import { BOSSES } from '../../data/bosses';
import { DIFFICULTIES, type DifficultyId } from '../../data/difficulty';
import { ENEMIES, type EnemyId } from '../../data/enemies';
import { HEROES } from '../../data/heroes';
import { DROP_TABLES, STAR_GEMS } from '../../data/progression';
import { AFFIXES, affixLabel } from '../../data/affixes';
import { chapterDef, isGeneratedChapter, MAX_CHAPTER } from '../../data/adventure';
import { ENDLESS_CONFIG } from '../../data/endless';
import type { AdventureStageDef, StageDef } from '../../data/stages';
import { computeHeroStats, powerRating } from '../../progression/heroStats';
import { DIFFICULTY_ORDER } from '../../progression/PlayerProfile';
import { el } from '../dom';
import { amount, icon, iconSpan } from '../icons';
import type { MenuContext } from './context';
import { fmtInt, fmtTime } from './View';

/** Power a hero of the stage's level with matching common gear would have (difficulty-scaled). */
export function recommendedPower(level: number, difficulty: DifficultyId): number {
  // Heroes run a couple of levels behind the stage on first clears; gear makes up the rest.
  const base = powerRating(computeHeroStats(HEROES.kael, Math.max(1, level - 2), [], null));
  const d = DIFFICULTIES[difficulty];
  return Math.round(base * 0.92 * (1 + (level - 1) * 0.04) * Math.sqrt(d.enemyHp * d.enemyDamage));
}

export function stageEnemies(stage: StageDef): string[] {
  const ids = new Set<EnemyId>();
  for (const w of stage.waves) for (const s of w.spawns) ids.add(s.enemy);
  const names = [...ids].map((id) => ENEMIES[id].name);
  if (stage.boss !== null) names.push(BOSSES[stage.boss].name);
  return names;
}

/** Chapter tabs shown at once when there are many chapters. */
const TAB_WINDOW = 5;

/** Stages seen open on the map this session: newly opened ones play an unlock animation. */
const seenOpen = new Set<string>();
let mapSeeded = false;

/** The Endless Adventure line under the tabs: what lies past the hand-made chapters, or why a
 * previewed chapter is still closed. */
function endlessBanner(n: number, frontier: number): HTMLElement | null {
  const first = ENDLESS_CONFIG.firstChapter;
  if (n > frontier) {
    const b = el('div', 'endless-banner is-locked');
    b.append(
      iconSpan('endless-mark', 'lock'),
      el('span', '', `Defeat the Chapter ${frontier} boss to open Chapter ${frontier + 1}`),
    );
    b.dataset['testid'] = 'chapter-locked';
    return b;
  }
  if (n < first - 1) return null;
  const b = el('div', 'endless-banner');
  b.append(
    el('span', 'endless-mark', '∞'),
    el(
      'span',
      '',
      isGeneratedChapter(n)
        ? `Endless Adventure · Chapter ${n} of ${MAX_CHAPTER} · a new boss and affixes every chapter`
        : `Endless Adventure starts at Chapter ${first}: ${MAX_CHAPTER - first + 1} chapters of new bosses and affixes`,
    ),
  );
  b.dataset['testid'] = 'endless-banner';
  return b;
}

function starsText(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(3 - n);
}

/** Adventure stage map: chapter tabs, difficulty, 8 stage nodes, pre-battle panel. */
export function renderStageMap(ctx: MenuContext, chapterNumber: number): void {
  const p = ctx.profile;
  const frontier = p.adventureFrontier();
  // Chapters reached, plus a look ahead at the next ones (locked) so the endless chapters past
  // the hand-made four are always in sight.
  const last = Math.min(MAX_CHAPTER, Math.max(ENDLESS_CONFIG.firstChapter + 1, frontier + 2));
  const chapter = chapterDef(Math.min(chapterNumber, last)) ?? chapterDef(1);
  if (chapter === undefined) return;
  const v = ctx.shell.begin(
    `Chapter ${chapter.number} · ${chapter.name}`,
    () => ctx.nav.hub(),
    'map',
  );
  let difficulty = p.data.difficulty;
  if (!p.difficultyUnlocked(chapter.number, difficulty)) difficulty = 'normal';

  const top = el('div', 'map-top');
  const tabs = el('div', 'tabs');
  const go = (n: number): void => {
    ctx.uiTap();
    ctx.nav.stageMap(n);
  };
  // Many chapters: a window of tabs around the selected one with first / previous / next /
  // latest steps. Locked chapters open as a preview (their stages stay locked).
  const sel = chapter.number;
  const windowed = last > TAB_WINDOW + 1;
  const from = windowed ? Math.max(1, Math.min(sel - 2, last - TAB_WINDOW + 1)) : 1;
  const to = windowed ? Math.min(last, from + TAB_WINDOW - 1) : last;
  const step = (label: string, target: number, testid: string, enabled: boolean): void => {
    tabs.append(v.button(label, 'tab tab-step', () => go(target), { disabled: !enabled, testid }));
  };
  if (windowed) {
    step('«', 1, 'chapter-first', sel > 1);
    step('‹', sel - 1, 'chapter-prev', sel > 1);
  }
  for (let n = from; n <= to; n++) {
    tabs.append(
      v.button(
        `${n}`,
        `tab${n === sel ? ' is-selected' : ''}${n > frontier ? ' is-locked' : ''}${isGeneratedChapter(n) ? ' is-endless' : ''}`,
        () => go(n),
        { testid: `chapter-${n}` },
      ),
    );
  }
  if (windowed) {
    step('›', sel + 1, 'chapter-next', sel < last);
    step('»', frontier, 'chapter-latest', sel !== frontier);
  }
  const diffs = el('div', 'segmented');
  for (const d of DIFFICULTY_ORDER) {
    const open = p.difficultyUnlocked(chapter.number, d);
    diffs.append(
      v.button(
        DIFFICULTIES[d].label,
        `segment${d === difficulty ? ' is-selected' : ''}`,
        () => {
          ctx.uiTap();
          p.data.difficulty = d;
          p.commit();
          renderStageMap(ctx, chapter.number);
        },
        { disabled: !open, testid: `difficulty-${d}` },
      ),
    );
  }
  const total = el(
    'div',
    'map-stars',
    `★ ${p.totalStars(chapter.number, difficulty)} / ${chapter.stages.length * 3}`,
  );
  top.append(tabs, total, diffs);
  const banner = endlessBanner(chapter.number, frontier);
  if (banner !== null) top.append(banner);

  const path = el('div', 'map-path');
  const n = chapter.stages.length;
  const points: string[] = [];
  const donePoints: string[] = [];
  let unlocked = 0;
  let cleared = 0;
  chapter.stages.forEach((s, i) => {
    const x = 7 + (i * 86) / Math.max(1, n - 1);
    const y = i % 2 === 0 ? 34 : 68;
    points.push(`${x},${y}`);
    const open = p.stageUnlocked(s, difficulty);
    const rec = p.record(s.id, difficulty);
    if (open) donePoints.push(`${x},${y}`);
    if (rec !== undefined) cleared++;
    const isNext = open && rec === undefined;
    const key = `${s.id}:${difficulty}`;
    const fresh = open && mapSeeded && !seenOpen.has(key);
    if (open) seenOpen.add(key);
    if (fresh) unlocked++;
    const node = v.button(
      '',
      `stage-node kind-${s.kind}${open ? '' : ' is-locked'}${rec !== undefined ? ' is-cleared' : ''}${isNext ? ' is-next' : ''}${fresh ? ' is-unlocking' : ''}`,
      () => {
        ctx.uiTap();
        if (!open) {
          ctx.toast('Clear the previous stage first');
          return;
        }
        openPreBattle(ctx, s, difficulty);
      },
      { testid: `stage-${s.id}` },
    );
    node.style.left = `${x}%`;
    node.style.top = `${y}%`;
    node.append(
      el('span', 'stage-num', `${s.chapter}-${s.index + 1}`),
      open
        ? el('span', 'stage-stars', starsText(rec?.bestStars ?? 0))
        : iconSpan('stage-stars', 'lock'),
    );
    if (s.kind !== 'normal')
      node.append(el('span', 'stage-kind', s.kind === 'boss' ? 'BOSS' : 'ELITE'));
    path.append(node);
  });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'map-line');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  line.setAttribute('points', points.join(' '));
  svg.append(line);
  // The road travelled so far, in gold.
  if (donePoints.length > 1) {
    const done = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    done.setAttribute('points', donePoints.join(' '));
    done.setAttribute('class', 'map-line-done');
    svg.append(done);
  }
  path.prepend(svg);
  const progress = el('div', 'map-progress');
  const bar = el('div', 'map-progress-bar');
  const fill = el('div', 'map-progress-fill');
  fill.style.transform = `scaleX(${n > 0 ? cleared / n : 0})`;
  bar.append(fill);
  progress.append(el('span', '', `${chapter.subtitle} · ${cleared}/${n} cleared`), bar);
  const page = el('div', 'map');
  page.append(top, progress, path);
  v.root.append(page);
  mapSeeded = true;
  if (unlocked > 0) ctx.stingers.play('unlock', 0, 0.7);
}

/** Elite affix lines for the pre-battle panel (names, then what each does). */
function affixLines(stage: StageDef): HTMLElement[] {
  const out: HTMLElement[] = [];
  const ids = [...new Set([...(stage.affixes ?? []), ...(stage.bossAffixes ?? [])])];
  if (ids.length === 0) return out;
  if ((stage.affixes ?? []).length > 0)
    out.push(el('div', 'pb-text pb-affix', `Elite foes: ${affixLabel(stage.affixes)}`));
  if ((stage.bossAffixes ?? []).length > 0)
    out.push(el('div', 'pb-text pb-affix', `Boss: ${affixLabel(stage.bossAffixes)}`));
  out.push(el('div', 'pb-text pb-dim', ids.map((id) => AFFIXES[id].text).join(' · ')));
  return out;
}

function openPreBattle(ctx: MenuContext, stage: AdventureStageDef, difficulty: DifficultyId): void {
  const p = ctx.profile;
  const m = ctx.shell.openModal('prebattle');
  const heroId = p.selectedHero;
  const hero = HEROES[heroId];
  const power = p.power(heroId);
  const rec = recommendedPower(stage.level, difficulty);
  const best = p.record(stage.id, difficulty);
  const d = DIFFICULTIES[difficulty];
  const table = DROP_TABLES[stage.drops];
  const prevStars = best?.bestStars ?? 0;
  let starGems = 0;
  for (let s = prevStars + 1; s <= 3; s++) starGems += STAR_GEMS[s] ?? 0;
  starGems = Math.round(starGems * d.rewards);

  const head = el('div', 'pb-head');
  head.append(
    el('div', 'pb-title', `${stage.chapter}-${stage.index + 1} · ${stage.name}`),
    el('div', 'pb-sub', `Enemy level ${stage.level} · ${d.label}`),
  );
  const cols = el('div', 'pb-cols');
  const left = el('div', 'pb-col');
  left.append(
    el('div', 'pb-label', 'Foes'),
    el('div', 'pb-text', stageEnemies(stage).join(', ')),
    ...affixLines(stage),
    el('div', 'pb-label', 'Rewards'),
    rewardRow(
      Math.round(stage.rewards.gold * d.rewards),
      Math.round(stage.rewards.xp * d.rewards),
      `${table.items}${table.bonusItemChance > 0 ? '+' : ''}`,
      stage.rewards.gems !== undefined && best === undefined ? stage.rewards.gems : 0,
    ),
    el(
      'div',
      'pb-text pb-dim',
      starGems > 0 ? `Star rewards left: ${starGems} gems` : 'All star rewards claimed',
    ),
    el('div', 'pb-label', 'Stars'),
    el(
      'div',
      'pb-text pb-dim',
      `★ clear · ★ no revive, little damage · ★ under ${fmtTime(stage.stars.parTimeSec)}`,
    ),
  );
  const right = el('div', 'pb-col');
  const powerLine = el('div', `pb-power${power >= rec ? ' is-good' : ' is-low'}`);
  powerLine.append(
    el('span', '', `Your power ${fmtInt(power)}`),
    el('span', 'pb-dim', ` / recommended ${fmtInt(rec)}`),
  );
  const blessing = p.blessing(stage.id, difficulty);
  right.append(
    el('div', 'pb-label', 'Hero'),
    el('div', 'pb-text', `${hero.name} · Level ${p.hero(heroId).level}`),
    powerLine,
  );
  if (blessing.stacks > 0)
    right.append(
      el(
        'div',
        'pb-text pb-blessing',
        `Ember Blessing ${'✦'.repeat(blessing.stacks)} +${Math.round((blessing.atkMult - 1) * 100)}% ATK · +${Math.round((blessing.hpMult - 1) * 100)}% HP`,
      ),
    );
  right.append(
    el('div', 'pb-label', 'Best'),
    el(
      'div',
      'pb-text',
      best === undefined
        ? 'Not cleared'
        : `${starsText(best.bestStars)}  ${fmtTime(best.bestTimeSec)}`,
    ),
  );
  cols.append(left, right);
  const row = el('div', 'button-row');
  row.append(
    m.button('Close', 'btn', () => {
      ctx.uiTap();
      ctx.shell.closeModal();
    }),
    m.button('Hero', 'btn', () => {
      ctx.uiTap();
      ctx.nav.heroes();
    }),
    m.button(
      'Fight',
      'btn btn-primary',
      () => {
        ctx.uiTap();
        ctx.shell.closeModal();
        ctx.actions.startAdventure(stage.id, difficulty);
      },
      { testid: 'prebattle-start' },
    ),
  );
  m.root.append(head, cols, row);
}

/** Stage rewards as icons: gold, XP, gear count, first-clear gems. */
function rewardRow(gold: number, xp: number, gear: string, gems: number): HTMLElement {
  const row = el('div', 'pb-text pb-rewards');
  row.append(amount('gold', fmtInt(gold)));
  const x = el('span', 'amount amount-xp');
  x.append(icon('star'), document.createTextNode(`${fmtInt(xp)} XP`));
  const g = el('span', 'amount amount-gear');
  g.append(icon('weapon'), document.createTextNode(`${gear} gear`));
  row.append(x, g);
  if (gems > 0) row.append(amount('gems', String(gems)));
  return row;
}
