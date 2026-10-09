// Renders every shaded sprite in every theme to one PNG contact sheet (art quality gate, Section 4.4).
// Usage: node scripts/sprite-sheet.mjs [out.png] [size]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const SPRITES = require('../www/js/sprites.js');

const out_path = process.argv[2] || 'sprite-sheet.png';
const size = Number(process.argv[3] || 128);

function crc32(buffer) {
  let crc = ~0;
  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index];
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, payload) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + row * width * 4, width * 4).copy(raw, row * (width * 4 + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function main() {
  const themes = SPRITES.THEME_IDS;
  const keys = Object.keys(SPRITES.recipes('gummy', false));
  const columns = 9;
  const rows_per_theme = Math.ceil(keys.length / columns);
  const width = columns * size;
  const height = rows_per_theme * themes.length * size;
  const sheet = new Uint8ClampedArray(width * height * 4);
  // Board-like background so translucency and shadows read as in the game.
  for (let index = 0; index < width * height; index += 1) {
    const x = index % width;
    const y = Math.floor(index / width);
    const checker = (Math.floor(x / size) + Math.floor(y / size)) % 2 === 0;
    sheet[index * 4] = checker ? 92 : 78;
    sheet[index * 4 + 1] = checker ? 70 : 58;
    sheet[index * 4 + 2] = checker ? 150 : 130;
    sheet[index * 4 + 3] = 255;
  }
  const started = Date.now();
  themes.forEach((theme, theme_index) => {
    const list = SPRITES.recipes(theme, false);
    keys.forEach((key, key_index) => {
      const shaded = SPRITES.shadeSprite(list[key], size);
      const origin_x = (key_index % columns) * size;
      const origin_y = (theme_index * rows_per_theme + Math.floor(key_index / columns)) * size;
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const source = (y * size + x) * 4;
          const target = ((origin_y + y) * width + origin_x + x) * 4;
          const alpha = shaded.data[source + 3] / 255;
          for (let channel = 0; channel < 3; channel += 1) sheet[target + channel] = shaded.data[source + channel] * alpha + sheet[target + channel] * (1 - alpha);
        }
      }
    });
  });
  fs.writeFileSync(out_path, encodePng(width, height, sheet));
  console.log(`wrote ${out_path} (${width}x${height}, ${keys.length} sprites x ${themes.length} themes in ${Date.now() - started} ms)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
