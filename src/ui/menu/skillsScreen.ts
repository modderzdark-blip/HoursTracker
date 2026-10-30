import { HERO_ICON_MATERIAL, SKILL_ICONS } from '../../data/heroKits/abilities';
import { HEROES, type HeroId, type SkillDef } from '../../data/heroes';
import { SKILL_TREES, type SkillNodeDef } from '../../data/skillTrees';
import { abilityLevel, skillPool } from '../../progression/loadout';
import { rankBlock, rankCost } from '../../progression/skillTree';
import { el } from '../dom';
import { icon, type IconName } from '../icons';
import type { MenuContext } from './context';
import { fmtInt, type View } from './View';

const COLS = 5;
const ROWS = 4;
const ROMAN = ['I', 'II', 'III'] as const;

const BLOCK_TEXT = {
  maxed: 'Fully learned',
  level: 'Hero level too low',
  requires: 'Learn the previous node first',
  souls: 'Not enough souls',
  gold: 'Not enough gold',
} as const;

export type SkillsTab = 'abilities' | 'talents';

const TABS: readonly { id: SkillsTab; label: string; icon: IconName }[] = [
  { id: 'abilities', label: 'Abilities', icon: 'bolt' },
  { id: 'talents', label: 'Talents', icon: 'star' },
];

/** Skills: the ability loadout (buttons I / II / III) and the talent tree. */
export function renderSkills(ctx: MenuContext, tab: SkillsTab = 'abilities'): void {
  const hero = HEROES[ctx.profile.selectedHero];
  const v = ctx.shell.begin(`Skills · ${hero.name}`, () => ctx.nav.hub(), 'skills');
  const wrap = el('div', 'skills');
  const tabs = el('div', 'shop-tabs');
  for (const t of TABS) {
    const b = v.button(
      '',
      `shop-tab${t.id === tab ? ' is-selected' : ''}`,
      () => {
        ctx.uiTap();
        renderSkills(ctx, t.id);
      },
      { testid: `skills-tab-${t.id}` },
    );
    b.append(icon(t.icon), el('span', '', t.label));
    tabs.append(b);
  }
  wrap.append(tabs);
  if (tab === 'abilities') wrap.append(abilitiesView(ctx, v));
  else wrap.append(talentsView(ctx, v));
  v.root.append(wrap);
}

// ---------------------------------------------------------------- abilities

/** Short tags that say what an ability does, read from its data. */
export function abilityTags(s: SkillDef): string[] {
  const t: string[] = [];
  if (s.special === 'leap') t.push('Leap');
  if (s.special === 'shadowStep') t.push('Teleport');
  if (s.special === 'steerable') t.push('Move while casting');
  if (s.special === 'charge') t.push('Hold to charge');
  const kinds = new Set(s.hits.map((h) => h.emit?.kind ?? 'melee'));
  if (kinds.has('projectile')) t.push('Ranged');
  if (kinds.has('zone')) t.push('Area');
  const status = new Set(s.hits.map((h) => h.spec.status?.id).filter((x) => x !== undefined));
  for (const st of ['burn', 'bleed', 'slow'] as const)
    if (status.has(st)) t.push(st === 'burn' ? 'Burn' : st === 'bleed' ? 'Bleed' : 'Slow');
  if (s.hits.some((h) => (h.spec.drain ?? 0) > 0)) t.push('Life drain');
  if (s.hits.some((h) => h.spec.pull === true)) t.push('Pulls');
  if (s.hits.some((h) => h.spec.reaction === 'launch')) t.push('Launches');
  else if (s.hits.some((h) => h.spec.reaction === 'knockdown')) t.push('Knocks down');
  if (s.invulnerable !== undefined) t.push('Untouchable');
  if (s.superArmor === true) t.push('Unstoppable');
  if ((s.damageTakenMult ?? 1) < 1) t.push('Guard');
  return t;
}

