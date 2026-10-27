import { RARITY_DEFS } from '../../data/items';
import { PET_STAT_LABEL, type PetStat } from '../../data/pets';
import {
  CASKETS,
  RELIC_CONFIG,
  RELIC_IDS,
  RELICS,
  type RelicDef,
  type RelicId,
} from '../../data/relics';
import { relicBonus, relicEffectText } from '../../progression/relics';
import { el } from '../dom';
import { icon } from '../icons';
import type { MenuContext } from './context';

/** The relic's picture: a faceted gem in its glow colour. */
export function relicGem(def: RelicDef, cls = '', owned = true): HTMLElement {
  const g = el('div', `relic-gem${owned ? '' : ' is-unknown'}${cls === '' ? '' : ` ${cls}`}`);
  g.style.setProperty('--relic', def.color);
  g.style.setProperty('--rarity', RARITY_DEFS[def.rarity].color);
  g.append(el('div', 'relic-gem-glow'), icon('relic', '', owned ? def.rarity : 'dark'));
  return g;
}

function levelPips(level: number): HTMLElement {
  const s = el('span', 'relic-pips');
  for (let i = 0; i < RELIC_CONFIG.maxLevel; i++) s.append(el('span', i < level ? 'is-on' : ''));
  return s;
}

function bonusLine(stat: PetStat, v: number): string {
  return `+${(v * 100).toFixed(1)}% ${PET_STAT_LABEL[stat]}`;
}

