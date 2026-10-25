import { HEROES } from '../../data/heroes';
import { SKILL_TREES, type SkillNodeDef } from '../../data/skillTrees';
import { rankBlock, rankCost } from '../../progression/skillTree';
import { el } from '../dom';
import type { MenuContext } from './context';
import { fmtInt } from './View';

const COLS = 5;
const ROWS = 4;

const BLOCK_TEXT = {
  maxed: 'Fully learned',
  level: 'Hero level too low',
  requires: 'Learn the previous node first',
  souls: 'Not enough souls',
  gold: 'Not enough gold',
} as const;

/** Per-hero skill tree: skill power / haste / modifier branches plus a core branch. */
export function renderSkills(ctx: MenuContext): void {
  const p = ctx.profile;
  const heroId = p.selectedHero;
  const hero = HEROES[heroId];
  const nodes = SKILL_TREES[heroId];
  const h = p.hero(heroId);
  const v = ctx.shell.begin(`Skills · ${hero.name}`, () => ctx.nav.hub(), 'skills');

  const wrap = el('div', 'skills');
  const heads = el('div', 'skill-heads');
  for (const name of [
    hero.skills[0].name,
    hero.skills[1].name,
    hero.skills[2].name,
    'Core',
    'Guard',
  ]) {
    heads.append(el('div', 'skill-head', name));
  }
  const grid = el('div', 'skill-grid');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'skill-lines');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  const center = (n: SkillNodeDef): [number, number] => [
    ((n.col + 0.5) / COLS) * 100,
    ((n.row + 0.5) / ROWS) * 100,
  ];
  for (const n of nodes) {
    if (n.requires === null) continue;
    const req = nodes.find((r) => r.id === n.requires);
    if (req === undefined) continue;
    const [x1, y1] = center(req);
    const [x2, y2] = center(n);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(x1));
    line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(x2));
    line.setAttribute('y2', String(y2));
    if ((h.skills[req.id] ?? 0) > 0) line.setAttribute('class', 'is-on');
    svg.append(line);
  }
  grid.append(svg);
  for (const n of nodes) {
    const rank = h.skills[n.id] ?? 0;
    const block = rankBlock(n, h.skills, h.level, p.wallet);
    const state =
      rank >= n.maxRank
        ? 'is-maxed'
        : block === null
          ? 'is-ready'
          : block === 'souls' || block === 'gold'
            ? 'is-poor'
            : 'is-locked';
    const node = v.button(
      '',
      `skill-node ${state}${rank > 0 ? ' has-rank' : ''}`,
      () => {
        ctx.uiTap();
        openNode(ctx, n);
      },
      { testid: `skill-${n.id}` },
    );
    node.style.gridColumn = String(n.col + 1);
    node.style.gridRow = String(n.row + 1);
    node.append(
      el('span', 'skill-name', n.name.replace(/^.*: /, '')),
      el('span', 'skill-rank', `${rank}/${n.maxRank}`),
    );
    grid.append(node);
  }
  wrap.append(heads, grid);
  v.root.append(wrap);
}

function openNode(ctx: MenuContext, n: SkillNodeDef): void {
  const p = ctx.profile;
  const heroId = p.selectedHero;
  const h = p.hero(heroId);
  const rank = h.skills[n.id] ?? 0;
  const block = rankBlock(n, h.skills, h.level, p.wallet);
  const cost = rankCost(n, rank);
  const m = ctx.shell.openModal('skill-modal');
  const req = n.requires === null ? null : SKILL_TREES[heroId].find((r) => r.id === n.requires);
  m.root.append(
    el('div', 'pb-title', n.name),
    el('div', 'pb-text', n.description),
    el('div', 'pb-text', `Rank ${rank} / ${n.maxRank}`),
    el(
      'div',
      'pb-text pb-dim',
      `Needs hero level ${n.minLevel}${req !== null && req !== undefined ? ` and ${req.name}` : ''}`,
    ),
  );
  if (rank < n.maxRank) {
    m.root.append(
      el('div', 'pb-text', `Next rank: ${fmtInt(cost.souls)} souls · ${fmtInt(cost.gold)} gold`),
    );
  }
  if (block !== null) m.root.append(el('div', 'pb-text pb-warn', BLOCK_TEXT[block]));
  const row = el('div', 'button-row');
  row.append(
    m.button('Close', 'btn', () => {
      ctx.uiTap();
      ctx.shell.closeModal();
    }),
    m.button(
      'Learn',
      'btn btn-primary',
      () => {
        ctx.uiTap();
        const before = p.power(heroId);
        if (p.rankUpSkill(heroId, n.id)) {
          renderSkills(ctx);
          openNode(ctx, n);
          ctx.shell.showPower(before, p.power(heroId));
          ctx.stingers.play('power', 2);
        }
      },
      { disabled: block !== null, testid: 'skill-learn' },
    ),
  );
  m.root.append(row);
}
