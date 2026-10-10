// Audio quality and safety tests (CI job "audio"): every sound, a worst-case stress mix (8 big effects over the music)
// and each music track (one loop plus the seam into the next) are rendered with an OfflineAudioContext in Chromium at
// the WORST-CASE settings (all volumes at maximum, Soft Sounds off), then measured here:
//   no clipping (peak <= 0.9 effects and stress, 0.5 music); clean edges (first and last 2 ms <= 0.002: no clicks);
//   audible (every effect peaks above 0.03); not piercing (energy above 10 kHz < 3%, spectral centroid < 5 kHz);
//   sensible length (the sound falls 30 dB below its peak within its spec length, with room for the reverb tail);
//   smooth envelope (no abrupt cut while loud); the music loop seam is continuous and never silent.
// Prints a table and writes audio-report.json / audio-report.txt. Any failure exits non-zero: fix the sound, not the limit.
// Usage: node tests/audio/run-audio-tests.mjs [out_dir]
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const OUT_DIR = path.resolve(process.argv[2] || 'audio-report');
const LIMITS = { peak_effects: 0.9, peak_music: 0.5, min_peak: 0.03, edge: 0.002, seam_jump: 0.3, above_10k: 0.03, centroid: 5000 };

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
  let above_10k = 0;
  let weighted = 0;
  for (let bin = 1; bin < frame / 2; bin += 1) {
    const frequency = (bin * sample_rate) / frame;
    total += power[bin];
    weighted += power[bin] * frequency;
    if (frequency > 10000) above_10k += power[bin];
  }
  return { above_10k: total ? above_10k / total : 0, centroid: total ? weighted / total : 0 };
}

function measure(samples, sample_rate) {
  const edge_count = Math.round(sample_rate * 0.002);
  let peak = 0;
  let edge = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.abs(samples[index]);
    if (value > peak) peak = value;
    if (index < edge_count || index >= samples.length - edge_count) edge = Math.max(edge, value);
  }
  // Audible length: the last 10 ms window whose RMS is within 30 dB of the loudest window.
  const length_window = Math.round(sample_rate * 0.01);
  const window_rms = [];
  for (let start = 0; start + length_window <= samples.length; start += length_window) {
    let sum = 0;
    for (let index = start; index < start + length_window; index += 1) sum += samples[index] * samples[index];
    window_rms.push(Math.sqrt(sum / length_window));
  }
  const loudest = Math.max(...window_rms, 0);
  let last_audible = 0;
  window_rms.forEach((rms, index) => {
    if (rms > loudest * 0.0316) last_audible = (index + 1) * length_window;
  });
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
  return { peak, edge, audible_ms: (last_audible / sample_rate) * 1000, abrupt, ...spectrum(samples, sample_rate) };
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
const PARAMS = { match: { depth: 9 }, star: { index: 2 }, create: { special: 'bomb' }, bonus: { step: 14 }, praise: { depth: 6 } };
const cases = names.map((name) => ({ name, params: PARAMS[name] || {}, kind: 'effect' }));
cases.push({ name: 'match', params: { depth: 1 }, kind: 'effect', label: 'match (first)' });
cases.push({ name: 'create', params: { special: 'striped' }, kind: 'effect', label: 'create (stripe)' });
cases.push({ name: 'create', params: { special: 'wrapped' }, kind: 'effect', label: 'create (wrap)' });
cases.push({ name: 'stress', params: {}, kind: 'effect' });
cases.push({ name: 'music', params: { track: 'level' }, kind: 'music' });
cases.push({ name: 'music', params: { track: 'map' }, kind: 'music', label: 'music (map)' });

const rows = [];
const failures = [];
for (const test_case of cases) {
  const rendered = await page.evaluate(async ({ name, params }) => {
    const result = await window.SC.AUDIO.renderSoundOffline(name, params, { master: 1, effects: 1, music: 1, soft_sounds: false });
    // Float32 samples travel as base64 (much smaller and faster than a JSON array of numbers).
    const bytes = new Uint8Array(result.samples.buffer.slice(0));
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000));
    return { base64: btoa(binary), sample_rate: result.sample_rate, loop_s: result.loop_s };
  }, test_case);
  const raw = Buffer.from(rendered.base64, 'base64');
  const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const metrics = measure(samples, rendered.sample_rate);
  const label = test_case.label || (test_case.name === 'music' ? 'music (level)' : test_case.name);
  const peak_limit = test_case.kind === 'music' ? LIMITS.peak_music : LIMITS.peak_effects;
  const problems = [];
  if (metrics.peak > peak_limit) problems.push(`peak ${metrics.peak.toFixed(3)} > ${peak_limit}`);
  if (test_case.kind === 'effect' && metrics.peak < LIMITS.min_peak) problems.push(`too quiet: peak ${metrics.peak.toFixed(3)}`);
  if (metrics.edge > LIMITS.edge) problems.push(`edge ${metrics.edge.toFixed(4)} > ${LIMITS.edge}`);
  if (metrics.above_10k > LIMITS.above_10k) problems.push(`>10 kHz ${(metrics.above_10k * 100).toFixed(2)}%`);
  if (metrics.centroid > LIMITS.centroid) problems.push(`centroid ${metrics.centroid.toFixed(0)} Hz`);
  if (metrics.abrupt > 0) problems.push(`${metrics.abrupt} abrupt envelope drop(s)`);
  if (specs[test_case.name] && test_case.kind === 'effect' && test_case.name !== 'stress') {
    const spec_ms = specs[test_case.name];
    if (metrics.audible_ms > spec_ms * 1.5 + 250) problems.push(`audible ${metrics.audible_ms.toFixed(0)} ms vs spec ${spec_ms} ms`);
    if (metrics.audible_ms < spec_ms * 0.3) problems.push(`too short: ${metrics.audible_ms.toFixed(0)} ms vs spec ${spec_ms} ms`);
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
    if (seam_jump > LIMITS.seam_jump) problems.push(`loop seam jump ${seam_jump.toFixed(3)}`);
    if (seam_rms < 0.001) problems.push('silence at the loop seam');
  }
  rows.push({ sound: label, ...metrics, problems });
  if (problems.length) failures.push(`${label}: ${problems.join('; ')}`);
}
await browser.close();

const header = 'Sound            Peak    Edge     >10kHz%  Centroid  Audible ms  Result';
const lines = rows.map((row) => `${row.sound.padEnd(16)} ${row.peak.toFixed(3).padEnd(7)} ${row.edge.toFixed(4).padEnd(8)} ${(row.above_10k * 100).toFixed(2).padEnd(8)} ${row.centroid.toFixed(0).padEnd(9)} ${row.audible_ms.toFixed(0).padEnd(11)} ${row.problems.length ? `FAIL: ${row.problems.join('; ')}` : 'ok'}`);
const text = [`Audio report (worst case: master, effects and music at 100%, Soft Sounds off)`, `Limits: peak <= ${LIMITS.peak_effects} effects / ${LIMITS.peak_music} music, >= ${LIMITS.min_peak}; edges <= ${LIMITS.edge}; >10 kHz < 3%; centroid < 5 kHz; seam jump <= ${LIMITS.seam_jump}`, '', header, ...lines, '', failures.length ? `AUDIO: ${failures.length} FAILURE(S)` : `AUDIO: ALL ${rows.length} CHECKS PASSED`].join('\n');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'audio-report.txt'), `${text}\n`);
fs.writeFileSync(path.join(OUT_DIR, 'audio-report.json'), JSON.stringify({ limits: LIMITS, rows }, null, 2));
console.log(text);
process.exit(failures.length ? 1 : 0);
