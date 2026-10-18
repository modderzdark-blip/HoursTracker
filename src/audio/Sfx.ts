import type { AudioManager } from './AudioManager';

export type SfxId =
  | 'swing'
  | 'swingHeavy'
  | 'hit'
  | 'crit'
  | 'hurt'
  | 'dodge'
  | 'perfect'
  | 'skill'
  | 'ult'
  | 'enemyDeath'
  | 'telegraph'
  | 'slam'
  | 'roar'
  | 'soul'
  | 'break'
  | 'victory'
  | 'defeat';

/** Hard cap on simultaneous voices (mobile CPUs; a 12-enemy fight would otherwise pile up). */
const MAX_VOICES = 20;

/**
 * Procedural sound effects (all synthesised with Web Audio — original, no audio files).
 * Each call builds a tiny node graph that disconnects itself when done.
 */
export class Sfx {
  private noise: AudioBuffer | null = null;
  private voices = 0;

  constructor(private readonly audio: AudioManager) {}

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noise === null || this.noise.sampleRate !== ctx.sampleRate) {
      const len = ctx.sampleRate;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let seed = 12345;
      for (let i = 0; i < len; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        d[i] = (seed / 0x7fffffff) * 2 - 1;
      }
      this.noise = buf;
    }
    return this.noise;
  }

  play(id: SfxId, volume = 1): void {
    const out = this.audio.sfxOutput;
    if (out === null || this.voices >= MAX_VOICES) return;
    const { ctx, bus } = out;
    const t = ctx.currentTime;
    const v = volume;
    switch (id) {
      case 'swing':
        this.noiseSweep(ctx, bus, t, 0.13, 900, 3200, 0.22 * v, 'bandpass', 2.2);
        break;
      case 'swingHeavy':
        this.noiseSweep(ctx, bus, t, 0.22, 400, 1800, 0.3 * v, 'bandpass', 1.6);
        break;
      case 'hit':
        this.noiseSweep(ctx, bus, t, 0.08, 2600, 900, 0.35 * v, 'lowpass', 1);
        this.tone(ctx, bus, t, 0.11, 140, 55, 0.5 * v, 'sine');
        break;
      case 'crit':
        this.noiseSweep(ctx, bus, t, 0.1, 3500, 1200, 0.4 * v, 'lowpass', 1);
        this.tone(ctx, bus, t, 0.14, 160, 50, 0.55 * v, 'sine');
        this.tone(ctx, bus, t, 0.18, 1700, 1100, 0.12 * v, 'triangle');
        break;
      case 'hurt':
        this.tone(ctx, bus, t, 0.2, 110, 45, 0.6 * v, 'sawtooth', 600);
        this.noiseSweep(ctx, bus, t, 0.12, 1200, 400, 0.25 * v, 'lowpass', 1);
        break;
      case 'dodge':
        this.noiseSweep(ctx, bus, t, 0.2, 500, 1600, 0.16 * v, 'bandpass', 1.4);
        break;
      case 'perfect':
        for (let i = 0; i < 3; i++)
          this.tone(
            ctx,
            bus,
            t + i * 0.06,
            0.35,
            660 * (1 + i * 0.5),
            880 * (1 + i * 0.5),
            0.09 * v,
            'sine',
          );
        this.noiseSweep(ctx, bus, t, 0.4, 4000, 800, 0.08 * v, 'highpass', 1);
        break;
      case 'skill':
        this.noiseSweep(ctx, bus, t, 0.25, 600, 2800, 0.22 * v, 'bandpass', 1.8);
        this.tone(ctx, bus, t, 0.25, 220, 440, 0.12 * v, 'triangle');
        break;
      case 'ult':
        this.tone(ctx, bus, t, 1.1, 55, 35, 0.6 * v, 'sawtooth', 300);
        this.noiseSweep(ctx, bus, t, 0.9, 200, 3000, 0.2 * v, 'bandpass', 0.8);
        break;
      case 'enemyDeath':
        this.noiseSweep(ctx, bus, t, 0.45, 1200, 150, 0.25 * v, 'lowpass', 1);
        this.tone(ctx, bus, t, 0.4, 90, 40, 0.3 * v, 'triangle');
        break;
      case 'telegraph':
        this.tone(ctx, bus, t, 0.35, 180, 320, 0.07 * v, 'triangle');
        break;
      case 'slam':
        this.tone(ctx, bus, t, 0.5, 70, 30, 0.8 * v, 'sine');
        this.noiseSweep(ctx, bus, t, 0.4, 900, 100, 0.4 * v, 'lowpass', 1);
        break;
      case 'roar':
        this.tone(ctx, bus, t, 1.5, 72, 58, 0.5 * v, 'sawtooth', 500, 6);
        this.tone(ctx, bus, t, 1.5, 108, 86, 0.3 * v, 'sawtooth', 700, 5);
        break;
      case 'soul':
        this.tone(ctx, bus, t, 0.25, 1320, 1760, 0.06 * v, 'sine');
        break;
      case 'break':
        this.tone(ctx, bus, t, 0.5, 300, 90, 0.4 * v, 'square', 1500);
        this.noiseSweep(ctx, bus, t, 0.3, 5000, 900, 0.3 * v, 'highpass', 1);
        break;
      case 'victory':
        [523, 659, 784, 1047].forEach((f, i) =>
          this.tone(ctx, bus, t + i * 0.12, 0.6, f, f, 0.12 * v, 'triangle'),
        );
        break;
      case 'defeat':
        [392, 330, 262, 196].forEach((f, i) =>
          this.tone(ctx, bus, t + i * 0.18, 0.7, f, f * 0.98, 0.12 * v, 'triangle'),
        );
        break;
    }
  }

  private track(node: AudioScheduledSourceNode, ...chain: AudioNode[]): void {
    this.voices++;
    node.onended = () => {
      this.voices--;
      node.disconnect();
      for (const n of chain) n.disconnect();
    };
  }

  private tone(
    ctx: AudioContext,
    bus: AudioNode,
    t: number,
    dur: number,
    f0: number,
    f1: number,
    gain: number,
    type: OscillatorType,
    lowpassHz = 0,
    vibratoHz = 0,
  ): void {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.015, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const chain: AudioNode[] = [g];
    let head: AudioNode = osc;
    if (lowpassHz > 0) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = lowpassHz;
      head.connect(lp);
      head = lp;
      chain.push(lp);
    }
    if (vibratoHz > 0) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = vibratoHz;
      depth.gain.value = f0 * 0.06;
      lfo.connect(depth);
      depth.connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.02);
      chain.push(lfo, depth);
    }
    head.connect(g);
    g.connect(bus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    this.track(osc, ...chain);
  }

  private noiseSweep(
    ctx: AudioContext,
    bus: AudioNode,
    t: number,
    dur: number,
    f0: number,
    f1: number,
    gain: number,
    filterType: BiquadFilterType,
    q: number,
  ): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx);
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.01, dur * 0.15));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(bus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
    this.track(src, f, g);
  }
}