/** Damage against one target, in % of ATK (zones count each tick). */
export function abilityPower(s: SkillDef): number {
  let sum = 0;
  for (const h of s.hits) {
    const e = h.emit;
    sum += h.spec.damage * (e?.kind === 'zone' ? e.zone.ticks : 1);
  }
  return Math.round(sum * 100);
}

function abilityIcon(heroId: HeroId, s: SkillDef, locked = false): SVGSVGElement {
  return icon(
    SKILL_ICONS[s.id] ?? 'bolt',
    'ability-icon',
    locked ? 'dark' : HERO_ICON_MATERIAL[heroId],
  );
}

function abilitiesView(ctx: MenuContext, v: View): HTMLElement {
  const p = ctx.profile;
  const heroId = p.selectedHero;
  const level = p.hero(heroId).level;
  const loadout = p.loadout(heroId);
  const pool = skillPool(heroId);
  const view = el('div', 'abilities');

  // ---- the three buttons
  const slots = el('div', 'ability-slots');
  loadout.forEach((id, i) => {
    const s = pool.find((x) => x.id === id);
    const card = el('div', 'ability-slot');
    card.dataset['testid'] = `ability-slot-${i}`;
    const badge = el('div', 'ability-slot-num', ROMAN[i] ?? '');
    const art = el('div', 'ability-art');
    if (s !== undefined) art.append(abilityIcon(heroId, s));
    const meta = el('div', 'ability-slot-meta');
    meta.append(
      el('div', 'ability-name', s?.name ?? '—'),
      el(
        'div',
        'ability-sub',
        s === undefined ? '' : `${(s.cooldownMs / 1000).toFixed(1)} s cooldown`,
      ),
    );
    card.append(badge, art, meta);
    slots.append(card);
  });

  // ---- every ability
  const grid = el('div', 'ability-grid');
  grid.dataset['allowScroll'] = '';
  for (const s of pool) {
    const need = abilityLevel(heroId, s.id);
    const locked = need > level;
    const at = loadout.indexOf(s.id);
    const b = v.button(
      '',
      `ability-card${locked ? ' is-locked' : ''}${at >= 0 ? ' is-equipped' : ''}`,
      () => {
        ctx.uiTap();
        openAbility(ctx, s);
      },
      { testid: `ability-${s.id}` },
    );
    const art = el('div', 'ability-art');
    art.append(abilityIcon(heroId, s, locked));
    const meta = el('div', 'ability-card-meta');
    meta.append(
      el('div', 'ability-name', s.name),
      el(
        'div',
        'ability-sub',
        locked ? `Unlocks at hero level ${need}` : abilityTags(s).slice(0, 3).join(' · '),
      ),
    );
    b.append(art, meta);
    if (at >= 0) b.append(el('span', 'ability-tag', ROMAN[at] ?? ''));
    else if (locked) b.append(icon('lock', 'ability-lock', 'steel'));
    grid.append(b);
  }
  view.append(slots, grid);
  return view;
}

