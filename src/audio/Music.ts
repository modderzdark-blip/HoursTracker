import type { AudioManager } from './AudioManager';

export type MusicTheme = 'hub' | 'battle' | 'boss';

interface ThemeDef {
  readonly bpm: number;
  /** Drone notes (Hz) held for the whole theme. */
  readonly drone: readonly number[];
  readonly droneCutoff: number;
  /** Bass ostinato, one note per 8th (Hz, 0 = rest). */
  readonly bass: readonly number[];
  /** Melody pool for sparse bell notes (Hz). */
  readonly bells: readonly number[];
  /** Probability of a bell on each beat. */
  readonly bellChance: number;
  /** Drum pattern per 8th: k = kick, s = snare, t = tom, - = rest. */
  readonly drums: string;
  /** Pad chords (Hz triads), one per bar; empty = no pad. */
  readonly pad: readonly (readonly number[])[];
  readonly gain: number;
}

// D natural minor, low register for weight.
const D1 = 36.71;
const A1 = 55;
const C2 = 65.41;
const D2 = 73.42;
const F2 = 87.31;
const G2 = 98;
const A2 = 110;
const Bb2 = 116.54;
const D3 = 146.83;
const F3 = 174.61;
const A3 = 220;
const C4 = 261.63;
const D4 = 293.66;
const F4 = 349.23;
const A4 = 440;
const C5 = 523.25;
const E5 = 659.25;

const THEMES: Readonly<Record<MusicTheme, ThemeDef>> = {
  hub: {
    bpm: 60,
    drone: [D2, A2],
    droneCutoff: 380,
    bass: [],
    bells: [D4, F4, A4, C5, E5, A3],
    bellChance: 0.45,
    drums: '',
    pad: [],
    gain: 0.5,
  },
  battle: {
    bpm: 92,
    drone: [D1, A1],
    droneCutoff: 260,
    bass: [D2, D2, F2, D2, C2, D2, A1, C2],
    bells: [D4, F4, A4],
    bellChance: 0.12,
    drums: 'k-s-k-s-k-s-kts-',
    pad: [],
    gain: 0.55,
  },
  boss: {
    bpm: 116,
    drone: [D1, A1, D2],
    droneCutoff: 340,
    bass: [D2, D2, D3, D2, F2, D2, C2, A1],
    bells: [D4, F4, A4, C5],
    bellChance: 0.15,
    drums: 'k-skt-skkt-sk-tt',
    pad: [
      [D3, F3, A3],
      [Bb2, D3, F3],
      [C2 * 2, G2 * 2, E5 / 4],
      [A2, C4 / 2, E5 / 4],
    ],
    gain: 0.6,
  },
};

const LOOKAHEAD_SEC = 0.35;
const TICK_MS = 90;

/**
 * Procedural soundtrack (original, synthesised — no audio files): a filtered drone, a bass
 * ostinato, drums and sparse bell notes, scheduled ahead on the Web Audio clock. Themes: calm
 * hub, driving battle, harder boss. Plays on the music bus (its own volume setting).
 */
export class Music {
  private theme: MusicTheme | null = null;
  private timer = 0;
  private nextNoteTime = 0;
  private step = 0;
  private voice: { nodes: AudioNode[]; out: GainNode } | null = null;
  private noise: AudioBuffer | null = null;
  private seed = 7;

  constructor(private readonly audio: AudioManager) {}

  get current(): MusicTheme | null {
    return this.theme;
  }

  play(theme: MusicTheme): void {
    if (this.theme === theme) return;
    this.stop();
    this.theme = theme;
    this.step = 0;
    this.nextNoteTime = 0;
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
    this.theme = null;
    this.releaseDrone();
  }

