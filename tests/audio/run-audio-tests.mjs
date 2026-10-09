// Audio safety tests (CI job "audio"): every sound in Section 14.2, a worst-case stress mix (6 effects + music) and two
// loops of each music track are rendered with an OfflineAudioContext in Chromium at the WORST-CASE settings
// (all volumes at maximum, Soft Sounds off), then measured here:
//   peak <= 0.25 for effects (0.10 for music); first and last 2 ms <= 0.002 (no clicks); largest sample-to-sample jump
//   <= 0.08; spectral energy above 4 kHz < 3% and above 6 kHz < 0.5%; spectral centroid < 1.8 kHz; audible length close
//   to the spec; smooth envelope (no abrupt cut); the music loop seam is continuous.
// Prints a table and writes audio-report.json / audio-report.txt. Any failure exits non-zero: fix the sound, not the limit.
// Usage: node tests/audio/run-audio-tests.mjs [out_dir]
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const OUT_DIR = path.resolve(process.argv[2] || 'audio-report');
const LIMITS = { peak_effects: 0.25, peak_music: 0.1, edge: 0.002, jump: 0.08, above_4k: 0.03, above_6k: 0.005, centroid: 1800 };

function fft(real, imag) {
  const size = real.length;
  for (let index = 1, swap = 0; index < size; index += 1) {
    let bit = size >> 1;
    for (; swap & bit; bit >>= 1) swap ^= bit;
    swap ^= bit;
    if (index < swap) {
      [real[index], real[swap]] = [real[swap], real[index]];
      [imag[index], imag[swap]] = [imag[swap], imag[index]];
    }
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const w_real = Math.cos(angle);
    const w_imag = Math.sin(angle);
    for (let start = 0; start < size; start += length) {
      let cur_real = 1;
      let cur_imag = 0;
      for (let k = 0; k < length / 2; k += 1) {
        const a = start + k;
        const b = a + length / 2;
        const t_real = real[b] * cur_real - imag[b] * cur_imag;
        const t_imag = real[b] * cur_imag + imag[b] * cur_real;
        real[b] = real[a] - t_real;
        imag[b] = imag[a] - t_imag;
        real[a] += t_real;
        imag[a] += t_imag;
        const next_real = cur_real * w_real - cur_imag * w_imag;
        cur_imag = cur_real * w_imag + cur_imag * w_real;
        cur_real = next_real;
      }
    }
  }
}

/** Power spectrum summed over Hann-windowed frames of 2048 samples (50% overlap). */
function spectrum(samples, sample_rate) {
  const frame = 2048;
  const power = new Float64Array(frame / 2);
  const window = Float64Array.from({ length: frame }, (unused, index) => 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (frame - 1)));
  for (let start = 0; start + frame <= samples.length; start += frame / 2) {
    const real = new Float64Array(frame);
    const imag = new Float64Array(frame);
    for (let index = 0; index < frame; index += 1) real[index] = samples[start + index] * window[index];
    fft(real, imag);
    for (let bin = 0; bin < frame / 2; bin += 1) power[bin] += real[bin] * real[bin] + imag[bin] * imag[bin];
  }
  let total = 0;
  let above_4k = 0;
  let above_6k = 0;
  let weighted = 0;
  for (let bin = 1; bin < frame / 2; bin += 1) {
    const frequency = (bin * sample_rate) / frame;
    total += power[bin];
    weighted += power[bin] * frequency;
    if (frequency > 4000) above_4k += power[bin];
    if (frequency > 6000) above_6k += power[bin];
  }
  return { above_4k: total ? above_4k / total : 0, above_6k: total ? above_6k / total : 0, centroid: total ? weighted / total : 0 };
}

function measure(samples, sample_rate) {
  const edge_count = Math.round(sample_rate * 0.002);
  let peak = 0;
  let jump = 0;
  let edge = 0;
  let last_audible = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.abs(samples[index]);
    if (value > peak) peak = value;
    if (value > 0.001) last_audible = index;
    if (index > 0) jump = Math.max(jump, Math.abs(samples[index] - samples[index - 1]));
    if (index < edge_count || index >= samples.length - edge_count) edge = Math.max(edge, value);
  }
  // Envelope smoothness: the RMS of consecutive 5 ms windows never collapses by more than 40 dB from one to the next while loud.
  const window_size = Math.round(sample_rate * 0.005);
  let abrupt = 0;
  let previous = 0;
  for (let start = 0; start + window_size <= samples.length; start += window_size) {
    let sum = 0;
    for (let index = start; index < start + window_size; index += 1) sum += samples[index] * samples[index];
    const rms = Math.sqrt(sum / window_size);
    if (previous > 0.01 && rms < previous * 0.01) abrupt += 1;
    previous = rms;
  }
  return { peak, jump, edge, audible_ms: (last_audible / sample_rate) * 1000, abrupt, ...spectrum(samples, sample_rate) };
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><html><body></body></html>');
await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, 'www', 'js', 'audio.js'), 'utf8') });
const names = await page.evaluate(() => Object.keys(window.SC.AUDIO.SOUNDS).filter((name) => name !== 'click'));
const specs = await page.evaluate(() => {
  const out = {};
  Object.keys(window.SC.AUDIO.SOUNDS).forEach((name) => { out[name] = window.SC.AUDIO.SOUNDS[name].duration_ms; });
  return out;
});
const cases = names.map((name) => ({ name, params: name === 'match' ? { depth: 9 } : name === 'star' ? { index: 2 } : {}, kind: 'effect' }));
cases.push({ name: 'stress', params: {}, kind: 'effect' });
cases.push({ name: 'music', params: { track: 'level' }, kind: 'music' });
cases.push({ name: 'music', params: { track: 'map' }, kind: 'music', label: 'music (map)' });

