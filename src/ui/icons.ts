import type { Currency } from '../data/economy';
import type { Rarity } from '../data/items';
import { ICON_PATHS } from './iconPaths';

/**
 * Menu icons: game-icons.net shapes (CC BY 3.0, see iconPaths.ts) rendered like game UI art —
 * a dark outline, a metallic gradient body (gold, steel, gem, rarity colours…) and a gloss
 * highlight on the upper half. Each shape is defined once in a shared, hidden defs block and
 * drawn with <use>, so a screen full of icons stays light.
 */

/** A few simple shapes drawn here (same 512 × 512 frame). */
const OWN_PATHS = {
  play: 'M150 86l290 170-290 170z',
  check: 'M60 270l66-66 88 88 172-172 66 66-238 238z',
  sort: 'M96 72h64v272h64l-96 112-96-112h64zM272 96h192v56H272zM272 208h144v56H272zM272 320h96v56h-96z',
} as const;

const PATHS: Readonly<Record<string, string>> = { ...ICON_PATHS, ...OWN_PATHS };

export type IconName = keyof typeof ICON_PATHS | keyof typeof OWN_PATHS;

export type IconMaterial =
  | 'gold'
  | 'steel'
  | 'gem'
  | 'soul'
  | 'bronze'
  | 'jade'
  | 'ember'
  | 'violet'
  | 'ivory'
  | 'dark'
  | Rarity;

/** Gradient stops (top → bottom) of each material. */
const MATERIALS: Readonly<Record<IconMaterial, readonly string[]>> = {
  gold: ['#fff6c8', '#f6cf5a', '#c98a1e', '#6e3f08'],
  steel: ['#ffffff', '#d4dbe3', '#8a96a4', '#3a424c'],
  gem: ['#ffe2f4', '#ff6cb8', '#c21f78', '#5a0a36'],
  soul: ['#effcff', '#8fe0ff', '#2f86c8', '#123a66'],
  bronze: ['#ffe6c4', '#dcae7c', '#9a6232', '#4a2810'],
  jade: ['#eafff0', '#8cf0b0', '#2f9a5c', '#0f4426'],
  ember: ['#fff3b8', '#ffad48', '#d2481a', '#5a1606'],
  violet: ['#f6eaff', '#c48aff', '#7a34d0', '#2e0f5a'],
  ivory: ['#ffffff', '#f2e6d0', '#c2ab86', '#6a5636'],
  dark: ['#b8aea0', '#857a6c', '#544a40', '#2a241e'],
  common: ['#ffffff', '#d8d2c6', '#9a9284', '#4a4438'],
  rare: ['#e6f2ff', '#7ab8ff', '#2a6ad0', '#0e2a66'],
  epic: ['#f6eaff', '#c48aff', '#7a34d0', '#2e0f5a'],
  legendary: ['#fff6c8', '#ffc24a', '#d0700e', '#5e2a04'],
  mythic: ['#ffe4e6', '#ff6a78', '#c81e30', '#560812'],
};

/** Material an icon is drawn in unless the caller picks one. */
const DEFAULT_MATERIAL: Readonly<Partial<Record<IconName, IconMaterial>>> = {
  gems: 'gem',
  souls: 'soul',
  materials: 'bronze',
  tickets: 'jade',
  weapon: 'steel',
  armor: 'steel',
  helmet: 'steel',
  gloves: 'steel',
  ring: 'gold',
  amulet: 'gem',
  lock: 'steel',
  cog: 'steel',
  flame: 'ember',
  bolt: 'ember',
  endless: 'violet',
  egg: 'ivory',
  camera: 'steel',
  gamepad: 'steel',
  eye: 'ember',
  note: 'gold',
  heart: 'mythic',
  claw: 'ember',
  wisp: 'soul',
  moth: 'violet',
  owl: 'soul',
  serpent: 'violet',
  play: 'ivory',
  check: 'jade',
  sort: 'ivory',
};

const SVG = 'http://www.w3.org/2000/svg';
let defs: SVGDefsElement | null = null;
const defined = new Set<string>();

