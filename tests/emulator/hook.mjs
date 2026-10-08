// Reads the newest "SCTEST {json}" snapshot from a logcat dump and evaluates an expression against it.
// Usage: node tests/emulator/hook.mjs <logcat-dump> '<expression using s>'
// Examples: 's.state'   's.modal === "pause"'   'px(s.buttons["btn-resume"])'   'swipe(s.move)'
import fs from 'node:fs';

const [dump_path, expression] = process.argv.slice(2);
const lines = fs.existsSync(dump_path) ? fs.readFileSync(dump_path, 'utf8').split('\n') : [];
let snapshot = null;
for (let index = lines.length - 1; index >= 0; index -= 1) {
  const marker = lines[index].indexOf('SCTEST ');
  if (marker < 0) continue;
  try {
    snapshot = JSON.parse(lines[index].slice(marker + 7).trim());
    break;
  } catch (parse_error) {
    // truncated line: keep looking further back
  }
}
if (!snapshot) {
  console.log('null');
  process.exit(0);
}
const s = snapshot;
const dpr = s.dpr || 1;
// CSS px -> device px (the WebView is full-screen at the origin in immersive mode).
const px = (point) => (point ? `${Math.round(point[0] * dpr)} ${Math.round(point[1] * dpr)}` : 'none');
const swipe = (points) => (points ? points.map((value) => Math.round(value * dpr)).join(' ') : 'none');
// eslint-disable-next-line no-new-func
const result = new Function('s', 'px', 'swipe', `return (${expression});`)(s, px, swipe);
console.log(typeof result === 'object' ? JSON.stringify(result) : String(result));
