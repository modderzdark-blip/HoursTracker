/**
 * Line icons for the menus (24 × 24, drawn with the text colour). Built as SVG elements, so they
 * stay sharp at any size and need no image files.
 */
const PATHS = {
  sword: 'M19 3h2v2L9.5 16.5l-2-2zM6 13l5 5M4.5 19.5l3-3M3 21l1.5-1.5',
  dungeon: 'M5 21V10a7 7 0 0 1 14 0v11M3 21h18M9 21v-7M12 21V8M15 21v-7M7.5 13h9',
  crown: 'M3 19h18M4 16 3 7l5 4 4-7 4 7 5-4-1 9z',
  claw: 'M6 4c2.5 4 2.5 10-1 16M11.5 3c2.5 5 2.5 11-1 18M17 4c2.5 4 2.5 10-1 16',
  arena: 'M4 4l10.5 10.5M20 4 9.5 14.5M7 13l4 4M17 13l-4 4M5.5 18.5l-2 2M18.5 18.5l2 2',
  tower: 'M7 21V9h10v12M5 21h14M7 9V4h2v2h2V4h2v2h2V4h2v5M11 21v-4h2v4M10.5 12.5h3',
  endless:
    'M7 8.5C5 8.5 3.5 10 3.5 12S5 15.5 7 15.5c3.5 0 6.5-7 10-7 2 0 3.5 1.5 3.5 3.5S19 15.5 17 15.5c-3.5 0-6.5-7-10-7z',
  helmet: 'M4 14a8 8 0 0 1 16 0v4l-3 2v-5H7v5l-3-2zM12 6v7',
  shield: 'M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z',
  star: 'M12 2.5l2.6 6.4 6.9.6-5.2 4.5 1.6 6.8L12 17.2l-5.9 3.6 1.6-6.8-5.2-4.5 6.9-.6z',
  book: 'M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10M9 8h5',
  cog: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  flame: 'M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-4 3-7 1 2 2 3 3 3 0-2-1-5 0-7z',
  lock: 'M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  play: 'M8 5v14l11-7z',
} as const;

export type IconName = keyof typeof PATHS;

const SVG = 'http://www.w3.org/2000/svg';

/** An icon element (class `icon icon-<name>` plus `cls`). */
export function icon(name: IconName, cls = ''): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `icon icon-${name}${cls === '' ? '' : ` ${cls}`}`);
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', PATHS[name]);
  svg.append(path);
  return svg;
}