/** The shared defs block (gradients once; shapes as icons are first used). */
function sharedDefs(): SVGDefsElement {
  if (defs !== null && defs.isConnected) return defs;
  const holder = document.createElementNS(SVG, 'svg');
  holder.setAttribute('aria-hidden', 'true');
  holder.setAttribute('width', '0');
  holder.setAttribute('height', '0');
  holder.style.position = 'absolute';
  holder.style.width = '0';
  holder.style.height = '0';
  holder.style.overflow = 'hidden';
  const d = document.createElementNS(SVG, 'defs');
  defined.clear();
  for (const [id, stops] of Object.entries(MATERIALS)) {
    const g = document.createElementNS(SVG, 'linearGradient');
    g.id = `ig-${id}`;
    g.setAttribute('x1', '0');
    g.setAttribute('y1', '0');
    g.setAttribute('x2', '0.25');
    g.setAttribute('y2', '1');
    stops.forEach((c, i) => {
      const s = document.createElementNS(SVG, 'stop');
      s.setAttribute('offset', String([0, 0.38, 0.72, 1][i] ?? 1));
      s.setAttribute('stop-color', c);
      g.append(s);
    });
    d.append(g);
  }
  const gloss = document.createElementNS(SVG, 'linearGradient');
  gloss.id = 'ig-gloss';
  gloss.setAttribute('x1', '0');
  gloss.setAttribute('y1', '0');
  gloss.setAttribute('x2', '0');
  gloss.setAttribute('y2', '1');
  for (const [o, a] of [
    ['0', '0.6'],
    ['0.45', '0.12'],
    ['0.5', '0'],
  ] as const) {
    const s = document.createElementNS(SVG, 'stop');
    s.setAttribute('offset', o);
    s.setAttribute('stop-color', '#fff');
    s.setAttribute('stop-opacity', a);
    gloss.append(s);
  }
  d.append(gloss);
  holder.append(d);
  document.body.append(holder);
  defs = d;
  return d;
}

function shapeFor(name: IconName): string {
  const id = `is-${name}`;
  const d = sharedDefs();
  if (!defined.has(id)) {
    const path = document.createElementNS(SVG, 'path');
    path.id = id;
    path.setAttribute('d', PATHS[name] ?? '');
    d.append(path);
    defined.add(id);
  }
  return `#${id}`;
}

/**
 * An icon element (class `icon icon-<name>` plus `cls`), drawn in its default material or
 * `material` (gear takes its rarity).
 */
export function icon(name: IconName, cls = '', material?: IconMaterial): SVGSVGElement {
  const href = shapeFor(name);
  const mat = material ?? DEFAULT_MATERIAL[name] ?? 'gold';
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '-28 -28 568 568');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `icon icon-${name}${cls === '' ? '' : ` ${cls}`}`);
  const layer = (fill: string, outline: boolean): void => {
    const u = document.createElementNS(SVG, 'use');
    u.setAttribute('href', href);
    u.setAttribute('fill', fill);
    if (outline) {
      u.setAttribute('stroke', '#140904');
      u.setAttribute('stroke-width', '34');
      u.setAttribute('stroke-linejoin', 'round');
    }
    svg.append(u);
  };
  layer('#140904', true);
  layer(`url(#ig-${mat})`, false);
  layer('url(#ig-gloss)', false);
  return svg;
}

/** A currency amount with its icon (`1,200 [coin]`). */
export function amount(currency: Currency, value: string, cls = ''): HTMLElement {
  const span = document.createElement('span');
  span.className = `amount amount-${currency}${cls === '' ? '' : ` ${cls}`}`;
  span.append(icon(currency), document.createTextNode(value));
  return span;
}

/** A div of class `cls` holding an icon. */
export function iconBox(cls: string, name: IconName, material?: IconMaterial): HTMLElement {
  const div = document.createElement('div');
  div.className = cls;
  div.append(icon(name, '', material));
  return div;
}

/** A span of class `cls` holding an icon (inline contexts). */
export function iconSpan(cls: string, name: IconName): HTMLElement {
  const span = document.createElement('span');
  span.className = cls;
  span.append(icon(name));
  return span;
}

/** A reward bundle as currency amounts with icons (`[coin] 500  [gem] 20`). */
export function bundleAmounts(r: Partial<Record<Currency, number>>): HTMLElement {
  const span = document.createElement('span');
  span.className = 'bundle';
  for (const c of ['gold', 'gems', 'souls', 'materials', 'tickets', 'stones'] as const) {
    const v = r[c];
    if (v !== undefined && v > 0) span.append(amount(c, String(v)));
  }
  return span;
}
