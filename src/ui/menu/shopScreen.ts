import { RARITY_DEFS } from '../../data/items';
import { PETS } from '../../data/pets';
import {
  CHESTS,
  EGG_OFFERS,
  EXCHANGE,
  RELIC_OFFERS,
  STONE_OFFERS,
  type ShopArt,
  type ShopOffer,
  type ShopReward,
} from '../../data/shop';
import { itemName } from '../../progression/gear';
import { eggOdds } from '../../progression/pets';
import { casketOdds } from '../../progression/relics';
import { RELICS } from '../../data/relics';
import { relicGem } from './relicsScreen';
import type { PurchaseResult } from '../../progression/PlayerProfile';
import { el } from '../dom';
import { amount, icon, type IconName } from '../icons';
import type { MenuContext, ShopTab } from './context';
import { petPortrait } from './petsScreen';
import { fmtInt } from './View';

const TABS: readonly { id: ShopTab; label: string; icon: IconName }[] = [
  { id: 'deals', label: 'Deals', icon: 'sparkle' },
  { id: 'chests', label: 'Chests', icon: 'chest' },
  { id: 'eggs', label: 'Eggs', icon: 'egg' },
  { id: 'relics', label: 'Relics', icon: 'relic' },
  { id: 'enchant', label: 'Enchant', icon: 'stones' },
  { id: 'exchange', label: 'Exchange', icon: 'swap' },
];

const ART: Readonly<Record<ShopArt, IconName>> = {
  gold: 'gold',
  gems: 'gems',
  souls: 'souls',
  materials: 'materials',
  tickets: 'tickets',
  chest: 'chest',
  egg: 'egg',
  sparkle: 'sparkle',
  stones: 'stones',
  relic: 'relic',
};