const rows = [];
const failures = [];
for (const test_case of cases) {
  const rendered = await page.evaluate(async ({ name, params }) => {
    const result = await window.SC.AUDIO.renderSoundOffline(name, params, { master: 1, effects: 1, music: 1, soft_sounds: false });
    return { samples: Array.from(result.samples), sample_rate: result.sample_rate, loop_s: result.loop_s };
  }, test_case);
  const samples = Float32Array.from(rendered.samples);
  const metrics = measure(samples, rendered.sample_rate);
  const label = test_case.label || (test_case.name === 'music' ? 'music (level)' : test_case.name);
  const peak_limit = test_case.kind === 'music' ? LIMITS.peak_music : LIMITS.peak_effects;
  const problems = [];
  if (metrics.peak > peak_limit) problems.push(`peak ${metrics.peak.toFixed(3)} > ${peak_limit}`);
  if (metrics.edge > LIMITS.edge) problems.push(`edge ${metrics.edge.toFixed(4)} > ${LIMITS.edge}`);
  if (metrics.jump > LIMITS.jump) problems.push(`jump ${metrics.jump.toFixed(3)} > ${LIMITS.jump}`);
  if (metrics.above_4k > LIMITS.above_4k) problems.push(`>4 kHz ${(metrics.above_4k * 100).toFixed(2)}%`);
  if (metrics.above_6k > LIMITS.above_6k) problems.push(`>6 kHz ${(metrics.above_6k * 100).toFixed(2)}%`);
  if (metrics.centroid > LIMITS.centroid) problems.push(`centroid ${metrics.centroid.toFixed(0)} Hz`);
  if (metrics.abrupt > 0) problems.push(`${metrics.abrupt} abrupt envelope drop(s)`);
  if (specs[test_case.name] && test_case.kind === 'effect') {
    const spec_ms = specs[test_case.name];
    if (metrics.audible_ms > spec_ms * 1.6 + 120) problems.push(`audible ${metrics.audible_ms.toFixed(0)} ms vs spec ${spec_ms} ms`);
    if (metrics.audible_ms < spec_ms * 0.4) problems.push(`too short: ${metrics.audible_ms.toFixed(0)} ms vs spec ${spec_ms} ms`);
  }
  if (test_case.name === 'music') {
    // The loop seam: no jump at the boundary and the music keeps sounding across it.
    const seam = Math.round(rendered.loop_s * rendered.sample_rate);
    let seam_jump = 0;
    let seam_rms = 0;
    for (let index = seam - 2205; index < seam + 2205; index += 1) {
      seam_jump = Math.max(seam_jump, Math.abs(samples[index] - samples[index - 1]));
      seam_rms += samples[index] * samples[index];
    }
    seam_rms = Math.sqrt(seam_rms / 4410);
    metrics.seam_jump = seam_jump;
    metrics.seam_rms = seam_rms;
    if (seam_jump > LIMITS.jump) problems.push(`loop seam jump ${seam_jump.toFixed(3)}`);
    if (seam_rms < 0.001) problems.push('silence at the loop seam');
  }
  rows.push({ sound: label, ...metrics, problems });
  if (problems.length) failures.push(`${label}: ${problems.join('; ')}`);
}
await browser.close();

const header = 'Sound           Peak    Edge     MaxJump  >4kHz%  >6kHz%  Centroid  Audible ms  Result';
const lines = rows.map((row) => `${row.sound.padEnd(15)} ${row.peak.toFixed(3).padEnd(7)} ${row.edge.toFixed(4).padEnd(8)} ${row.jump.toFixed(3).padEnd(8)} ${(row.above_4k * 100).toFixed(2).padEnd(7)} ${(row.above_6k * 100).toFixed(3).padEnd(7)} ${row.centroid.toFixed(0).padEnd(9)} ${row.audible_ms.toFixed(0).padEnd(11)} ${row.problems.length ? `FAIL: ${row.problems.join('; ')}` : 'ok'}`);
const text = [`Audio safety report (worst case: master, effects and music at 100%, Soft Sounds off)`, `Limits: peak <= ${LIMITS.peak_effects} effects / ${LIMITS.peak_music} music; edges <= ${LIMITS.edge}; jump <= ${LIMITS.jump}; >4 kHz < 3%; >6 kHz < 0.5%; centroid < 1.8 kHz`, '', header, ...lines, '', failures.length ? `AUDIO: ${failures.length} FAILURE(S)` : `AUDIO: ALL ${rows.length} CHECKS PASSED`].join('\n');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'audio-report.txt'), `${text}\n`);
fs.writeFileSync(path.join(OUT_DIR, 'audio-report.json'), JSON.stringify({ limits: LIMITS, rows }, null, 2));
console.log(text);
process.exit(failures.length ? 1 : 0);
