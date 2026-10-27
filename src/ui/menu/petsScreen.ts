import { RARITY_DEFS } from '../../data/items';
import {
  EGGS,
  PET_CONFIG,
  PET_IDS,
  PET_STAT_LABEL,
  PETS,
  type PetDef,
  type PetId,
  type PetStat,
} from '../../data/pets';
import { petBonus, petLevelCost, shardsForNextStar, strikeMult } from '../../progression/pets';
import { el } from '../dom';
import { amount, icon, type IconName } from '../icons';
import type { MenuContext } from './context';
import { statRows } from './heroesScreen';
import { fmtInt } from './View';

/** The pet's picture: a glowing orb in its colours with a shape glyph. */
const SHAPE_ICON: Readonly<Record<PetDef['look']['shape'], IconName>> = {
  hound: 'pet',
  fox: 'pet',
  moth: 'sparkle',
  drake: 'flame',
  owl: 'star',
  wisp: 'souls',
  bird: 'flame',
  serpent: 'endless',
};

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

export function petPortrait(def: PetDef, owned: boolean, cls = ''): HTMLElement {
  const p = el('div', `pet-portrait${owned ? '' : ' is-unknown'}${cls === '' ? '' : ` ${cls}`}`);
  p.style.setProperty('--pet', hex(def.look.color));
  p.style.setProperty('--pet-accent', hex(def.look.accent));
  p.style.setProperty('--rarity', RARITY_DEFS[def.rarity].color);
  p.append(el('div', 'pet-portrait-glow'), icon(owned ? SHAPE_ICON[def.look.shape] : 'egg'));
  return p;
}

function stars(n: number, max: number = PET_CONFIG.maxStars): HTMLElement {
  const s = el('span', 'pet-stars');
  for (let i = 0; i < max; i++) s.append(el('span', i < n ? 'is-on' : '', '★'));
  return s;
}

function pct(stat: PetStat, v: number): string {
  return `+${(v * 100).toFixed(1)}% ${PET_STAT_LABEL[stat]}`;
}

