import { HEROES } from '../../data/heroes';
import {
  GEAR_CONFIG,
  GEAR_SLOTS,
  RARITY_DEFS,
  SLOT_DEFS,
  type GearSlot,
  type Rarity,
} from '../../data/items';
import {
  formatStat,
  itemName,
  itemPower,
  mainValue,
  salvageValue,
  subValue,
  upgradeCost,
  type GearItem,
} from '../../progression/gear';
import { el } from '../dom';
import type { MenuContext } from './context';
import { statRows } from './heroesScreen';
import { fmtInt, type View } from './View';

const RARITY_RANK: Readonly<Record<Rarity, number>> = {
  common: 0,
  rare: 1,
  epic: 2,
  legendary: 3,
  mythic: 4,
};

export function itemTile(
  v: View,
  item: GearItem | undefined,
  slot: GearSlot,
  onTap: () => void,
  testid?: string,
): HTMLElement {
  const rarity = item?.rarity;
  const tile = v.button(
    '',
    `item-tile${rarity !== undefined ? ` rarity-${rarity}` : ' is-empty'}`,
    onTap,
    testid !== undefined ? { testid } : {},
  );
  tile.append(el('span', 'item-glyph', SLOT_DEFS[slot].glyph));
  if (item !== undefined) {
    if (item.plus > 0) tile.append(el('span', 'item-plus', `+${item.plus}`));
    tile.append(el('span', 'item-ilvl', `Lv${item.ilvl}`));
    if (item.isNew) tile.append(el('span', 'item-new'));
    if (item.locked) tile.append(el('span', 'item-lock', '🔒'));
  } else {
    tile.append(el('span', 'item-slot-label', SLOT_DEFS[slot].label));
  }
  return tile;
}

/** Inventory + equipment with comparisons, upgrades, locking and salvage. */
export function renderGear(ctx: MenuContext, filter: GearSlot | null): void {
  const p = ctx.profile;
  const heroId = p.selectedHero;
  const v = ctx.shell.begin(`Gear · ${HEROES[heroId].name}`, () => ctx.nav.hub(), 'gear');
  const wrap = el('div', 'gear');

  const left = el('div', 'gear-left');
  const slots = el('div', 'equip-grid');
  for (const slot of GEAR_SLOTS) {
    const item = p.equippedIn(heroId, slot);
    slots.append(
      itemTile(
        v,
        item,
        slot,
        () => {
          ctx.uiTap();
          if (item !== undefined) openItem(ctx, item, filter);
          else renderGear(ctx, slot);
        },
        `equip-${slot}`,
      ),
    );
  }
  left.append(
    slots,
    el('div', 'gear-power', `Power ${fmtInt(p.power(heroId))} · Lv ${p.hero(heroId).level}`),
  );

  const right = el('div', 'gear-right');
  const chips = el('div', 'chip-row');
  const chip = (label: string, value: GearSlot | null): HTMLElement =>
    v.button(
      label,
      `chip${filter === value ? ' is-selected' : ''}`,
      () => {
        ctx.uiTap();
        renderGear(ctx, value);
      },
      { testid: `filter-${value ?? 'all'}` },
    );
  chips.append(chip('All', null));
  for (const s of GEAR_SLOTS) chips.append(chip(SLOT_DEFS[s].glyph, s));

  const items = p.data.items
    .filter((i) => filter === null || i.slot === filter)
    .filter((i) => p.wearer(i.uid) !== heroId)
    .sort((a, b) => RARITY_RANK[b.rarity] - RARITY_RANK[a.rarity] || itemPower(b) - itemPower(a));
  const grid = el('div', 'item-grid');
  grid.dataset['allowScroll'] = '';
  if (items.length === 0)
    grid.append(el('div', 'empty-note', 'No items here yet — win battles to find gear.'));
  for (const item of items) {
    const tile = itemTile(v, item, item.slot, () => {
      ctx.uiTap();
      openItem(ctx, item, filter);
    });
    if (p.wearer(item.uid) !== null) tile.classList.add('is-worn');
    grid.append(tile);
  }

  const foot = el('div', 'gear-foot');
  foot.append(el('span', 'gear-count', `${p.data.items.length} / ${GEAR_CONFIG.inventoryCap}`));
  const bulk = (label: string, maxRank: number, testid: string): HTMLElement =>
    v.button(
      label,
      'btn btn-small',
      () => {
        ctx.uiTap();
        const uids = p.data.items
          .filter((i) => RARITY_RANK[i.rarity] <= maxRank && !i.locked && p.wearer(i.uid) === null)
          .map((i) => i.uid);
        if (uids.length === 0) {
          ctx.toast('Nothing to salvage');
          return;
        }
        const r = p.salvage(uids);
        ctx.toast(`Salvaged ${r.count} items: +${r.materials} materials, +${r.gold} gold`);
        renderGear(ctx, filter);
      },
      { testid },
    );
  foot.append(
    bulk('Salvage commons', 0, 'salvage-common'),
    bulk('Salvage ≤ rare', 1, 'salvage-rare'),
  );
  right.append(chips, grid, foot);
  wrap.append(left, right);
  v.root.append(wrap);
  p.clearNewFlags();
}