  private rand(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  private schedule(): void {
    const out = this.audio.musicOutput;
    const theme = this.theme;
    if (out === null || theme === null) return;
    const { ctx, bus } = out;
    const def = THEMES[theme];
    if (this.voice === null) this.startDrone(ctx, bus, def);
    const eighth = 60 / def.bpm / 2;
    if (this.nextNoteTime < ctx.currentTime) this.nextNoteTime = ctx.currentTime + 0.05;
    while (this.nextNoteTime < ctx.currentTime + LOOKAHEAD_SEC) {
      this.playStep(ctx, bus, def, this.step, this.nextNoteTime, eighth);
      this.nextNoteTime += eighth;
      this.step++;
    }
  }

  private playStep(
    ctx: AudioContext,
    bus: AudioNode,
    def: ThemeDef,
    step: number,
    t: number,
    eighth: number,
  ): void {
    const g = def.gain;
    if (def.bass.length > 0) {
      const f = def.bass[step % def.bass.length] ?? 0;
      if (f > 0) this.tone(ctx, bus, t, f, eighth * 0.95, 0.22 * g, 'sawtooth', 520);
    }
    if (def.drums.length > 0) {
      const d = def.drums[step % def.drums.length];
      if (d === 'k') this.kick(ctx, bus, t, 0.55 * g);
      else if (d === 's') this.snare(ctx, bus, t, 0.22 * g);
      else if (d === 't') this.tom(ctx, bus, t, 0.35 * g);
    }
    // Beat-level events (every 2nd eighth).
    if (step % 2 === 0 && this.rand() < def.bellChance) {
      const f = def.bells[Math.floor(this.rand() * def.bells.length)] ?? 440;
      this.tone(ctx, bus, t, f, eighth * 6, 0.07 * g, 'triangle', 4000);
    }
    if (def.pad.length > 0 && step % 8 === 0) {
      const chord = def.pad[Math.floor(step / 8) % def.pad.length] ?? [];
      for (const f of chord) this.tone(ctx, bus, t, f, eighth * 8, 0.05 * g, 'sawtooth', 900);
    }
  }

  private startDrone(ctx: AudioContext, bus: AudioNode, def: ThemeDef): void {
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, ctx.currentTime);
    out.gain.linearRampToValueAtTime(0.12 * def.gain, ctx.currentTime + 2.5);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = def.droneCutoff;
    filter.Q.value = 2;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = def.droneCutoff * 0.35;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    filter.connect(out);
    out.connect(bus);
    const nodes: AudioNode[] = [out, filter, lfo, lfoGain];
    for (const f of def.drone) {
      for (const detune of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = detune;
        o.connect(filter);
        o.start();
        nodes.push(o);
      }
    }
    lfo.start();
    this.voice = { nodes, out };
  }

  private releaseDrone(): void {
    const v = this.voice;
    if (v === null) return;
    this.voice = null;
    const ctx = v.out.context;
    const now = ctx.currentTime;
    v.out.gain.cancelScheduledValues(now);
    v.out.gain.setValueAtTime(v.out.gain.value, now);
    v.out.gain.linearRampToValueAtTime(0, now + 0.8);
    window.setTimeout(() => {
      for (const n of v.nodes) {
        if (n instanceof OscillatorNode) n.stop();
        n.disconnect();
      }
    }, 1000);
  }

  private tone(
    ctx: AudioContext,
    bus: AudioNode,
    t: number,
    freq: number,
    dur: number,
    gain: number,
    type: OscillatorType,
    cutoff: number,
  ): void {
    const o = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f);
    f.connect(g);
    g.connect(bus);
    o.start(t);
    o.stop(t + dur + 0.02);
    o.onended = () => {
      o.disconnect();
      f.disconnect();
      g.disconnect();
    };
  }

  private kick(ctx: AudioContext, bus: AudioNode, t: number, gain: number): void {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.18);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g);
    g.connect(bus);
    o.start(t);
    o.stop(t + 0.35);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }

  private tom(ctx: AudioContext, bus: AudioNode, t: number, gain: number): void {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.2);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g);
    g.connect(bus);
    o.start(t);
    o.stop(t + 0.3);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }

  private snare(ctx: AudioContext, bus: AudioNode, t: number, gain: number): void {
    if (this.noise === null || this.noise.sampleRate !== ctx.sampleRate) {
      const len = Math.floor(ctx.sampleRate * 0.3);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = this.rand() * 2 - 1;
      this.noise = buf;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(f);
    f.connect(g);
    g.connect(bus);
    src.start(t);
    src.stop(t + 0.2);
    src.onended = () => {
      src.disconnect();
      f.disconnect();
      g.disconnect();
    };
  }
}
