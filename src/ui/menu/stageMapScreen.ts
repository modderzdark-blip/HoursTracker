import { BOSSES } from '../../data/bosses';
import { DIFFICULTIES, type DifficultyId } from '../../data/difficulty';
import { ENEMIES, type EnemyId } from '../../data/enemies';
import { HEROES } from '../../data/heroes';
import { DROP_TABLES, STAR_GEMS } from '../../data/progression';
import { CHAPTERS, type AdventureStageDef, type StageDef } from '../../data/stages';
import { computeHeroStats, powerRating } from '../../progression/heroStats';
import { DIFFICULTY_ORDER } from '../../progression/PlayerProfile';
import { el } from '../dom';
import type { MenuContext } from './context';
import { fmtInt, fmtTime } from './View';

/** Power a hero of the stage's level with matching common gear would have (difficulty-scaled). */
export function recommendedPower(level: number, difficulty: DifficultyId): number {
  const base = powerRating(computeHeroStats(HEROES.kael, level, [], null));
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

function starsText(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(3 - n);
}

/** Adventure stage map: chapter tabs, difficulty, 8 stage nodes, pre-battle panel. */
export function renderStageMap(ctx: MenuContext, chapterNumber: number): void {
  const p = ctx.profile;
  const chapter = CHAPTERS.find((c) => c.number === chapterNumber) ?? CHAPTERS[0];
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
  for (const c of CHAPTERS) {
    const open = c.number === 1 || p.stageUnlocked(c.stages[0] as AdventureStageDef, 'normal');
    tabs.append(
      v.button(
        `${c.number}`,
        `tab${c.number === chapter.number ? ' is-selected' : ''}`,
        () => {
          ctx.uiTap();
          ctx.nav.stageMap(c.number);
        },
        { disabled: !open, testid: `chapter-${c.number}` },
      ),
    );
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
  top.append(tabs, el('div', 'map-sub', chapter.subtitle), total, diffs);

  const path = el('div', 'map-path');
  const n = chapter.stages.length;
  const points: string[] = [];
  chapter.stages.forEach((s, i) => {
    const x = 7 + (i * 86) / Math.max(1, n - 1);
    const y = i % 2 === 0 ? 34 : 68;
    points.push(`${x},${y}`);
    const open = p.stageUnlocked(s, difficulty);
    const rec = p.record(s.id, difficulty);
    const node = v.button(
      '',
      `stage-node kind-${s.kind}${open ? '' : ' is-locked'}${rec !== undefined ? ' is-cleared' : ''}`,
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
      el('span', 'stage-stars', open ? starsText(rec?.bestStars ?? 0) : '🔒'),
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
  path.prepend(svg);
  v.root.append(top, path);
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
    el('div', 'pb-label', 'Rewards'),
    el(
      'div',
      'pb-text',
      `${fmtInt(Math.round(stage.rewards.gold * d.rewards))} gold · ${fmtInt(Math.round(stage.rewards.xp * d.rewards))} XP · ${table.items}${table.bonusItemChance > 0 ? '+' : ''} gear`,
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
  right.append(
    el('div', 'pb-label', 'Hero'),
    el('div', 'pb-text', `${hero.name} · Level ${p.hero(heroId).level}`),
    powerLine,
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
