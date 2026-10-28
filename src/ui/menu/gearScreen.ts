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
  canEnchant,
  enchantCost,
  enchantMult,
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
import { amount, icon } from '../icons';
import { RELICS } from '../../data/relics';
import { relicGem } from './relicsScreen';
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

type SortMode = 'rarity' | 'power' | 'level';
const SORT_LABEL: Readonly<Record<SortMode, string>> = {
  rarity: 'Rarity',
  power: 'Power',
  level: 'Level',
};
/** Kept between visits to the screen. */
let sortMode: SortMode = 'rarity';

/** Items whose salvage asks first when "Confirm rare salvage" is on (rare or better). */
export function needsSalvageConfirm(
  items: readonly Pick<GearItem, 'rarity'>[],
  confirmSetting: boolean,
): boolean {
  return confirmSetting && items.some((i) => RARITY_RANK[i.rarity] >= RARITY_RANK.rare);
}

/**
 * Runs `run` straight away, or after a confirmation modal when the items include rare+ gear and
 * the player kept "Confirm rare salvage" on (Settings → Gameplay).
 */
function confirmSalvage(
  ctx: MenuContext,
  items: readonly GearItem[],
  run: () => void,
  onCancel: () => void,
): void {
  if (!needsSalvageConfirm(items, ctx.settings.settings.confirmRareSalvage)) {
    run();
    return;
  }
  const best = items.reduce((a, b) => (RARITY_RANK[b.rarity] > RARITY_RANK[a.rarity] ? b : a));
  const valuable = items.filter((i) => RARITY_RANK[i.rarity] >= RARITY_RANK.rare).length;
  const m = ctx.shell.openModal('confirm-modal');
  const row = el('div', 'button-row');
  row.append(
    m.button(
      'Salvage',
      'btn btn-primary',
      () => {
        ctx.uiTap();
        ctx.shell.closeModal();
        run();
      },
      { testid: 'salvage-confirm' },
    ),
    m.button(
      'Keep',
      'btn',
      () => {
        ctx.uiTap();
        ctx.shell.closeModal();
        onCancel();
      },
      { testid: 'salvage-cancel' },
    ),
  );
  const what =
    items.length === 1
      ? `${itemName(best)} is ${RARITY_DEFS[best.rarity].label.toLowerCase()} gear.`
      : `${items.length} items, ${valuable} of them rare or better.`;
  m.root.append(
    el('h2', 'panel-title', 'Salvage valuable gear?'),
    el('p', 'panel-body', `${what} Salvaged items are gone for good.`),
    el('p', 'panel-note', 'You can turn this prompt off in Settings → Gameplay.'),
    row,
  );
}

/**
 * An item tile: rarity frame and glow, the slot icon in rarity colour, +N, level, lock, new dot
 * and (in the bag) an arrow when it beats what the hero wears in that slot.
 */
export function itemTile(
  v: View,
  item: GearItem | undefined,
  slot: GearSlot,
  onTap: () => void,
  testid?: string,
  better = false,
): HTMLElement {
  const rarity = item?.rarity;
  const tile = v.button(
    '',
    `item-tile${rarity !== undefined ? ` rarity-${rarity}` : ' is-empty'}`,
    onTap,
    testid !== undefined ? { testid } : {},
  );
  if (rarity !== undefined) tile.style.setProperty('--rarity', RARITY_DEFS[rarity].color);
  tile.append(icon(slot, 'item-icon', rarity ?? 'dark'));
  if (item !== undefined) {
    if (item.plus > 0) tile.append(el('span', 'item-plus', `+${item.plus}`));
    if (item.ench > 0) tile.append(enchantBadge(item.ench));
    tile.append(el('span', 'item-ilvl', `Lv${item.ilvl}`));
    if (item.isNew) tile.append(el('span', 'item-new'));
    if (item.locked) tile.append(icon('lock', 'item-lock'));
    if (better) tile.append(el('span', 'item-better', '▲'));
  } else {
    tile.append(el('span', 'item-slot-label', SLOT_DEFS[slot].label));
  }
  return tile;
}

