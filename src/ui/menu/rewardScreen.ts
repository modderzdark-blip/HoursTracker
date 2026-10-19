import { HEROES } from '../../data/heroes';
import { RARITY_DEFS, SLOT_DEFS } from '../../data/items';
import type { RewardSummary } from '../../modes/rewards';
import { formatStat, itemName, mainValue } from '../../progression/gear';
import { el } from '../dom';
import type { MenuContext } from './context';
import { fmtInt, fmtTime } from './View';

export interface ResultButton {
  readonly label: string;
  readonly primary?: boolean;
  readonly testid: string;
  readonly run: () => void;
}

/** Victory screen: stars, currencies, XP / level-ups, loot reveal, unlock notices. */
export function renderVictory(
  ctx: MenuContext,
  r: RewardSummary,
  buttons: readonly ResultButton[],
): void {
  const v = ctx.shell.begin('', null, 'victory');
  const wrap = el('div', 'reward');
  const head = el('div', 'reward-head');
  const stars = el('div', 'result-stars');
  for (let i = 0; i < 3; i++) {
    const s = el('span', i < r.stars ? 'star is-on' : 'star', '★');
    s.style.animationDelay = `${0.25 + i * 0.25}s`;
    stars.append(s);
  }
  head.append(el('h2', 'reward-title', r.title), stars, el('div', 'reward-sub', r.subtitle));

  const cur = el('div', 'reward-row');
  const chip = (text: string, cls: string): void => {
    cur.append(el('span', `loot ${cls}`, text));
  };
  chip(`+${fmtInt(r.gold)} gold`, 'loot-gold');
  if (r.gems > 0) chip(`+${r.gems} gems`, 'loot-gems');
  if (r.souls > 0) chip(`+${r.souls} souls`, 'loot-souls');
  if (r.materials > 0) chip(`+${r.materials} materials`, 'loot-mat');
  if (r.tickets > 0) chip(`+${r.tickets} ticket${r.tickets > 1 ? 's' : ''}`, 'loot-ticket');
  const hero = HEROES[r.heroId];
  const xpLine = el(
    'div',
    `reward-xp${r.levelsGained > 0 ? ' is-levelup' : ''}`,
    r.levelsGained > 0
      ? `${hero.name} +${fmtInt(r.xp)} XP — LEVEL UP! Level ${r.heroLevel}`
      : `${hero.name} +${fmtInt(r.xp)} XP · Level ${r.heroLevel}`,
  );
  const time = el(
    'div',
    'reward-time',
    `Time ${fmtTime(r.timeSec)}${r.firstClear ? ' · First clear!' : ''}`,
  );

  const loot = el('div', 'loot-cards');
  r.items.forEach((item, i) => {
    const d = RARITY_DEFS[item.rarity];
    const card = el('div', `loot-card rarity-${item.rarity}`);
    card.style.animationDelay = `${0.6 + i * 0.35}s`;
    const name = el('div', 'loot-card-name', itemName(item));
    name.style.color = d.color;
    card.append(
      el('div', 'loot-card-glyph', SLOT_DEFS[item.slot].glyph),
      name,
      el('div', 'loot-card-meta', `${d.label} · Lv${item.ilvl}`),
      el('div', 'loot-card-stat', formatStat(item.main.stat, mainValue(item))),
    );
    loot.append(card);
  });
  if (r.autoSalvaged.count > 0) {
    loot.append(
      el(
        'div',
        'loot-note',
        `Bag full: ${r.autoSalvaged.count} item(s) salvaged for ${r.autoSalvaged.materials} materials`,
      ),
    );
  }
  const unlocks = el('div', 'reward-unlocks');
  for (const u of r.unlocks) unlocks.append(el('div', 'unlock', `✦ ${u}`));

  const row = el('div', 'button-row');
  for (const b of buttons) {
    row.append(
      v.button(
        b.label,
        b.primary === true ? 'btn btn-primary' : 'btn',
        () => {
          ctx.uiTap();
          b.run();
        },
        { testid: b.testid },
      ),
    );
  }
  wrap.append(head, cur, xpLine, time, loot, unlocks, row);
  v.root.append(wrap);
  ctx.shell.refreshCurrencies();
}

/** Short defeat summary after giving up (no rewards). */
export function renderDefeat(
  ctx: MenuContext,
  subtitle: string,
  buttons: readonly ResultButton[],
): void {
  const v = ctx.shell.begin('', null, 'defeat');
  const wrap = el('div', 'reward');
  wrap.append(
    el('h2', 'reward-title result-defeat', 'Defeat'),
    el('div', 'reward-sub', subtitle),
    el('div', 'reward-time', 'Stronger gear, levels and skills turn the tide. Try again.'),
  );
  const row = el('div', 'button-row');
  for (const b of buttons) {
    row.append(
      v.button(
        b.label,
        b.primary === true ? 'btn btn-primary' : 'btn',
        () => {
          ctx.uiTap();
          b.run();
        },
        { testid: b.testid },
      ),
    );
  }
  wrap.append(row);
  v.root.append(wrap);
}