function openAbility(ctx: MenuContext, s: SkillDef): void {
  const p = ctx.profile;
  const heroId = p.selectedHero;
  const need = abilityLevel(heroId, s.id);
  const locked = need > p.hero(heroId).level;
  const loadout = p.loadout(heroId);
  const m = ctx.shell.openModal('ability-modal');
  const head = el('div', 'ability-head');
  const art = el('div', 'ability-art is-big');
  art.append(abilityIcon(heroId, s, locked));
  const title = el('div', 'ability-head-text');
  title.append(
    el('div', 'pb-title', s.name),
    el(
      'div',
      'ability-sub',
      `${(s.cooldownMs / 1000).toFixed(1)} s cooldown · ${abilityPower(s)}% ATK damage`,
    ),
  );
  head.append(art, title);
  const tags = el('div', 'ability-tags');
  for (const t of abilityTags(s)) tags.append(el('span', 'ability-chip', t));
  m.root.append(head, tags);
  if (locked) {
    m.root.append(el('div', 'pb-text pb-warn', `Unlocks at hero level ${need}.`));
  } else {
    m.root.append(el('div', 'pb-text pb-dim', 'Put it on a skill button:'));
  }
  const row = el('div', 'button-row');
  for (let i = 0; i < 3; i++) {
    const here = loadout[i] === s.id;
    const other = skillPool(heroId).find((x) => x.id === loadout[i]);
    const b = m.button(
      '',
      `btn ability-equip${here ? '' : ' btn-primary'}`,
      () => {
        ctx.uiTap();
        if (p.setLoadoutSlot(heroId, i, s.id)) {
          ctx.stingers.play('unlock');
          ctx.shell.closeModal();
          renderSkills(ctx, 'abilities');
        }
      },
      { disabled: locked || here, testid: `ability-equip-${i}` },
    );
    b.append(
      el('span', 'ability-equip-num', ROMAN[i] ?? ''),
      el('span', 'ability-equip-text', here ? 'Equipped' : `Replace ${other?.name ?? ''}`),
    );
    row.append(b);
  }
  m.root.append(row);
  const close = el('div', 'button-row');
  close.append(
    m.button('Close', 'btn', () => {
      ctx.uiTap();
      ctx.shell.closeModal();
    }),
  );
  m.root.append(close);
}

// ---------------------------------------------------------------- talents

/** The talent tree: the first three branches follow whatever ability is on that button. */
function talentsView(ctx: MenuContext, v: View): HTMLElement {
  const p = ctx.profile;
  const heroId = p.selectedHero;
  const nodes = SKILL_TREES[heroId];
  const h = p.hero(heroId);
  const names = slotNames(ctx);
  const view = el('div', 'skills-talents');
  const heads = el('div', 'skill-heads');
  for (const name of [`I · ${names[0]}`, `II · ${names[1]}`, `III · ${names[2]}`, 'Core', 'Guard'])
    heads.append(el('div', 'skill-head', name));
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
    const pips = el('span', 'skill-pips');
    for (let i = 0; i < n.maxRank; i++) pips.append(el('span', i < rank ? 'is-on' : ''));
    const text = el('span', 'skill-text');
    text.append(el('span', 'skill-name', n.name.replace(/^.*: /, '')), pips);
    node.append(text, el('span', 'skill-rank', `${rank}/${n.maxRank}`));
    grid.append(node);
  }
  view.append(heads, grid);
  return view;
}

/** Names of the abilities on buttons I / II / III. */
function slotNames(ctx: MenuContext): [string, string, string] {
  const heroId = ctx.profile.selectedHero;
  const pool = skillPool(heroId);
  const lo = ctx.profile.loadout(heroId);
  const name = (i: number): string => pool.find((s) => s.id === lo[i])?.name ?? '';
  return [name(0), name(1), name(2)];
}

/** A node's text with the kit ability's name swapped for the one on its button now. */
function nodeText(ctx: MenuContext, n: SkillNodeDef, text: string): string {
  if (n.col > 2) return text;
  const kit = HEROES[ctx.profile.selectedHero].skills[n.col as 0 | 1 | 2].name;
  return text.split(kit).join(slotNames(ctx)[n.col] ?? kit);
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
    el('div', 'pb-title', nodeText(ctx, n, n.name)),
    el('div', 'pb-text', nodeText(ctx, n, n.description)),
    el('div', 'pb-text', `Rank ${rank} / ${n.maxRank}`),
    el(
      'div',
      'pb-text pb-dim',
      `Needs hero level ${n.minLevel}${req !== null && req !== undefined ? ` and ${nodeText(ctx, req, req.name)}` : ''}`,
    ),
  );
  if (n.col <= 2)
    m.root.append(
      el(
        'div',
        'pb-text pb-dim',
        `Applies to whichever ability is on button ${ROMAN[n.col] ?? ''}.`,
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
          renderSkills(ctx, 'talents');
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
