// Generates the Android launcher icons, the Android 13+ monochrome layer, the 512 px store icon and the
// Android 12+ splash icon from the game's own procedural candy art (www/js/art.js), rendered in Chromium.
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
for (const file of ['config.js', 'util.js', 'art.js', 'render.js']) {
  await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, 'www', 'js', file), 'utf8') });
}

/** Paints one icon variant in the page and returns PNG bytes. */
async function render(kind, size) {
  const data_url = await page.evaluate(({ kind, size }) => {
    window.SC.ART_FORCE_DOM_CANVAS = true;
    const ART = window.SC.ART;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const unit = size / 108; // adaptive icons are designed on a 108 dp grid

    function paintBackground(shape) {
      ctx.save();
      if (shape === 'circle') {
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        ctx.clip();
      } else if (shape === 'rounded') {
        ctx.clip(ART.roundedRectPath(new Path2D(), 0, 0, size, size, size * 0.22));
      }
      const gradient = ctx.createLinearGradient(0, 0, size, size);
      gradient.addColorStop(0, '#ff8fcf');
      gradient.addColorStop(0.5, '#ffd36e');
      gradient.addColorStop(1, '#7fdcff');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
      const glow = ctx.createRadialGradient(size * 0.45, size * 0.38, 0, size * 0.45, size * 0.38, size * 0.62);
      glow.addColorStop(0, 'rgba(255,255,255,0.55)');
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, size, size);
      [[0.18, 0.2, 0.09], [0.84, 0.18, 0.06], [0.8, 0.82, 0.1], [0.14, 0.8, 0.05]].forEach(([x, y, r]) => {
        const dot = ctx.createRadialGradient(x * size, y * size, 0, x * size, y * size, r * size);
        dot.addColorStop(0, 'rgba(255,255,255,0.5)');
        dot.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = dot;
        ctx.fillRect(0, 0, size, size);
      });
      ctx.restore();
    }

    function paintCandies(scale) {
      // A plump cherry jelly bean with a grape gem and a sparkle, inside the 66 dp safe zone.
      const center_x = size / 2;
      const center_y = size / 2;
      const bean = window.SC.CONFIG.CANDIES[0];
      const gem = window.SC.CONFIG.CANDIES[5];
      ctx.save();
      ctx.translate(center_x - 3 * unit * scale, center_y + 3 * unit * scale);
      ctx.rotate(-0.12);
      ART.paintCandy(ctx, 0, 0, 25 * unit * scale, bean, { theme: 'classic', scale: unit * 1.15 * scale });
      ctx.restore();
      ART.paintCandy(ctx, center_x + 17 * unit * scale, center_y - 15 * unit * scale, 10 * unit * scale, gem, { theme: 'classic', scale: unit * 0.7 * scale, skip_shadow: true });
      ctx.fillStyle = '#ffffff';
      window.SC.RENDER.drawStar(ctx, center_x - 19 * unit * scale, center_y - 18 * unit * scale, 5 * unit * scale, 0, 4);
    }

    function paintMonochrome() {
      ctx.fillStyle = '#ffffff';
      ctx.save();
      ctx.translate(size / 2 - 3 * unit, size / 2 + 3 * unit);
      ctx.rotate(-0.12);
      ctx.fill(ART.SHAPES.bean(25 * unit));
      ctx.restore();
      ctx.save();
      ctx.translate(size / 2 + 17 * unit, size / 2 - 15 * unit);
      ctx.fill(ART.SHAPES.hexagon(10 * unit));
      ctx.restore();
      window.SC.RENDER.drawStar(ctx, size / 2 - 19 * unit, size / 2 - 18 * unit, 5 * unit, 0, 4);
    }

    if (kind === 'foreground') paintCandies(1);
    else if (kind === 'background') paintBackground('square');
    else if (kind === 'monochrome') paintMonochrome();
    else if (kind === 'legacy') {
      paintBackground('rounded');
      paintCandies(1.32);
    } else if (kind === 'round') {
      paintBackground('circle');
      paintCandies(1.32);
    } else if (kind === 'store') {
      paintBackground('square');
      paintCandies(1.45);
    } else if (kind === 'splash') {
      // 288 dp splash canvas: a 192 dp gradient disc with the candy (Android 12+ splash, no icon background).
      const disc = size * (192 / 288);
      ctx.save();
      ctx.translate((size - disc) / 2, (size - disc) / 2);
      const saved = size;
      ctx.beginPath();
      ctx.arc(disc / 2, disc / 2, disc / 2, 0, Math.PI * 2);
      ctx.clip();
      const gradient = ctx.createLinearGradient(0, 0, disc, disc);
      gradient.addColorStop(0, '#ff8fcf');
      gradient.addColorStop(0.5, '#ffd36e');
      gradient.addColorStop(1, '#7fdcff');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, disc, disc);
      const glow = ctx.createRadialGradient(disc * 0.45, disc * 0.38, 0, disc * 0.45, disc * 0.38, disc * 0.6);
      glow.addColorStop(0, 'rgba(255,255,255,0.55)');
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, disc, disc);
      ctx.restore();
      const splash_unit = disc / 108;
      const center = saved / 2;
      ctx.save();
      ctx.translate(center - 3 * splash_unit, center + 3 * splash_unit);
      ctx.rotate(-0.12);
      ART.paintCandy(ctx, 0, 0, 34 * splash_unit, window.SC.CONFIG.CANDIES[0], { theme: 'classic', scale: splash_unit * 1.5 });
      ctx.restore();
      ART.paintCandy(ctx, center + 24 * splash_unit, center - 21 * splash_unit, 13 * splash_unit, window.SC.CONFIG.CANDIES[5], { theme: 'classic', scale: splash_unit * 0.9, skip_shadow: true });
      ctx.fillStyle = '#ffffff';
      window.SC.RENDER.drawStar(ctx, center - 26 * splash_unit, center - 25 * splash_unit, 7 * splash_unit, 0, 4);
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