/** Time until the next local midnight, as "5h 12m". */
function untilMidnight(nowMs = Date.now()): string {
  const d = new Date(nowMs);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  const min = Math.max(0, Math.floor((next - nowMs) / 60000));
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

/** The Shop: tabs of offer cards bought with in-game currency. */
export function renderShop(ctx: MenuContext, tab: ShopTab): void {
  const p = ctx.profile;
  const v = ctx.shell.begin('Shop', () => ctx.nav.hub(), 'shop');
  const wrap = el('div', 'shop');

  const tabs = el('div', 'shop-tabs');
  for (const t of TABS) {
    const b = v.button(
      '',
      `shop-tab${t.id === tab ? ' is-selected' : ''}`,
      () => {
        ctx.uiTap();
        renderShop(ctx, t.id);
      },
      { testid: `shop-tab-${t.id}` },
    );
    b.append(icon(t.icon), el('span', '', t.label));
    tabs.append(b);
  }

  const offers: ShopOffer[] =
    tab === 'deals'
      ? p.shopDeals()
      : tab === 'chests'
        ? [...CHESTS]
        : tab === 'eggs'
          ? [...EGG_OFFERS]
          : tab === 'relics'
            ? [...RELIC_OFFERS]
            : tab === 'enchant'
              ? [...STONE_OFFERS]
              : [...EXCHANGE];
  const head = el('div', 'shop-head');
  head.append(
    el(
      'span',
      'shop-head-text',
      tab === 'deals'
        ? `New deals in ${untilMidnight()}`
        : tab === 'chests'
          ? 'Gear at your progress level. Pity still counts toward legendaries.'
          : tab === 'eggs'
            ? 'Hatch companions. A pet you already have becomes a shard to raise its stars.'
            : 'Trade one currency for another.',
    ),
    el('span', 'shop-note', 'In-game currency only'),
  );

  const grid = el('div', 'shop-grid');
  grid.dataset['allowScroll'] = '';
  for (const o of offers) grid.append(offerCard(ctx, v, o, tab));
  wrap.append(tabs, head, grid);
  v.root.append(wrap);
}

function rewardLine(ctx: MenuContext, r: ShopReward): HTMLElement {
  if (r.kind === 'currency')
    return amount(r.currency, `+${fmtInt(ctx.profile.rewardAmount(r))}`, 'offer-reward');
  if (r.kind === 'gear') {
    const s = el('span', 'offer-reward');
    s.append(
      icon('weapon'),
      document.createTextNode(`${r.count}× ${RARITY_DEFS[r.minRarity].label}+ gear`),
    );
    s.style.setProperty('--rarity', RARITY_DEFS[r.minRarity].color);
    return s;
  }
  if (r.kind === 'relic') {
    const s = el('span', 'offer-reward');
    const odds = casketOdds(r.casket)
      .map((o) => `${RARITY_DEFS[o.rarity].label} ${Math.round(o.chance * 100)}%`)
      .join(' · ');
    s.append(icon('relic'), document.createTextNode(odds));
    return s;
  }
  const s = el('span', 'offer-reward');
  const odds = eggOdds(r.egg)
    .map((o) => `${RARITY_DEFS[o.rarity].label} ${Math.round(o.chance * 100)}%`)
    .join(' · ');
  s.append(icon('egg'), document.createTextNode(odds));
  return s;
}

function offerCard(
  ctx: MenuContext,
  v: ReturnType<MenuContext['shell']['begin']>,
  o: ShopOffer,
  tab: ShopTab,
): HTMLElement {
  const p = ctx.profile;
  const left = p.shopLeft(o);
  const block = p.shopBlock(o);
  const card = el('div', `offer tint-${o.tint}${block === 'limit' ? ' is-sold' : ''}`);
  card.dataset['testid'] = `offer-${o.id}`;
  if (o.ribbon !== undefined) card.append(el('span', 'offer-ribbon', o.ribbon));
  const art = el('div', 'offer-art');
  art.append(el('div', 'offer-art-glow'), icon(ART[o.art]));
  const rewards = el('div', 'offer-rewards');
  for (const r of o.rewards) rewards.append(rewardLine(ctx, r));
  const buy = v.button(
    '',
    `btn offer-buy${o.price === null ? ' btn-primary' : ''}`,
    () => {
      ctx.uiTap();
      const why = p.shopBlock(o);
      if (why === 'funds') {
        ctx.toast('Not enough currency');
        return;
      }
      if (why === 'bag') {
        ctx.toast('Your bag is full — salvage some gear first');
        return;
      }
      if (why === 'limit') return;
      const res = p.buy(o);
      if (res === null) return;
      showPurchase(ctx, o, res, tab);
    },
    { disabled: block === 'limit', testid: `buy-${o.id}` },
  );
  if (block === 'limit') buy.textContent = 'Sold out';
  else if (o.price === null) buy.textContent = 'Claim free';
  else buy.append(amount(o.price.currency, fmtInt(o.price.amount)));
  if (block === 'funds') buy.classList.add('is-short');
  card.append(
    art,
    el('div', 'offer-name', o.name),
    el('div', 'offer-blurb', o.blurb),
    rewards,
    buy,
  );
  if (left !== null && block !== 'limit')
    card.append(el('div', 'offer-left', `${left} left today`));
  return card;
}

/** "You got" reveal after a purchase. */
function showPurchase(ctx: MenuContext, o: ShopOffer, r: PurchaseResult, tab: ShopTab): void {
  const m = ctx.shell.openModal('purchase-modal');
  const got = el('div', 'purchase-got');
  let best = -1;
  for (const c of r.currencies) {
    const card = el('div', 'got-card');
    card.append(icon(c.currency), el('div', 'got-value', `+${fmtInt(c.amount)}`));
    got.append(card);
  }
  for (const item of r.items) {
    const d = RARITY_DEFS[item.rarity];
    const card = el('div', `got-card rarity-${item.rarity}`);
    card.style.setProperty('--rarity', d.color);
    const n = el('div', 'got-name', itemName(item));
    n.style.color = d.color;
    card.append(
      icon(item.slot, '', item.rarity),
      n,
      el('div', 'got-value', `${d.label} · Lv${item.ilvl}`),
    );
    got.append(card);
    best = Math.max(best, ['common', 'rare', 'epic', 'legendary', 'mythic'].indexOf(item.rarity));
  }
  for (const h of r.pets) {
    const def = PETS[h.pet];
    const d = RARITY_DEFS[def.rarity];
    const card = el('div', `got-card rarity-${def.rarity}`);
    card.style.setProperty('--rarity', d.color);
    const n = el('div', 'got-name', def.name);
    n.style.color = d.color;
    card.append(
      petPortrait(def, true, 'is-small'),
      n,
      el('div', 'got-value', h.isNew ? `NEW · ${d.label}` : 'Duplicate → +1 shard'),
    );
    got.append(card);
    best = Math.max(best, ['common', 'rare', 'epic', 'legendary', 'mythic'].indexOf(def.rarity));
  }
  for (const c of r.relics) {
    const def = RELICS[c.relic];
    const d = RARITY_DEFS[def.rarity];
    const card = el('div', `got-card rarity-${def.rarity}`);
    card.style.setProperty('--rarity', d.color);
    const n = el('div', 'got-name', def.name);
    n.style.color = d.color;
    card.append(
      relicGem(def, 'is-small'),
      n,
      el(
        'div',
        'got-value',
        c.isNew
          ? `NEW · ${d.label}`
          : c.souls > 0
            ? `Max level → +${c.souls} souls`
            : `Duplicate → level ${c.level}`,
      ),
    );
    got.append(card);
    best = Math.max(best, ['common', 'rare', 'epic', 'legendary', 'mythic'].indexOf(def.rarity));
  }
  if (r.pets.length > 0) ctx.onPetChanged();
  const rarities = ['common', 'rare', 'epic', 'legendary', 'mythic'] as const;
  const top = rarities[best];
  if (top !== undefined) ctx.stingers.loot(top);
  else ctx.stingers.play('coin');
  const row = el('div', 'button-row');
  if (r.items.length > 0)
    row.append(
      m.button('See in Gear', 'btn', () => {
        ctx.uiTap();
        ctx.shell.closeModal();
        ctx.nav.gear(null);
      }),
    );
  if (r.relics.length > 0)
    row.append(
      m.button('See Relics', 'btn', () => {
        ctx.uiTap();
        ctx.shell.closeModal();
        ctx.nav.relics();
      }),
    );
  if (r.pets.length > 0)
    row.append(
      m.button('See Pets', 'btn', () => {
        ctx.uiTap();
        ctx.shell.closeModal();
        ctx.nav.pets();
      }),
    );
  row.append(
    m.button(
      'Great!',
      'btn btn-primary',
      () => {
        ctx.uiTap();
        ctx.shell.closeModal();
        renderShop(ctx, tab);
      },
      { testid: 'purchase-ok' },
    ),
  );
  m.root.append(el('h2', 'panel-title', o.name), got, row);
  // Balances changed: refresh the shop behind the modal.
  ctx.shell.refreshCurrencies();
}
