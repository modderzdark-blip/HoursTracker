import { HEROES } from '../../data/heroes';
import { MODE_ORDER, MODES } from '../../data/modes';
import { xpToNext } from '../../progression/xp';
import { el } from '../dom';
import type { MenuContext } from './context';
import { fmtInt } from './View';

/** Main hub: hero preview (3D behind), hero summary, game modes and the menu dock. */
export function renderHub(ctx: MenuContext): void {
  const v = ctx.shell.begin('', null, 'hub');
  const p = ctx.profile;
  const id = p.selectedHero;
  const def = HEROES[id];
  const h = p.hero(id);

  const hub = el('div', 'hub');
  const info = el('div', 'hub-hero');
  const need = xpToNext(h.level);
  const xpBar = el('div', 'xp-bar');
  const xpFill = el('div', 'xp-fill');
  xpFill.style.width = need > 0 ? `${Math.min(100, (h.xp / need) * 100).toFixed(1)}%` : '100%';
  xpBar.append(xpFill);
  info.append(
    el('div', 'hub-hero-name', def.name),
    el('div', 'hub-hero-epithet', def.epithet),
    el('div', 'hub-hero-line', `Level ${h.level} · Power ${fmtInt(p.power(id))}`),
    xpBar,
  );

  const modes = el('div', 'hub-modes');
  for (const m of MODE_ORDER) {
    const info2 = MODES[m];
    const open = p.modeUnlocked(m);
    const b = v.button(
      '',
      `mode-btn mode-${m}${open ? '' : ' is-locked'}`,
      () => {
        ctx.uiTap();
        if (open) ctx.nav.mode(m);
        else ctx.toast(`Locked — ${info2.requiresLabel}`);
      },
      { testid: `mode-${m}` },
    );
    b.append(
      el('span', 'mode-name', info2.name),
      el('span', 'mode-sub', open ? info2.blurb : `🔒 ${info2.requiresLabel}`),
    );
    modes.append(b);
  }

  const newItems = p.data.items.filter((i) => i.isNew).length;
  const dock = el('div', 'hub-dock');
  const dockBtn = (label: string, testid: string, fn: () => void, badge = 0): HTMLElement => {
    const b = v.button(
      label,
      'dock-btn',
      () => {
        ctx.uiTap();
        fn();
      },
      { testid },
    );
    if (badge > 0) b.append(el('span', 'badge', String(badge)));
    return b;
  };
  dock.append(
    dockBtn('Heroes', 'dock-heroes', () => ctx.nav.heroes()),
    dockBtn('Gear', 'dock-gear', () => ctx.nav.gear(null), newItems),
    dockBtn('Skills', 'dock-skills', () => ctx.nav.skills()),
    dockBtn('Settings', 'dock-settings', () => ctx.nav.settings()),
  );
  hub.append(info, modes, dock);
  v.root.append(hub);
}