/** Relics: the two slots and the collection on the left, the selected relic on the right. */
export function renderRelics(ctx: MenuContext, selected: RelicId | null = null): void {
  const p = ctx.profile;
  const v = ctx.shell.begin('Relics', () => ctx.nav.gear(), 'relics');
  const owned = RELIC_IDS.filter((id) => p.relic(id) !== undefined);
  const equipped = p.equippedRelics;
  const sel: RelicId =
    selected ?? equipped.find((id): id is RelicId => id !== null) ?? owned[0] ?? 'pyre_heart';
  const wrap = el('div', 'pets relics');

  // ---- slots
  const slots = el('div', 'relic-slots');
  equipped.forEach((id, i) => {
    const b = v.button(
      '',
      `relic-slot${id === null ? ' is-empty' : ''}${id === sel ? ' is-selected' : ''}`,
      () => {
        ctx.uiTap();
        if (id !== null) renderRelics(ctx, id);
      },
      { testid: `relic-slot-${i}` },
    );
    if (id === null)
      b.append(el('span', 'relic-slot-plus', '+'), el('span', 'relic-slot-label', 'Empty'));
    else
      b.append(relicGem(RELICS[id], 'is-small'), el('span', 'relic-slot-label', RELICS[id].name));
    slots.append(b);
  });

  // ---- collection
  const list = el('div', 'pet-list');
  list.dataset['allowScroll'] = '';
  for (const id of RELIC_IDS) {
    const def = RELICS[id];
    const prog = p.relic(id);
    const card = v.button(
      '',
      `pet-card relic-card rarity-${def.rarity}${id === sel ? ' is-selected' : ''}${prog === undefined ? ' is-locked' : ''}`,
      () => {
        ctx.uiTap();
        renderRelics(ctx, id);
      },
      { testid: `relic-${id}` },
    );
    card.append(relicGem(def, 'is-small', prog !== undefined));
    const meta = el('div', 'pet-card-meta');
    meta.append(el('div', 'pet-card-name', prog === undefined ? '???' : def.name));
    const line = el('div', 'pet-card-line');
    if (prog !== undefined) line.append(el('span', '', `Lv ${prog.level}`), levelPips(prog.level));
    else line.append(el('span', '', RARITY_DEFS[def.rarity].label));
    meta.append(line);
    card.append(meta);
    if (equipped.includes(id)) card.append(el('span', 'pet-badge', 'EQUIPPED'));
    list.append(card);
  }

  // ---- detail
  const def = RELICS[sel];
  const prog = p.relic(sel);
  const level = prog?.level ?? 1;
  const detail = el('div', 'pet-detail panel-frame relic-detail');
  detail.style.setProperty('--relic', def.color);
  const head = el('div', 'pet-head');
  head.append(relicGem(def, 'is-big', prog !== undefined));
  const title = el('div', 'pet-title');
  const name = el('div', 'pet-name', prog === undefined ? 'Undiscovered' : def.name);
  name.style.color = RARITY_DEFS[def.rarity].color;
  title.append(name, el('div', 'pet-sub', `${RARITY_DEFS[def.rarity].label} relic`));
  if (prog !== undefined) {
    const lv = el('div', 'relic-level');
    lv.append(
      el('span', '', `Level ${prog.level} / ${RELIC_CONFIG.maxLevel}`),
      levelPips(prog.level),
    );
    title.append(lv);
  }
  head.append(title);
  detail.append(head);

  const effect = el('div', 'relic-effect');
  effect.append(
    el('span', 'relic-effect-label', 'Signature'),
    el('span', '', relicEffectText(def, level)),
  );
  if (prog !== undefined && level < RELIC_CONFIG.maxLevel)
    effect.append(el('span', 'pet-next', `next level: ${relicEffectText(def, level + 1)}`));
  const stats = el('div', 'pet-bonus');
  const next = level < RELIC_CONFIG.maxLevel ? relicBonus(def, level + 1) : null;
  for (const [stat, val] of Object.entries(relicBonus(def, level)) as [PetStat, number][]) {
    const row = el('div', 'pet-bonus-row');
    row.append(el('span', '', bonusLine(stat, val)));
    const nb = next?.[stat];
    if (prog !== undefined && nb !== undefined)
      row.append(el('span', 'pet-next', `→ ${bonusLine(stat, nb)}`));
    stats.append(row);
  }
  detail.append(
    effect,
    stats,
    el('p', 'pet-lore', prog === undefined ? 'A relic you have not found yet.' : def.lore),
  );

  const row = el('div', 'button-row');
  if (prog === undefined) {
    const from = (Object.keys(CASKETS) as (keyof typeof CASKETS)[])
      .filter((c) => ((CASKETS[c].weights as Record<string, number>)[def.rarity] ?? 0) > 0)
      .map((c) => CASKETS[c].name)
      .join(' or ');
    detail.append(el('p', 'pet-hint', `Found in: ${from}. Caskets are in the Shop.`));
    row.append(
      v.button(
        'Go to the Shop',
        'btn btn-primary',
        () => {
          ctx.uiTap();
          ctx.nav.shop('relics');
        },
        { testid: 'relic-shop' },
      ),
    );
  } else {
    const at = equipped.indexOf(sel);
    const before = p.power(p.selectedHero);
    const done = (): void => {
      ctx.stingers.play('unlock');
      renderRelics(ctx, sel);
      ctx.shell.showPower(before, p.power(p.selectedHero));
    };
    for (let i = 0; i < equipped.length; i++) {
      if (i === at) continue;
      const other = equipped[i];
      row.append(
        v.button(
          other === null || other === undefined
            ? `Equip in slot ${i + 1}`
            : `Swap with ${RELICS[other].name}`,
          'btn btn-primary',
          () => {
            ctx.uiTap();
            if (!p.equipRelic(sel, i)) return;
            // A swap: the relic that was in slot i takes this one's old slot.
            if (at >= 0 && other !== null && other !== undefined) p.equipRelic(other, at);
            done();
          },
          { testid: `relic-equip-${i}` },
        ),
      );
    }
    if (at >= 0)
      row.append(
        v.button(
          'Remove',
          'btn',
          () => {
            ctx.uiTap();
            p.unequipRelic(sel);
            done();
          },
          { testid: 'relic-unequip' },
        ),
      );
    detail.append(
      el(
        'p',
        'pet-hint',
        level < RELIC_CONFIG.maxLevel
          ? 'Find it again in a casket to raise its level.'
          : `Max level. Another copy turns into ${RELIC_CONFIG.maxedDuplicateSouls} souls.`,
      ),
    );
  }
  detail.append(row);

  const side = el('div', 'pet-side');
  side.append(slots, el('div', 'pet-count', `${owned.length} / ${RELIC_IDS.length} found`), list);
  wrap.append(side, detail);
  v.root.append(wrap);
}
