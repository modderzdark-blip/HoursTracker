// Generates the Android launcher icons, the Android 13+ monochrome layer, the 512 px store icon and the
// Android 12+ splash icon from the game's own per-pixel candy sprites (www/js/sprites.js), rendered in Chromium.
// Usage: node scripts/generate-icons.mjs   (needs the @playwright/test dev dependency and a Chromium build)
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><html><body></body></html>');
await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, 'www', 'js', 'sprites.js'), 'utf8') });

/** Paints one icon variant in the page and returns PNG bytes. */
async function render(kind, size) {
  const data_url = await page.evaluate(({ kind, size }) => {
    const SPRITES = window.SC.SPRITES;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const recipes = SPRITES.recipes('gummy', false);
    const bean = recipes['candy:0'];
    const lemon = recipes['candy:2'];

    function paintBackground(context, extent, shape) {
      context.save();
      if (shape === 'circle') {
        context.beginPath();
        context.arc(extent / 2, extent / 2, extent / 2, 0, Math.PI * 2);
        context.clip();
      } else if (shape === 'rounded') {
        context.clip(SPRITES.roundedRectPath(new Path2D(), 0, 0, extent, extent, extent * 0.22));
      }
      const gradient = context.createLinearGradient(0, 0, extent, extent);
      gradient.addColorStop(0, '#ff8fcf');
      gradient.addColorStop(0.5, '#ffd36e');
      gradient.addColorStop(1, '#7fdcff');
      context.fillStyle = gradient;
      context.fillRect(0, 0, extent, extent);
      const glow = context.createRadialGradient(extent * 0.45, extent * 0.38, 0, extent * 0.45, extent * 0.38, extent * 0.62);
      glow.addColorStop(0, 'rgba(255,255,255,0.55)');
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = glow;
      context.fillRect(0, 0, extent, extent);
      [[0.18, 0.2, 0.09], [0.84, 0.18, 0.06], [0.8, 0.82, 0.1], [0.14, 0.8, 0.05]].forEach(([x, y, r]) => {
        const dot = context.createRadialGradient(x * extent, y * extent, 0, x * extent, y * extent, r * extent);
        dot.addColorStop(0, 'rgba(255,255,255,0.5)');
        dot.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = dot;
        context.fillRect(0, 0, extent, extent);
      });
      context.restore();
    }

    function sparkle(context, x, y, radius) {
      context.beginPath();
      for (let index = 0; index < 8; index += 1) {
        const angle = (index / 8) * Math.PI * 2 - Math.PI / 2;
        const reach = index % 2 === 0 ? radius : radius * 0.32;
        const px = x + Math.cos(angle) * reach;
        const py = y + Math.sin(angle) * reach;
        if (index === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      }
      context.closePath();
      context.fill();
    }

    /** A shaded sprite of `spec` drawn centered at (x, y) with the given diameter and rotation. */
    function sprite(spec, x, y, diameter, rotation) {
      const pixels = Math.max(16, Math.round(diameter));
      // The shader's own contact shadow would be cut at the sprite's square edge; a canvas drop shadow fades out freely.
      const image = SPRITES.spriteToCanvas(Object.assign({}, spec, { no_shadow: true }), pixels);
      ctx.save();
      ctx.shadowColor = 'rgba(90, 20, 60, 0.35)';
      ctx.shadowBlur = diameter * 0.1;
      ctx.shadowOffsetY = diameter * 0.05;
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.drawImage(image, -diameter / 2, -diameter / 2, diameter, diameter);
      ctx.restore();
    }

    /** A plump Cherry Bean with a Lemon Drop and a sparkle, inside the 66 dp safe zone (unit = 1 dp). */
    function paintCandies(unit, center_x, center_y) {
      sprite(bean, center_x - 5 * unit, center_y + 8 * unit, 46 * unit, 0);
      sprite(lemon, center_x + 19 * unit, center_y - 19 * unit, 22 * unit, 0.18);
      ctx.fillStyle = '#ffffff';
      sparkle(ctx, center_x - 20 * unit, center_y - 18 * unit, 6 * unit);
    }

    /** The same composition as a flat white silhouette, straight from the candy shape distance fields. */
    function paintMonochrome(unit, center_x, center_y) {
      const image = ctx.createImageData(size, size);
      const shapes = [
        { sdf: SPRITES.SHAPE_SDF.bean, x: center_x - 5 * unit, y: center_y + 8 * unit, half: 23 * unit, rotation: 0 },
        { sdf: SPRITES.SHAPE_SDF.lemon, x: center_x + 19 * unit, y: center_y - 19 * unit, half: 11 * unit, rotation: 0.18 },
      ];
      for (let py = 0; py < size; py += 1) {
        for (let px = 0; px < size; px += 1) {
          let coverage = 0;
          shapes.forEach((shape) => {
            const dx = px + 0.5 - shape.x;
            const dy = py + 0.5 - shape.y;
            const cos = Math.cos(-shape.rotation);
            const sin = Math.sin(-shape.rotation);
            const local_x = (dx * cos - dy * sin) / shape.half;
            const local_y = (dx * sin + dy * cos) / shape.half;
            const distance = shape.sdf(local_x, local_y) * shape.half;
            coverage = Math.max(coverage, Math.min(1, Math.max(0, 0.5 - distance)));
          });
          const offset = (py * size + px) * 4;
          image.data[offset] = 255;
          image.data[offset + 1] = 255;
          image.data[offset + 2] = 255;
          image.data[offset + 3] = Math.round(coverage * 255);
        }
      }
      ctx.putImageData(image, 0, 0);
      ctx.fillStyle = '#ffffff';
      sparkle(ctx, center_x - 20 * unit, center_y - 18 * unit, 6 * unit);
    }

    const unit = size / 108; // adaptive icons are designed on a 108 dp grid
    if (kind === 'foreground') paintCandies(unit, size / 2, size / 2);
    else if (kind === 'background') paintBackground(ctx, size, 'square');
    else if (kind === 'monochrome') paintMonochrome(unit, size / 2, size / 2);
    else if (kind === 'legacy' || kind === 'round') {
      // Legacy icons are drawn on a 48 dp grid with no system mask: scale the 66 dp safe zone up to fill it.
      paintBackground(ctx, size, kind === 'round' ? 'circle' : 'rounded');
      paintCandies((size / 48) * (48 / 66) * 0.92, size / 2, size / 2);
    } else if (kind === 'store') {
      paintBackground(ctx, size, 'square');
      paintCandies((size / 66) * 0.9, size / 2, size / 2);
    } else if (kind === 'splash') {
      // 288 dp splash canvas: a 192 dp gradient disc with the candies (Android 12+ splash, no icon background).
      const disc = size * (192 / 288);
      ctx.save();
      ctx.translate((size - disc) / 2, (size - disc) / 2);
      paintBackground(ctx, disc, 'circle');
      ctx.restore();
      paintCandies((disc / 108) * 1.3, size / 2, size / 2);
    }
    return canvas.toDataURL('image/png');
  }, { kind, size });
  return Buffer.from(data_url.split(',')[1], 'base64');
}

function write(file_path, bytes) {
  fs.mkdirSync(path.dirname(file_path), { recursive: true });
  fs.writeFileSync(file_path, bytes);
  console.log(`wrote ${path.relative(ROOT, file_path)} (${bytes.length} bytes)`);
}

for (const [density, factor] of Object.entries(DENSITIES)) {
  const adaptive = Math.round(108 * factor);
  const legacy = Math.round(48 * factor);
  write(path.join(RES, `mipmap-${density}`, 'ic_launcher_foreground.png'), await render('foreground', adaptive));
  write(path.join(RES, `mipmap-${density}`, 'ic_launcher_background.png'), await render('background', adaptive));
  write(path.join(RES, `mipmap-${density}`, 'ic_launcher_monochrome.png'), await render('monochrome', adaptive));
  write(path.join(RES, `mipmap-${density}`, 'ic_launcher.png'), await render('legacy', legacy));
  write(path.join(RES, `mipmap-${density}`, 'ic_launcher_round.png'), await render('round', legacy));
}
write(path.join(RES, 'drawable-xhdpi', 'splash_icon.png'), await render('splash', 576));
write(path.join(RES, 'drawable-xxxhdpi', 'splash_icon.png'), await render('splash', 1152));
write(path.join(ROOT, 'android', 'app', 'src', 'main', 'ic_launcher-playstore.png'), await render('store', 512));
write(path.join(ROOT, 'docs', 'icon-512.png'), await render('store', 512));
await browser.close();