/** Pets: the collection on the left, the selected pet's card on the right. */
export function renderPets(ctx: MenuContext, selected: PetId | null): void {
  const p = ctx.profile;
  const v = ctx.shell.begin('Pets', () => ctx.nav.hub(), 'pets');
  const owned = PET_IDS.filter((id) => p.pet(id) !== undefined);
  const sel: PetId = selected ?? owned[0] ?? PET_IDS[0] ?? 'cinder_pup';
  const wrap = el('div', 'pets');

  // ---- collection
  const list = el('div', 'pet-list');
  list.dataset['allowScroll'] = '';
  for (const id of PET_IDS) {
    const def = PETS[id];
    const prog = p.pet(id);
    const card = v.button(
      '',
      `pet-card rarity-${def.rarity}${id === sel ? ' is-selected' : ''}${prog === undefined ? ' is-locked' : ''}${p.activePet === id ? ' is-active' : ''}`,
      () => {
        ctx.uiTap();
        renderPets(ctx, id);
      },
      { testid: `pet-${id}` },
    );
    card.append(petPortrait(def, prog !== undefined, 'is-small'));
    const meta = el('div', 'pet-card-meta');
    meta.append(el('div', 'pet-card-name', prog === undefined ? '???' : def.name));
    if (prog !== undefined) {
      const line = el('div', 'pet-card-line');
      line.append(el('span', '', `Lv ${prog.level}`), stars(prog.stars));
      meta.append(line);
    } else {
      meta.append(el('div', 'pet-card-line', RARITY_DEFS[def.rarity].label));
    }
    card.append(meta);
    if (p.activePet === id) card.append(el('span', 'pet-badge', 'WITH YOU'));
    list.append(card);
  }

  // ---- detail
  const def = PETS[sel];
  const prog = p.pet(sel);
  const detail = el('div', 'pet-detail panel-frame');
  const head = el('div', 'pet-head');
  head.append(petPortrait(def, prog !== undefined, 'is-big'));
  const title = el('div', 'pet-title');
  const name = el('div', 'pet-name', prog === undefined ? 'Undiscovered' : def.name);
  name.style.color = RARITY_DEFS[def.rarity].color;
  title.append(name, el('div', 'pet-sub', `${RARITY_DEFS[def.rarity].label} · ${def.title}`));
  if (prog !== undefined) title.append(stars(prog.stars));
  head.append(title);
  detail.append(head);

  if (prog === undefined) {
    const eggs = (Object.keys(EGGS) as (keyof typeof EGGS)[])
      .filter((e) => ((EGGS[e].weights as Record<string, number>)[def.rarity] ?? 0) > 0)
      .map((e) => EGGS[e].name)
      .join(' or ');
    detail.append(
      el('p', 'pet-lore', 'A companion you have not found yet.'),
      el('p', 'pet-hint', `Hatches from: ${eggs}. Eggs are in the Shop.`),
    );
    const row = el('div', 'button-row');
    row.append(
      v.button(
        'Go to the Shop',
        'btn btn-primary',
        () => {
          ctx.uiTap();
          ctx.nav.shop('eggs');
        },
        { testid: 'pet-shop' },
      ),
    );
    detail.append(row);
  } else {
    const bonus = petBonus(def, prog);
    const next = petLevelCost(prog.level);
    const nextBonus = next === null ? null : petBonus(def, { ...prog, level: prog.level + 1 });
    const stats = el('div', 'pet-bonus');
    for (const [stat, val] of Object.entries(bonus) as [PetStat, number][]) {
      const row = el('div', 'pet-bonus-row');
      row.append(el('span', '', pct(stat, val)));
      const nb = nextBonus?.[stat];
      if (nb !== undefined) row.append(el('span', 'pet-next', `→ ${pct(stat, nb)}`));
      stats.append(row);
    }
    const strike = el(
      'div',
      'pet-strike',
      `Strikes the nearest foe every ${def.strike.everySec.toFixed(1)} s for ${Math.round(strikeMult(def, prog) * 100)}% of your ATK`,
    );
    const lvl = el('div', 'pet-level');
    const bar = el('div', 'pet-level-bar');
    const fill = el('div', 'pet-level-fill');
    fill.style.width = `${(prog.level / PET_CONFIG.maxLevel) * 100}%`;
    bar.append(fill);
    lvl.append(el('span', '', `Level ${prog.level} / ${PET_CONFIG.maxLevel}`), bar);
    detail.append(lvl, stats, strike, el('p', 'pet-lore', def.lore));

    const row = el('div', 'button-row');
    const isActive = p.activePet === sel;
    row.append(
      v.button(
        isActive ? 'Companion' : 'Take with you',
        `btn${isActive ? '' : ' btn-primary'}`,
        () => {
          ctx.uiTap();
          const heroId = p.selectedHero;
          const before = p.power(heroId);
          p.setActivePet(sel);
          ctx.stingers.play('unlock');
          renderPets(ctx, sel);
          ctx.shell.showPower(before, p.power(heroId));
        },
        { disabled: isActive, testid: 'pet-activate' },
      ),
    );
    const lvBtn = v.button(
      '',
      'btn btn-cost',
      () => {
        ctx.uiTap();
        const heroId = p.selectedHero;
        const before = p.power(heroId);
        if (p.levelUpPet(sel)) {
          ctx.stingers.play('levelUp');
          renderPets(ctx, sel);
          if (isActive) ctx.shell.showPower(before, p.power(heroId));
        } else ctx.toast('Not enough souls or gold');
      },
      {
        disabled:
          next === null ||
          !p.wallet.canAfford('souls', next.souls) ||
          !p.wallet.canAfford('gold', next.gold),
        testid: 'pet-levelup',
      },
    );
    if (next === null) lvBtn.textContent = 'Max level';
    else
      lvBtn.append(
        el('span', 'btn-cost-label', 'Level up'),
        amount('souls', fmtInt(next.souls)),
        amount('gold', fmtInt(next.gold)),
      );
    row.append(lvBtn);
    const need = shardsForNextStar(prog.stars);
    row.append(
      v.button(
        need === null ? 'Max stars' : `Ascend ${prog.shards}/${need}`,
        'btn',
        () => {
          ctx.uiTap();
          if (p.ascendPet(sel)) {
            ctx.stingers.play('fanfare');
            ctx.toast(`${def.name} reached ${prog.stars} stars`);
            renderPets(ctx, sel);
          }
        },
        { disabled: need === null || prog.shards < need, testid: 'pet-ascend' },
      ),
    );
    detail.append(row);
    if (!isActive) {
      const cmp = el('div', 'pet-compare');
      cmp.append(
        el('div', 'pb-label', 'Hero stats with this pet'),
        statRows(p.stats(p.selectedHero), p.statsWithPet(p.selectedHero, sel)),
      );
      detail.append(cmp);
    }
  }

  const side = el('div', 'pet-side');
  side.append(el('div', 'pet-count', `${owned.length} / ${PET_IDS.length} found`), list);
  wrap.append(side, detail);
  v.root.append(wrap);
}