function sortItems(items: GearItem[]): GearItem[] {
  return items.sort((a, b) => {
    if (sortMode === 'power') return itemPower(b) - itemPower(a);
    if (sortMode === 'level') return b.ilvl - a.ilvl || b.plus - a.plus;
    return RARITY_RANK[b.rarity] - RARITY_RANK[a.rarity] || itemPower(b) - itemPower(a);
  });
}

/** Gear: the hero's six slots around their stats (left), the bag (right). */
export function renderGear(ctx: MenuContext, filter: GearSlot | null): void {
  const p = ctx.profile;
  const heroId = p.selectedHero;
  const v = ctx.shell.begin(`Gear · ${HEROES[heroId].name}`, () => ctx.nav.hub(), 'gear');
  const wrap = el('div', 'gear');

  // ---- equipment: slots in two columns around the hero card
  const left = el('div', 'gear-left panel-frame');
  const slotTile = (slot: GearSlot): HTMLElement => {
    const item = p.equippedIn(heroId, slot);
    return itemTile(
      v,
      item,
      slot,
      () => {
        ctx.uiTap();
        if (item !== undefined) openItem(ctx, item, filter);
        else renderGear(ctx, slot);
      },
      `equip-${slot}`,
    );
  };
  const colA = el('div', 'equip-col');
  const colB = el('div', 'equip-col');
  for (const s of ['weapon', 'helmet', 'armor'] as const) colA.append(slotTile(s));
  for (const s of ['gloves', 'ring', 'amulet'] as const) colB.append(slotTile(s));
  const core = el('div', 'gear-core');
  const power = el('div', 'gear-power');
  power.append(icon('bolt'), el('span', '', fmtInt(p.power(heroId))));
  const s = p.stats(heroId);
  const mini = el('div', 'gear-mini');
  const stat = (label: string, value: string): HTMLElement => {
    const d = el('div', 'gear-mini-row');
    d.append(el('span', '', label), el('b', '', value));
    return d;
  };
  mini.append(
    stat('HP', fmtInt(s.maxHp)),
    stat('ATK', fmtInt(s.atk)),
    stat('DEF', fmtInt(s.def)),
    stat('Crit', `${(s.critChance * 100).toFixed(1)}%`),
  );
  const auto = v.button(
    '',
    'btn btn-primary gear-auto',
    () => {
      ctx.uiTap();
      const before = p.power(heroId);
      const n = p.autoEquip(heroId);
      if (n === 0) {
        ctx.toast('Already wearing your best gear');
        return;
      }
      renderGear(ctx, filter);
      if (ctx.shell.showPower(before, p.power(heroId)))
        ctx.stingers.play('power', p.power(heroId) > before ? 3 : 0);
    },
    { testid: 'gear-auto' },
  );
  auto.append(icon('sparkle'), el('span', '', 'Auto-equip'));
  const relics = el('div', 'gear-relics');
  p.equippedRelics.forEach((id, i) => {
    const b = v.button(
      '',
      `gear-relic${id === null ? ' is-empty' : ''}`,
      () => {
        ctx.uiTap();
        ctx.nav.relics();
      },
      { testid: `gear-relic-${i}` },
    );
    if (id === null) b.append(el('span', 'relic-slot-plus', '+'));
    else b.append(relicGem(RELICS[id], 'is-tiny'));
    relics.append(b);
  });
  relics.append(el('span', 'gear-relics-label', 'Relics'));
  core.append(
    el('div', 'gear-hero-name', HEROES[heroId].name),
    el('div', 'gear-hero-lv', `Level ${p.hero(heroId).level}`),
    power,
    mini,
    relics,
    auto,
  );
  left.append(colA, core, colB);

  // ---- bag
  const right = el('div', 'gear-right');
  const bar = el('div', 'gear-bar');
  const chips = el('div', 'chip-row');
  const chip = (value: GearSlot | null): HTMLElement => {
    const b = v.button(
      value === null ? 'All' : '',
      `chip${filter === value ? ' is-selected' : ''}`,
      () => {
        ctx.uiTap();
        renderGear(ctx, value);
      },
      {
        testid: `filter-${value ?? 'all'}`,
        title: value === null ? 'All' : SLOT_DEFS[value].label,
      },
    );
    if (value !== null) b.append(icon(value));
    return b;
  };
  chips.append(chip(null));
  for (const sl of GEAR_SLOTS) chips.append(chip(sl));
  const sort = v.button(
    '',
    'chip chip-sort',
    () => {
      ctx.uiTap();
      sortMode = sortMode === 'rarity' ? 'power' : sortMode === 'power' ? 'level' : 'rarity';
      renderGear(ctx, filter);
    },
    { testid: 'gear-sort', title: 'Sort' },
  );
  sort.append(icon('sort'), el('span', '', SORT_LABEL[sortMode]));
  bar.append(chips);

  const bestPower = new Map<GearSlot, number>();
  for (const sl of GEAR_SLOTS) {
    const worn = p.equippedIn(heroId, sl);
    bestPower.set(sl, worn === undefined ? -1 : itemPower(worn));
  }
  const items = sortItems(
    p.data.items
      .filter((i) => filter === null || i.slot === filter)
      .filter((i) => p.wearer(i.uid) !== heroId),
  );
  const grid = el('div', 'item-grid');
  grid.dataset['allowScroll'] = '';
  if (items.length === 0)
    grid.append(
      el('div', 'empty-note', 'No items here yet — win battles or open chests in the Shop.'),
    );
  for (const item of items) {
    const better = p.wearer(item.uid) === null && itemPower(item) > (bestPower.get(item.slot) ?? 0);
    const tile = itemTile(
      v,
      item,
      item.slot,
      () => {
        ctx.uiTap();
        openItem(ctx, item, filter);
      },
      undefined,
      better,
    );
    if (p.wearer(item.uid) !== null) tile.classList.add('is-worn');
    grid.append(tile);
  }

  const foot = el('div', 'gear-foot');
  const count = el('span', 'gear-count');
  const full = p.data.items.length / GEAR_CONFIG.inventoryCap;
  count.append(
    icon('chest'),
    el('span', full > 0.9 ? 'is-full' : '', `${p.data.items.length} / ${GEAR_CONFIG.inventoryCap}`),
  );
  const bulk = (label: string, maxRank: number, testid: string): HTMLElement =>
    v.button(
      label,
      'btn btn-small',
      () => {
        ctx.uiTap();
        const picked = p.data.items.filter(
          (i) => RARITY_RANK[i.rarity] <= maxRank && !i.locked && p.wearer(i.uid) === null,
        );
        if (picked.length === 0) {
          ctx.toast('Nothing to salvage');
          return;
        }
        confirmSalvage(
          ctx,
          picked,
          () => {
            const r = p.salvage(picked.map((i) => i.uid));
            ctx.toast(`Salvaged ${r.count} items: +${r.materials} materials, +${r.gold} gold`);
            renderGear(ctx, filter);
          },
          () => undefined,
        );
      },
      { testid },
    );
  foot.append(
    count,
    sort,
    bulk('Salvage commons', 0, 'salvage-common'),
    bulk('Salvage ≤ rare', 1, 'salvage-rare'),
  );
  right.append(bar, grid, foot);
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
  const big = el('div', `item-tile item-big rarity-${item.rarity}`);
  big.style.setProperty('--rarity', r.color);
  big.append(icon(item.slot, 'item-icon', item.rarity));
  if (item.plus > 0) big.append(el('span', 'item-plus', `+${item.plus}`));
  if (item.ench > 0) big.append(enchantBadge(item.ench));
  const titles = el('div', 'item-titles');
  const name = el('div', 'item-name', `${itemName(item)}${item.plus > 0 ? ` +${item.plus}` : ''}`);
  name.style.color = r.color;
  titles.append(
    name,
    el(
      'div',
      'item-meta',
      `${r.label} ${SLOT_DEFS[item.slot].label} · Item level ${item.ilvl}${wearer !== null ? ` · worn by ${HEROES[wearer].name}` : ''}`,
    ),
    el('div', 'item-power', `Item power ${fmtInt(itemPower(item))}`),
  );
  head.append(big, titles);
  const stats = el('div', 'item-stats');
  stats.append(el('div', 'item-main', formatStat(item.main.stat, mainValue(item))));
  for (const sub of item.subs)
    stats.append(el('div', 'item-sub', formatStat(sub.stat, subValue(item, sub))));
  if (item.subs.length === 0) stats.append(el('div', 'item-sub pb-dim', 'No substats'));

  const cols = el('div', 'item-cols');
  const leftCol = el('div', 'item-col');
  leftCol.append(head, stats);
  const cost = upgradeCost(item);
  if (cost !== null) {
    const up = el('div', 'item-upgrade-info');
    const chance = el('div', 'upgrade-chance');
    const fill = el('div', 'upgrade-chance-fill');
    fill.style.width = `${Math.round(cost.successRate * 100)}%`;
    chance.append(fill);
    up.append(
      el(
        'span',
        'upgrade-step',
        `+${item.plus} → +${item.plus + 1} · ${Math.round(cost.successRate * 100)}% success`,
      ),
      chance,
    );
    if (cost.successRate < 1)
      up.append(el('span', 'upgrade-safe', 'A failed upgrade never harms the item'));
    leftCol.append(up);
  }
  const rightCol = el('div', 'item-col');
  if (!wornHere) {
    rightCol.append(
      el('div', 'pb-label', 'If equipped'),
      statRows(p.stats(heroId), p.statsWith(heroId, item)),
    );
  } else {
    rightCol.append(el('div', 'pb-label', 'Hero stats'), statRows(p.stats(heroId)));
  }
  // Under the stats (the shorter column), so the action row stays on screen on small phones.
  rightCol.append(enchantBlock(ctx, m, item, filter));
  cols.append(leftCol, rightCol);

  const canPay =
    cost !== null &&
    p.wallet.canAfford('gold', cost.gold) &&
    p.wallet.canAfford('materials', cost.materials);
  const sv = salvageValue(item);
  const row = el('div', 'button-row item-actions');
  const upBtn = m.button(
    '',
    'btn btn-cost',
    () => {
      ctx.uiTap();
      const before = p.power(heroId);
      const res = p.upgrade(item.uid);
      if (res === 'success') {
        ctx.toast(`Upgrade succeeded: +${item.plus}`);
        ctx.stingers.play('power', item.plus);
        if (wornHere) ctx.shell.showPower(before, p.power(heroId));
      } else if (res === 'failed') ctx.toast('Upgrade failed — materials spent, item unharmed');
      renderGear(ctx, filter);
      openItem(ctx, item, filter);
    },
    { disabled: !canPay, testid: 'item-upgrade' },
  );
  if (cost === null) upBtn.textContent = 'Max +15';
  else
    upBtn.append(
      el('span', 'btn-cost-label', 'Upgrade'),
      amount('gold', fmtInt(cost.gold)),
      amount('materials', String(cost.materials)),
    );
  if (!canPay && cost !== null) upBtn.classList.add('is-short');
  const salvBtn = m.button(
    '',
    'btn btn-cost',
    () => {
      ctx.uiTap();
      confirmSalvage(
        ctx,
        [item],
        () => {
          const res = p.salvage([item.uid]);
          ctx.toast(`Salvaged: +${res.materials} materials, +${res.gold} gold`);
          ctx.shell.closeModal();
          renderGear(ctx, filter);
        },
        () => openItem(ctx, item, filter),
      );
    },
    { disabled: item.locked || wearer !== null, testid: 'item-salvage' },
  );
  salvBtn.append(el('span', 'btn-cost-label', 'Salvage'), amount('materials', `+${sv.materials}`));
  const lockBtn = m.button(
    '',
    `btn btn-icon${item.locked ? ' is-on' : ''}`,
    () => {
      ctx.uiTap();
      p.toggleLock(item.uid);
      renderGear(ctx, filter);
      openItem(ctx, item, filter);
    },
    { testid: 'item-lock', title: item.locked ? 'Unlock' : 'Lock' },
  );
  lockBtn.append(icon('lock'), el('span', '', item.locked ? 'Unlock' : 'Lock'));
  row.append(
    m.button(
      wornHere ? 'Unequip' : 'Equip',
      'btn btn-primary',
      () => {
        ctx.uiTap();
        const before = p.power(heroId);
        if (wornHere) p.unequip(heroId, item.slot);
        else p.equip(heroId, item.uid);
        ctx.shell.closeModal();
        renderGear(ctx, filter);
        if (ctx.shell.showPower(before, p.power(heroId)))
          ctx.stingers.play('power', p.power(heroId) > before ? 3 : 0);
      },
      { testid: 'item-equip' },
    ),
    upBtn,
    lockBtn,
    salvBtn,
    m.button('Close', 'btn', () => {
      ctx.uiTap();
      ctx.shell.closeModal();
    }),
  );
  m.root.append(cols, row);
}

