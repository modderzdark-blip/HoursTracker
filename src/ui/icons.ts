/**
 * Menu icons (24 × 24), drawn in layers so they read as small illustrations rather than line
 * art: a solid body in the icon's colour, a half-tone layer, dark shading, white highlights and
 * outlines. The colour comes from CSS (`color`), so one icon serves every rarity or currency.
 * Built as SVG elements: sharp at any size, no image files.
 */

/** Layer kinds: a = solid, b = half tone, d = shade, h = highlight, l = outline, s = highlight line. */
type Layer = readonly ['a' | 'b' | 'd' | 'h' | 'l' | 's', string];

/** Circle path (cx, cy, r) for the layers. */
const circle = (cx: number, cy: number, r: number): string =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;

const ICONS = {
  // ---------------------------------------------------------------- currencies
  gold: [
    ['a', circle(12, 12, 10)],
    ['d', `${circle(12, 12, 7.2)}${circle(12, 12, 6)}`],
    ['h', 'M12 6.8l2.3 4.6L12 17.2l-2.3-5.8z'],
    ['s', 'M5.6 9.2a7 7 0 0 1 3.6-4.3'],
  ],
  gems: [
    ['a', 'M6 3.5h12l4 5.5-10 12.5L2 9z'],
    ['h', 'M2 9h20l-4-5.5H6z'],
    ['d', 'M2 9l10 12.5L8.6 9z'],
    ['h', 'M15.4 9L12 21.5 22 9z'],
    ['s', 'M7 5l-2.4 3.4'],
  ],
  souls: [
    [
      'b',
      'M12 1.5c3.4 4.3 8 6.6 8 12.8a8 8 0 0 1-16 0c0-3.6 2.2-5.5 3.3-7.7.2 3.2 2 4.4 3.2 4.6-.4-3.4-.8-6.4 1.5-9.7z',
    ],
    [
      'a',
      'M12 7c2 2.6 5 4.3 5 8a5 5 0 0 1-10 0c0-2.2 1.2-3.4 2-4.8.3 1.8 1.2 2.6 2 2.8-.2-2-.3-3.8 1-6z',
    ],
    ['h', circle(12, 16.2, 2.3)],
  ],
  materials: [
    [
      'a',
      'M2.5 7.5h13.5c.2 2.2 2.4 3.4 5.5 3.4v2.3c-3 0-5 .9-6 2.1v1.9h2v3.3H6.5v-3.3h2v-1.9c-1-1.2-3-2.1-6-2.1z',
    ],
    ['h', 'M2.5 7.5h13.5v1.6H2.5z'],
    ['d', 'M8.5 15.3h7v1.9h-7z'],
  ],
  tickets: [
    ['a', 'M2.5 6h19v4.2a1.9 1.9 0 0 0 0 3.6V18h-19v-4.2a1.9 1.9 0 0 0 0-3.6z'],
    ['d', 'M15.2 6.8h1.1v2h-1.1zM15.2 11h1.1v2h-1.1zM15.2 15.2h1.1v2h-1.1z'],
    ['h', 'M8.6 8.4l1.1 2.2 2.4.4-1.7 1.7.4 2.4-2.2-1.1-2.2 1.1.4-2.4-1.7-1.7 2.4-.4z'],
  ],
  // ---------------------------------------------------------------- gear slots
  weapon: [
    ['a', 'M18.6 2.5h2.9v2.9L10.4 16.5l-2.9-2.9z'],
    ['s', 'M19.8 4.2L9.4 14.6'],
    ['b', 'M4.4 12.1l7.5 7.5-1.6 1.6-7.5-7.5z'],
    ['a', 'M6.4 16l1.6 1.6-3.7 3.7-1.6-1.6z'],
    ['a', circle(2.9, 21.1, 1.5)],
  ],
  armor: [
    ['a', 'M5 3l4 2h6l4-2 2.4 4.2-2.4 3V19l-7 3.2L5 19v-8.8l-2.4-3z'],
    ['d', 'M11.3 5.5h1.4v16.3h-1.4z'],
    ['h', 'M7.2 8.4l3 1v9.2l-3-1.3z'],
    ['b', 'M5 10.2l14 0v1.6H5z'],
  ],
  helmet: [
    ['a', 'M4 13.5a8 8 0 0 1 16 0v5.5l-3 2.4H7L4 19z'],
    ['d', 'M5.8 12.4h12.4v2.2H5.8z'],
    ['d', 'M11.2 15.6h1.6v5.6h-1.6z'],
    ['b', 'M11 2.6h2v6.2h-2z'],
    ['s', 'M7 10a6 6 0 0 1 3.2-3.6'],
  ],
  gloves: [
    [
      'a',
      'M7 21.5v-6L5 11V6.5a1.5 1.5 0 0 1 3 0V10h1V4.5a1.5 1.5 0 0 1 3 0V10h1V5.5a1.5 1.5 0 0 1 3 0v5.6l1-1.8a1.5 1.5 0 0 1 2.6 1.5L17 16v5.5z',
    ],
    ['d', 'M7 18.2h10v3.3H7z'],
    ['h', 'M8 12.2h8v1.3H8z'],
  ],
  ring: [
    ['a', `${circle(12, 15, 7)}${circle(12, 15, 4.3)}`],
    ['b', 'M8.6 3h6.8l2 3.2-5.4 4.4-5.4-4.4z'],
    ['h', 'M10 3.4h2.4l-1.2 3.4z'],
    ['s', 'M6.6 13a5.6 5.6 0 0 1 2.2-3'],
  ],
  amulet: [
    ['l', 'M5 2c0 6 3 9.2 7 10.2M19 2c0 6-3 9.2-7 10.2'],
    ['a', 'M12 10.6l5.4 5.4-5.4 6.4-5.4-6.4z'],
    ['h', 'M12 13l2.8 3-2.8 3.4z'],
    ['b', circle(12, 11, 1.6)],
  ],
  // ---------------------------------------------------------------- modes
  sword: [
    ['a', 'M18.6 2.5h2.9v2.9L10.4 16.5l-2.9-2.9z'],
    ['s', 'M19.8 4.2L9.4 14.6'],
    ['b', 'M4.4 12.1l7.5 7.5-1.6 1.6-7.5-7.5z'],
    ['a', 'M6.4 16l1.6 1.6-3.7 3.7-1.6-1.6z'],
  ],
  dungeon: [
    ['b', 'M4 21.5V10a8 8 0 0 1 16 0v11.5z'],
    ['d', 'M7 21.5V10.5a5 5 0 0 1 10 0v11z'],
    ['l', 'M9 21.5v-8M12 21.5V8.5M15 21.5v-8M7 13.5h10M2.5 21.5h19'],
  ],
  crown: [
    ['a', 'M3 17l-1-10 5.5 4L12 3.5 16.5 11 22 7l-1 10z'],
    ['b', 'M3 18h18v3H3z'],
    ['h', circle(12, 13, 1.6)],
    ['h', 'M6.4 17l.5-3.2 1 1.4z'],
  ],
  claw: [
    ['a', 'M5.5 3.5c3.3 4.4 3.3 10.6-.6 17l1.6.6c4-6.6 4.3-13-.1-18.2z'],
    ['a', 'M11 2.5c3.3 5.2 3.3 11.6-.6 19l1.6.6c4-7.6 4.3-14.2-.1-20.2z'],
    ['a', 'M16.5 3.5c3.3 4.4 3.3 10.6-.6 17l1.6.6c4-6.6 4.3-13-.1-18.2z'],
  ],
  arena: [
    ['l', 'M4 4l10.5 10.5M20 4 9.5 14.5'],
    ['a', 'M6 12.2l5.8 5.8-1.6 1.6-5.8-5.8zM18 12.2l1.6 1.6-5.8 5.8-1.6-1.6z'],
    ['a', `${circle(4.2, 19.8, 1.6)}${circle(19.8, 19.8, 1.6)}`],
  ],
  tower: [
    ['a', 'M7 21.5V9h10v12.5z'],
    ['b', 'M6 9V4h2.2v2h2.3V4h3v2h2.3V4H18v5z'],
    ['d', 'M10.8 21.5v-4.2a1.2 1.2 0 0 1 2.4 0v4.2zM10.6 11.6h2.8v2.4h-2.8z'],
    ['l', 'M4.5 21.5h15'],
  ],
  endless: [
    [
      'l',
      'M7 8.5C5 8.5 3.5 10 3.5 12S5 15.5 7 15.5c3.5 0 6.5-7 10-7 2 0 3.5 1.5 3.5 3.5S19 15.5 17 15.5c-3.5 0-6.5-7-10-7z',
    ],
  ],
  // ---------------------------------------------------------------- menus
  shield: [
    ['a', 'M12 2.5l8.5 3.2v5.5c0 5.2-3.6 8.8-8.5 10.3-4.9-1.5-8.5-5.1-8.5-10.3V5.7z'],
    ['h', 'M12 2.5v19L3.5 11.2V5.7z'],
    ['d', 'M11.2 6h1.6v12h-1.6zM6 10.4h12v1.6H6z'],
  ],
  star: [
    ['a', 'M12 2.5l2.6 6.4 6.9.6-5.2 4.5 1.6 6.8L12 17.2l-5.9 3.6 1.6-6.8-5.2-4.5 6.9-.6z'],
    ['h', 'M12 2.5l2.6 6.4L12 12z'],
  ],
  book: [
    ['a', 'M5 3.5h11a3 3 0 0 1 3 3v14H8a3 3 0 0 1-3-3z'],
    ['h', 'M5 17.5a3 3 0 0 1 3-3h11v1.5H8a1.5 1.5 0 0 0 0 3h11v1.5H8a3 3 0 0 1-3-3z'],
    ['d', 'M9 7h6v1.4H9zM9 10h4v1.4H9z'],
  ],
  cog: [
    [
      'a',
      'M10.3 2h3.4l.5 2.6 1.9.8 2.2-1.5 2.4 2.4-1.5 2.2.8 1.9 2.6.5v3.4l-2.6.5-.8 1.9 1.5 2.2-2.4 2.4-2.2-1.5-1.9.8-.5 2.6h-3.4l-.5-2.6-1.9-.8-2.2 1.5-2.4-2.4 1.5-2.2-.8-1.9L2 13.7v-3.4l2.6-.5.8-1.9-1.5-2.2 2.4-2.4 2.2 1.5 1.9-.8z',
    ],
    ['d', circle(12, 12, 3.6)],
    ['s', 'M6.5 9a6 6 0 0 1 3-3'],
  ],
  bolt: [
    ['a', 'M13.5 1.5 3.5 14h7.2l-1.2 8.5 10-12.5h-7.2z'],
    ['h', 'M13.5 1.5 3.5 14h3.4z'],
  ],
  flame: [
    [
      'b',
      'M12 2.5c1 4 6.5 6 6.5 11.5a6.5 6.5 0 0 1-13 0c0-3 2-4.4 3-7.2 1 2 2 3 3 3 0-2-1-5.2.5-7.3z',
    ],
    [
      'a',
      'M12 10c.6 2.2 3.6 3.4 3.6 6.2a3.6 3.6 0 0 1-7.2 0c0-1.7 1.1-2.5 1.7-4 .5 1 1.1 1.6 1.7 1.6 0-1.1-.5-2.6.2-3.8z',
    ],
  ],
  lock: [
    ['l', 'M8 11V7.8a4 4 0 0 1 8 0V11'],
    ['a', 'M5 10.5h14v11H5z'],
    ['d', `${circle(12, 15, 1.6)}M11.3 15.5h1.4v3h-1.4z`],
  ],
  play: [['a', 'M8 5v14l11-7z']],
  shop: [
    ['b', 'M8.5 3h7l-1.2 4.5H9.7z'],
    ['a', 'M7 7.5h10c2 3 4.5 7.5 4.5 10.5a3 3 0 0 1-3 3h-13a3 3 0 0 1-3-3c0-3 2.5-7.5 4.5-10.5z'],
    ['d', 'M6.6 6.8h10.8v1.6H6.6z'],
    ['h', 'M12 11.2l1.9 3.3L12 18.4l-1.9-3.9z'],
  ],
  pet: [
    [
      'a',
      'M12 11.5c3.2 0 6.4 3.4 6.4 6.6a3 3 0 0 1-3 3c-1.2 0-2.2-.7-3.4-.7s-2.2.7-3.4.7a3 3 0 0 1-3-3c0-3.2 3.2-6.6 6.4-6.6z',
    ],
    [
      'a',
      `${circle(4.6, 10.4, 2)}${circle(9, 5.6, 2.2)}${circle(15, 5.6, 2.2)}${circle(19.4, 10.4, 2)}`,
    ],
    ['h', 'M9.4 15a3.6 3.6 0 0 1 2.6-1.6'],
  ],
  chest: [
    ['b', 'M3 11c0-3.6 4-6 9-6s9 2.4 9 6z'],
    ['a', 'M3 11h18v9.5H3z'],
    ['d', 'M7 5.6h1.6v14.9H7zM15.4 5.6H17v14.9h-1.6z'],
    ['h', 'M10.4 9.6h3.2v4.4h-3.2z'],
  ],
  egg: [
    ['a', 'M12 2c4.2 0 7.4 7.2 7.4 12.3a7.4 7.4 0 0 1-14.8 0C4.6 9.2 7.8 2 12 2z'],
    ['d', `${circle(9, 13, 1.4)}${circle(14.6, 9.4, 1.1)}${circle(14, 17, 1.7)}`],
    ['s', 'M8.6 6.8C7.4 8.6 6.8 10.6 6.6 12.6'],
  ],
  scroll: [
    ['a', 'M6 3.5h12v14a3 3 0 0 1-3 3H4a3 3 0 0 0 2-3z'],
    ['b', 'M18 3.5a2.5 2.5 0 0 1 0 5h-2'],
    ['d', 'M8.5 7.5h6v1.4h-6zM8.5 10.5h6v1.4h-6zM8.5 13.5h4v1.4h-4z'],
  ],
  swap: [['l', 'M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4']],
  sparkle: [
    ['a', 'M12 1.5l2.4 7.1 7.1 2.4-7.1 2.4L12 20.5l-2.4-7.1L2.5 11l7.1-2.4z'],
    ['h', 'M12 1.5l2.4 7.1L12 11z'],
  ],
  heart: [
    [
      'a',
      'M12 21C5.5 16.4 2.5 12.8 2.5 8.8A4.8 4.8 0 0 1 12 6.4a4.8 4.8 0 0 1 9.5 2.4c0 4-3 7.6-9.5 12.2z',
    ],
    ['s', 'M5.4 7.6a2.6 2.6 0 0 1 2.4-1.6'],
  ],
  check: [['l', 'M4.5 12.5l5 5 10-11']],
  sort: [['l', 'M7 4v16M3.5 16.5L7 20l3.5-3.5M14 6h7M14 11h5M14 16h3']],
} as const satisfies Record<string, readonly Layer[]>;

export type IconName = keyof typeof ICONS;

import type { Currency } from '../data/economy';

const SVG = 'http://www.w3.org/2000/svg';

/** An icon element (class `icon icon-<name>` plus `cls`). */
export function icon(name: IconName, cls = ''): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `icon icon-${name}${cls === '' ? '' : ` ${cls}`}`);
  for (const [kind, d] of ICONS[name] as readonly Layer[]) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', `ic-${kind}`);
    path.setAttribute('fill-rule', 'evenodd');
    svg.append(path);
  }
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
export function iconBox(cls: string, name: IconName): HTMLElement {
  const div = document.createElement('div');
  div.className = cls;
  div.append(icon(name));
  return div;
}
