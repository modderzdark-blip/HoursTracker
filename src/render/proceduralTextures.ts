import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { mulberry32 } from '../core/random';

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (ctx === null) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function hex(color: number, shift: number): string {
  const r = Math.min(255, Math.max(0, ((color >> 16) & 255) + shift));
  const g = Math.min(255, Math.max(0, ((color >> 8) & 255) + shift));
  const b = Math.min(255, Math.max(0, (color & 255) + shift));
  return `rgb(${r},${g},${b})`;
}

function finish(c: HTMLCanvasElement, anisotropy: number, repeat: number, srgb: boolean): Texture {
  const tex = new CanvasTexture(c);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = anisotropy;
  if (srgb) tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Irregular flagstones with grout, wear and soot. Tileable. */
export function createFlagstoneTexture(
  size: number,
  base: number,
  anisotropy: number,
  repeat: number,
): Texture {
  const [c, ctx] = canvas(size);
  const rand = mulberry32(1337);
  ctx.fillStyle = hex(base, -14);
  ctx.fillRect(0, 0, size, size);
  const rows = 6;
  const cell = size / rows;
  for (let row = 0; row < rows; row++) {
    const offset = row % 2 === 0 ? 0 : cell * 0.5;
    for (let col = -1; col < rows + 1; col++) {
      const w = cell * (0.85 + rand() * 0.3);
      const x = col * cell + offset + (rand() - 0.5) * cell * 0.06;
      const y = row * cell + (rand() - 0.5) * cell * 0.04;
      const gap = Math.max(1, size / 220);
      ctx.fillStyle = hex(base, Math.round((rand() - 0.5) * 26));
      ctx.beginPath();
      ctx.roundRect(x + gap, y + gap, w - gap * 2, cell - gap * 2, cell * 0.06);
      ctx.fill();
      // Wrap horizontally so the texture tiles.
      if (x + w > size) {
        ctx.beginPath();
        ctx.roundRect(x - size + gap, y + gap, w - gap * 2, cell - gap * 2, cell * 0.06);
        ctx.fill();
      }
    }
  }
  // Speckle / wear.
  const speckles = Math.floor(size * size * 0.012);
  for (let i = 0; i < speckles; i++) {
    const s = rand() * 2.2 + 0.4;
    ctx.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.18)' : 'rgba(255,240,220,0.05)';
    ctx.fillRect(rand() * size, rand() * size, s, s);
  }
  // Cracks.
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(1, size / 400);
  for (let i = 0; i < 18; i++) {
    let x = rand() * size;
    let y = rand() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segs = 3 + Math.floor(rand() * 4);
    for (let s = 0; s < segs; s++) {
      x += (rand() - 0.5) * cell * 0.5;
      y += (rand() - 0.5) * cell * 0.5;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Soot blotches.
  for (let i = 0; i < 10; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = cell * (0.4 + rand() * 0.9);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,0.22)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return finish(c, anisotropy, repeat, true);
}

/** Rough stone noise for pillars, walls and rocks. */
export function createStoneTexture(size: number, base: number, anisotropy: number): Texture {
  const [c, ctx] = canvas(size);
  const rand = mulberry32(4242);
  ctx.fillStyle = hex(base, 0);
  ctx.fillRect(0, 0, size, size);
  const blots = Math.floor(size * 1.5);
  for (let i = 0; i < blots; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = (rand() * 0.06 + 0.01) * size;
    ctx.fillStyle = hex(base, Math.round((rand() - 0.5) * 34));
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Horizontal masonry courses.
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = Math.max(1, size / 256);
  const courses = 8;
  for (let i = 1; i < courses; i++) {
    const y = (i / courses) * size + (rand() - 0.5) * 3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }
  return finish(c, anisotropy, 1, true);
}

/**
 * Soft radial dot.
 * - 'alpha': white with alpha fading out (sampled via `.a`, e.g. particle shaders).
 * - 'luminance': opaque, white centre fading to black (for `alphaMap`, which reads the green channel).
 */
export function createRadialTexture(
  size: number,
  innerAlpha = 1,
  hardness = 0,
  mode: 'alpha' | 'luminance' = 'alpha',
): Texture {
  const [c, ctx] = canvas(size);
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, r * hardness, r, r, r);
  if (mode === 'alpha') {
    g.addColorStop(0, `rgba(255,255,255,${innerAlpha})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
  } else {
    const v = Math.round(innerAlpha * 255);
    g.addColorStop(0, `rgb(${v},${v},${v})`);
    g.addColorStop(1, 'rgb(0,0,0)');
    ctx.fillStyle = 'rgb(0,0,0)';
    ctx.fillRect(0, 0, size, size);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}
