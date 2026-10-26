import type { StatBlock } from '../../data/combatTypes';
import { HEROES, type HeroId } from '../../data/heroes';
import { findAdventureStage } from '../../data/adventure';
import { xpToNext } from '../../progression/xp';
import { el } from '../dom';
import type { MenuContext } from './context';
import { fmtInt } from './View';

export function statRows(s: StatBlock, compare?: StatBlock): HTMLElement {
  const box = el('div', 'stat-rows');
  const row = (label: string, value: number, fmt: (n: number) => string, cmp?: number): void => {
    const r = el('div', 'stat-row');
    r.append(el('span', 'stat-label', label), el('span', 'stat-val', fmt(value)));
    if (cmp !== undefined) {
      const delta = cmp - value;
      if (Math.abs(delta) > 1e-6) {
        r.append(
          el(
            'span',
            `stat-delta ${delta > 0 ? 'is-up' : 'is-down'}`,
            `${delta > 0 ? '▲' : '▼'} ${fmt(Math.abs(delta))}`,
          ),
        );
      }
    }
    box.append(r);
  };
  const int = (n: number): string => fmtInt(n);
  const pct = (n: number): string => `${(n * 100).toFixed(1).replace(/\.0$/, '')}%`;
  row('HP', s.maxHp, int, compare?.maxHp);
  row('ATK', s.atk, int, compare?.atk);
  row('DEF', s.def, int, compare?.def);
  row('Crit rate', s.critChance, pct, compare?.critChance);
  row(
    'Crit damage',
    s.critDamage - 1,
    pct,
    compare === undefined ? undefined : compare.critDamage - 1,
  );
  row('Attack speed', s.attackSpeed, (n) => `×${n.toFixed(2)}`, compare?.attackSpeed);
  row('Move speed', s.moveSpeed, (n) => n.toFixed(1), compare?.moveSpeed);
  return box;
}

/** Hero roster: select, unlock with souls, see stats. */
export function renderHeroes(ctx: MenuContext, focus?: HeroId): void {
  const p = ctx.profile;
  const v = ctx.shell.begin('Heroes', () => ctx.nav.hub(), 'heroes');
  const shown: HeroId = focus ?? p.selectedHero;
  const wrap = el('div', 'heroes');
  const list = el('div', 'hero-list');
  for (const id of Object.keys(HEROES) as HeroId[]) {
    const def = HEROES[id];
    const h = p.hero(id);
    const card = v.button(
      '',
      `hero-card${id === shown ? ' is-selected' : ''}${h.unlocked ? '' : ' is-locked'}`,
      () => {
        ctx.uiTap();
        renderHeroes(ctx, id);
      },
      { testid: `hero-${id}` },
    );
    card.append(
      el('span', 'hero-card-name', def.name),
      el(
        'span',
        'hero-card-sub',
        h.unlocked ? `Lv ${h.level}${id === p.selectedHero ? ' · in party' : ''}` : '🔒 Locked',
      ),
    );
    list.append(card);
  }

  const def = HEROES[shown];
  const h = p.hero(shown);
  const detail = el('div', 'hero-detail');
  detail.append(
    el('div', 'hero-detail-name', `${def.name}, ${def.epithet}`),
    el('div', 'hero-detail-role', def.role),
  );
  if (h.unlocked) {
    const need = xpToNext(h.level);
    detail.append(
      el(
        'div',
        'hero-detail-line',
        `Level ${h.level} · ${need > 0 ? `${fmtInt(h.xp)} / ${fmtInt(need)} XP` : 'Max level'} · Power ${fmtInt(p.power(shown))}`,
      ),
      statRows(p.stats(shown)),
    );
    const row = el('div', 'button-row');
    if (shown !== p.selectedHero) {
      row.append(
        v.button(
          'Take into battle',
          'btn btn-primary',
          () => {
            ctx.uiTap();
            p.selectHero(shown);
            ctx.onHeroChanged(shown);
            renderHeroes(ctx, shown);
          },
          { testid: 'hero-select' },
        ),
      );
    } else {
      row.append(el('div', 'btn is-disabled', 'In party'));
    }
    row.append(
      v.button('Gear', 'btn', () => {
        ctx.uiTap();
        if (shown !== p.selectedHero) {
          p.selectHero(shown);
          ctx.onHeroChanged(shown);
        }
        ctx.nav.gear(null);
      }),
      v.button('Skills', 'btn', () => {
        ctx.uiTap();
        if (shown !== p.selectedHero) {
          p.selectHero(shown);
          ctx.onHeroChanged(shown);
        }
        ctx.nav.skills();
      }),
    );
    detail.append(row);
  } else {
    const u = def.unlock;
    const block = p.heroUnlockBlock(shown);
    const stage = u === null ? undefined : findAdventureStage(u.afterStage);
    const req =
      u === null
        ? ''
        : `Requires: clear ${stage !== undefined ? `${stage.chapter}-${stage.index + 1} ${stage.name}` : u.afterStage}, and ${u.souls} souls.`;
    detail.append(statRows(def.stats), el('div', 'hero-detail-line', req));
    detail.append(
      v.button(
        u === null ? 'Unlock' : `Summon (${u.souls} souls)`,
        'btn btn-primary',
        () => {
          ctx.uiTap();
          if (p.unlockHero(shown)) {
            ctx.stingers.play('unlock');
            ctx.toast(`${def.name} joins the hunt`);
            renderHeroes(ctx, shown);
          }
        },
        { disabled: block !== null, testid: 'hero-unlock' },
      ),
    );
  }
  wrap.append(list, detail);
  v.root.append(wrap);
}
