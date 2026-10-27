// Renders the Android launcher icons and splash screens from the game's icon art (a gold sword
// over an ember flame on a glowing dark ground). Usage: node tools/icons/appicon.mjs
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const res = new URL('../../android/app/src/main/res/', import.meta.url);
const src = readFileSync(new URL('../../src/ui/iconPaths.ts', import.meta.url), 'utf8');
const path = (key) => {
  const m = new RegExp(`\\n  ${key}:\\s*'([^']+)'`).exec(src);
  if (m === null) throw new Error(`no icon ${key}`);
  return m[1];
};
const SWORD = path('weapon');
const FLAME = path('flame');

const defs = `<defs>
  <radialGradient id="bg" cx="50%" cy="56%" r="70%">
    <stop offset="0" stop-color="#ff8a32"/><stop offset="0.22" stop-color="#c2410f"/>
    <stop offset="0.55" stop-color="#4a1206"/><stop offset="1" stop-color="#120604"/>
  </radialGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="0.3" y2="1">
    <stop offset="0" stop-color="#fff6c8"/><stop offset="0.38" stop-color="#f6cf5a"/>
    <stop offset="0.72" stop-color="#c98a1e"/><stop offset="1" stop-color="#6e3f08"/>
  </linearGradient>
  <linearGradient id="ember" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fff3b8"/><stop offset="0.4" stop-color="#ffad48"/>
    <stop offset="0.8" stop-color="#d2481a"/><stop offset="1" stop-color="#5a1606"/>
  </linearGradient>
  <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
  <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="18"/></filter>
</defs>`;

/** The emblem (flame + sword) in a 512 frame, scaled by `k` around the centre of a `size` box. */
function emblem(size, k) {
  const s = (size / 512) * k;
  const o = (size - 512 * s) / 2;
  const t = `translate(${o} ${o}) scale(${s})`;
  return `<g transform="${t}">
    <g transform="translate(256 236) scale(1.08) translate(-256 -256)">
      <path d="${FLAME}" fill="#ff6a1a" opacity="0.6" filter="url(#glow)"/>
      <path d="${FLAME}" fill="url(#ember)" stroke="#1a0804" stroke-width="12" stroke-linejoin="round"/>
    </g>
    <g transform="translate(256 268) rotate(-45) scale(0.9) translate(-256 -256)">
      <path d="${SWORD}" fill="#1a0804" stroke="#1a0804" stroke-width="34" stroke-linejoin="round"/>
      <path d="${SWORD}" fill="url(#gold)"/>
      <path d="${SWORD}" fill="url(#gloss)"/>
    </g>
  </g>`;
}

function embers(size, n, seed) {
  let x = seed;
  const r = () => (x = (x * 16807) % 2147483647) / 2147483647;
  let out = '';
  for (let i = 0; i < n; i++)
    out += `<circle cx="${(r() * size).toFixed(1)}" cy="${(r() * size).toFixed(1)}" r="${(size * (0.004 + r() * 0.006)).toFixed(1)}" fill="#ffc070" opacity="${(0.3 + r() * 0.6).toFixed(2)}"/>`;
  return out;
}

/** Full-bleed square art (adaptive foreground, legacy icons). */
function square(size, emblemScale) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${defs}
    <rect width="${size}" height="${size}" fill="url(#bg)"/>${embers(size, 26, 7)}${emblem(size, emblemScale)}
    <rect x="${size * 0.02}" y="${size * 0.02}" width="${size * 0.96}" height="${size * 0.96}" rx="${size * 0.2}" fill="none" stroke="#e8be6e" stroke-opacity="0.55" stroke-width="${size * 0.015}"/>
  </svg>`;
}

async function png(svg, file, mask) {
  let img = sharp(Buffer.from(svg));
  if (mask !== undefined) img = img.composite([{ input: Buffer.from(mask), blend: 'dest-in' }]);
  await img.png().toFile(new URL(file, res).pathname);
}

const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(densities)) {
  const legacy = Math.round(48 * k);
  const fg = Math.round(108 * k);
  // Adaptive foreground: art fills the layer; the emblem stays in the 66 dp safe zone.
  await png(
    square(fg, 0.62).replace(/<rect x=[^>]+\/>\s*<\/svg>/, '</svg>'),
    `mipmap-${d}/ic_launcher_foreground.png`,
  );
  const round = `<svg xmlns="http://www.w3.org/2000/svg" width="${legacy}" height="${legacy}"><circle cx="${legacy / 2}" cy="${legacy / 2}" r="${legacy / 2}" fill="#fff"/></svg>`;
  const rounded = `<svg xmlns="http://www.w3.org/2000/svg" width="${legacy}" height="${legacy}"><rect width="${legacy}" height="${legacy}" rx="${legacy * 0.2}" fill="#fff"/></svg>`;
  await png(square(legacy, 0.84), `mipmap-${d}/ic_launcher.png`, rounded);
  await png(square(legacy, 0.84), `mipmap-${d}/ic_launcher_round.png`, round);
}

// Splash screens: the emblem on the dark ground, at every size the project already ships.
const splashes = [
  ['drawable/splash.png', 480, 320],
  ...['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'].flatMap((d) => [
    [`drawable-land-${d}/splash.png`],
    [`drawable-port-${d}/splash.png`],
  ]),
];
for (const [file, w0, h0] of splashes) {
  let w = w0;
  let h = h0;
  if (w === undefined) {
    const meta = await sharp(new URL(file, res).pathname).metadata();
    w = meta.width;
    h = meta.height;
  }
  const e = Math.min(w, h) * 0.42;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${defs}
    <radialGradient id="sbg" cx="50%" cy="50%" r="65%"><stop offset="0" stop-color="#5a1a08"/><stop offset="0.5" stop-color="#1e0a06"/><stop offset="1" stop-color="#07060a"/></radialGradient>
    <rect width="${w}" height="${h}" fill="url(#sbg)"/>${embers(Math.max(w, h), 40, 11)}
    <g transform="translate(${(w - e) / 2} ${(h - e) / 2})">${emblem(e, 1)}</g></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(new URL(file, res).pathname);
}
console.log('launcher icons and splash screens written');