function openItem(ctx: MenuContext, item: GearItem, filter: GearSlot | null): void {
  const p = ctx.profile;
  const heroId = p.selectedHero;
  const m = ctx.shell.openModal('item-modal');
  const r = RARITY_DEFS[item.rarity];
  const wearer = p.wearer(item.uid);
  const wornHere = wearer === heroId;

  const head = el('div', 'item-head');
  const name = el('div', 'item-name', `${itemName(item)}${item.plus > 0 ? ` +${item.plus}` : ''}`);
  name.style.color = r.color;
  head.append(
    name,
    el(
      'div',
      'item-meta',
      `${r.label} ${SLOT_DEFS[item.slot].label} · Item level ${item.ilvl}${wearer !== null ? ` · worn by ${HEROES[wearer].name}` : ''}`,
    ),
  );
  const stats = el('div', 'item-stats');
  stats.append(el('div', 'item-main', formatStat(item.main.stat, mainValue(item))));
  for (const s of item.subs)
    stats.append(el('div', 'item-sub', formatStat(s.stat, subValue(item, s))));
  if (item.subs.length === 0) stats.append(el('div', 'item-sub pb-dim', 'No substats'));

  const cols = el('div', 'item-cols');
  const left = el('div', 'item-col');
  left.append(head, stats);
  const right = el('div', 'item-col');
  if (!wornHere) {
    right.append(
      el('div', 'pb-label', 'If equipped'),
      statRows(p.stats(heroId), p.statsWith(heroId, item)),
    );
  } else {
    right.append(el('div', 'pb-label', 'Hero stats'), statRows(p.stats(heroId)));
  }
  cols.append(left, right);

  const cost = upgradeCost(item);
  const upLabel =
    cost === null
      ? 'Max +15'
      : `Upgrade ${fmtInt(cost.gold)}◉ ${cost.materials}⚒${cost.successRate < 1 ? ` ${Math.round(cost.successRate * 100)}%` : ''}`;
  const canPay =
    cost !== null &&
    p.wallet.canAfford('gold', cost.gold) &&
    p.wallet.canAfford('materials', cost.materials);
  const sv = salvageValue(item);
  const row = el('div', 'button-row');
  row.append(
    m.button(
      wornHere ? 'Unequip' : 'Equip',
      'btn btn-primary',
      () => {
        ctx.uiTap();
        if (wornHere) p.unequip(heroId, item.slot);
        else p.equip(heroId, item.uid);
        ctx.shell.closeModal();
        renderGear(ctx, filter);
      },
      { testid: 'item-equip' },
    ),
    m.button(
      upLabel,
      'btn',
      () => {
        ctx.uiTap();
        const res = p.upgrade(item.uid);
        if (res === 'success') ctx.toast(`Upgrade succeeded: +${item.plus}`);
        else if (res === 'failed') ctx.toast('Upgrade failed — materials spent, item unharmed');
        renderGear(ctx, filter);
        openItem(ctx, item, filter);
      },
      { disabled: !canPay, testid: 'item-upgrade' },
    ),
    m.button(item.locked ? 'Unlock' : 'Lock', 'btn', () => {
      ctx.uiTap();
      p.toggleLock(item.uid);
      renderGear(ctx, filter);
      openItem(ctx, item, filter);
    }),
    m.button(
      `Salvage (+${sv.materials}⚒)`,
      'btn',
      () => {
        ctx.uiTap();
        const res = p.salvage([item.uid]);
        ctx.toast(`Salvaged: +${res.materials} materials, +${res.gold} gold`);
        ctx.shell.closeModal();
        renderGear(ctx, filter);
      },
      { disabled: item.locked || wearer !== null, testid: 'item-salvage' },
    ),
    m.button('Close', 'btn', () => {
      ctx.uiTap();
      ctx.shell.closeModal();
    }),
  );
  m.root.append(cols, row);
}