/** Corner mark of an enchanted item: a stone and the level. */
function enchantBadge(level: number): HTMLElement {
  const b = el('span', 'item-ench');
  b.append(icon('stones'), document.createTextNode(String(level)));
  return b;
}

/** Enchanting in the item panel, one compact row: level and bonus, then the enchant button. */
function enchantBlock(
  ctx: MenuContext,
  m: View,
  item: GearItem,
  filter: GearSlot | null,
): HTMLElement {
  const p = ctx.profile;
  const box = el('div', 'item-enchant');
  const head = el('div', 'item-enchant-head');
  const text = el('div', 'item-enchant-text');
  const stones = p.wallet.get('stones');
  text.append(
    el('span', '', item.ench > 0 ? `Enchant +${item.ench}` : 'Enchant'),
    el(
      'span',
      'item-enchant-note',
      !canEnchant(item)
        ? 'Rare or better only'
        : item.ench > 0
          ? `All stats +${Math.round((enchantMult(item) - 1) * 100)}%`
          : `${stones} stone${stones === 1 ? '' : 's'}`,
    ),
  );
  head.append(icon('stones'), text);
  box.append(head);
  const cost = enchantCost(item);
  if (cost === null) {
    if (canEnchant(item)) box.append(el('span', 'item-enchant-note', 'Fully enchanted'));
    return box;
  }
  const canPay = p.wallet.canAfford('stones', cost.stones) && p.wallet.canAfford('gold', cost.gold);
  const btn = m.button(
    '',
    `btn btn-cost btn-enchant${canPay ? '' : ' is-short'}`,
    () => {
      ctx.uiTap();
      const heroId = p.selectedHero;
      const before = p.power(heroId);
      const res = p.enchant(item.uid);
      if (res === 'success') {
        ctx.toast(`Enchanted to +${item.ench}!`);
        ctx.stingers.play('fanfare');
        if (p.wearer(item.uid) === heroId) ctx.shell.showPower(before, p.power(heroId));
      } else if (res === 'failed') ctx.toast('The stone cracked — the item is unharmed');
      else if (res === 'unaffordable') ctx.toast('Not enough Enchant Stones or gold');
      ctx.shell.refreshCurrencies();
      renderGear(ctx, filter);
      openItem(ctx, item, filter);
    },
    { disabled: !canPay, testid: 'item-enchant' },
  );
  btn.append(
    el('span', 'btn-cost-label', `+${item.ench + 1}`),
    amount('stones', `${cost.stones}`),
    amount('gold', fmtInt(cost.gold)),
    el('span', 'enchant-chance', `${Math.round(cost.successRate * 100)}%`),
  );
  box.append(btn);
  return box;
}
