import type { Rarity } from '../data/items';
import type { AudioManager } from './AudioManager';

export type StingerId =
  | 'fanfare'
  | 'defeat'
  | 'levelUp'
  | 'star'
  | 'coin'
  | 'loot'
  | 'comboRank'
  | 'callout'
  | 'bossSting'
  | 'phase'
  | 'heartbeat'
  | 'waveClear'
  | 'finalWave'
  | 'ultReady'
  | 'ultBurst'
  | 'unlock'
  | 'chapter'
  | 'goal'
  | 'power'
  | 'whoosh'
  | 'page';

/** Voices a single stinger may start at most (keeps bursts cheap on phones). */
const MAX_VOICES = 28;
const LOOT_TIER: Readonly<Record<Rarity, number>> = {
  common: 0,
  rare: 1,
  epic: 2,
  legendary: 3,
  mythic: 4,
};

/**
 * Procedural musical cues for moments of emotion and progression: victory fanfare, level up,
 * star stamps, loot reveals per rarity, combo ranks, the boss sting, the low-HP heartbeat,
 * unlocks and goals. Synthesised with Web Audio (original, no audio files) on the SFX bus, so
 * the master / SFX volumes and mute apply. A shared, lazily built reverb gives them space.
 */
export class Stingers {
  private voices = 0;
  private noise: AudioBuffer | null = null;
  private reverb: { ctx: AudioContext; input: GainNode } | null = null;

  constructor(private readonly audio: AudioManager) {}

  /**
   * Plays a cue. `level` is cue specific: star index, loot rarity tier (0-4), combo rank,
   * coin pitch step. `volume` scales it.
   */
  play(id: StingerId, level = 0, volume = 1): void {
    const out = this.audio.sfxOutput;
    if (out === null || this.voices >= MAX_VOICES) return;
    const { ctx, bus } = out;
    const t = ctx.currentTime + 0.005;
    const v = volume;
    const wet = this.reverbIn(ctx, bus);
    switch (id) {
      case 'fanfare': {
        // D minor rising into a bright D major chord, with timpani hits under it.
        const lead = [293.66, 349.23, 440, 587.33];
        lead.forEach((f, i) => this.brass(ctx, bus, wet, t + i * 0.13, 0.32, f, 0.11 * v));
        for (const f of [293.66, 369.99, 440, 587.33])
          this.brass(ctx, bus, wet, t + 0.55, 1.6, f, 0.075 * v);
        this.timpani(ctx, bus, t, 0.5 * v);
        this.timpani(ctx, bus, t + 0.55, 0.7 * v);
        this.shimmer(ctx, wet, t + 0.55, 1.4, 0.05 * v);
        break;
      }
      case 'defeat': {
        for (const [i, f] of [196, 185, 155.56, 146.83].entries())
          this.brass(ctx, bus, wet, t + i * 0.28, 0.9, f, 0.07 * v, 700);
        this.drone(ctx, bus, t, 2.4, 73.42, 0.16 * v);
        break;
      }
      case 'levelUp': {
        const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
        notes.forEach((f, i) => this.bell(ctx, bus, wet, t + i * 0.07, 0.9, f, 0.09 * v));
        this.riser(ctx, bus, t, 0.45, 0.12 * v);
        this.shimmer(ctx, wet, t + 0.3, 1.2, 0.07 * v);
        break;
      }
      case 'star': {
        // A stamp: a heavy thump and a bell that climbs with each star.
        this.thump(ctx, bus, t, 0.55 * v, 90);
        this.bell(ctx, bus, wet, t + 0.01, 1.1, 660 * Math.pow(1.26, level), 0.12 * v);
        this.noiseHit(ctx, bus, t, 0.08, 4200, 0.12 * v, 'highpass');
        break;
      }
      case 'coin':
        this.bell(ctx, bus, null, t, 0.12, 1500 + level * 60, 0.035 * v);
        break;
      case 'loot': {
        const tier = Math.max(0, Math.min(4, level));
        if (tier === 0) {
          this.noiseHit(ctx, bus, t, 0.1, 1800, 0.08 * v, 'bandpass');
          this.bell(ctx, bus, null, t, 0.3, 880, 0.04 * v);
          break;
        }
        const roots = [0, 587.33, 698.46, 880, 1046.5];
        const root = roots[tier] ?? 880;
        this.whooshUp(ctx, bus, t, 0.25 + tier * 0.08, 0.06 * v * tier);
        for (const [i, k] of [1, 1.26, 1.5, 2].slice(0, tier + 1).entries())
          this.bell(ctx, bus, wet, t + 0.12 + i * 0.05, 1 + tier * 0.4, root * k, 0.06 * v);
        if (tier >= 2) this.shimmer(ctx, wet, t + 0.1, 0.8 + tier * 0.4, 0.04 * v * tier);
        if (tier >= 3) {
          this.timpani(ctx, bus, t + 0.1, 0.45 * v);
          for (const f of [root / 2, (root / 2) * 1.5, root])
            this.brass(ctx, bus, wet, t + 0.14, 1.4, f, 0.05 * v);
        }
        break;
      }
      case 'comboRank': {
        const f = 330 * Math.pow(1.122, Math.max(0, level));
        this.riser(ctx, bus, t, 0.18, 0.07 * v);
        this.brass(ctx, bus, wet, t + 0.12, 0.35, f, 0.07 * v);
        this.brass(ctx, bus, wet, t + 0.12, 0.35, f * 1.5, 0.05 * v);
        this.thump(ctx, bus, t + 0.12, 0.3 * v, 120);
        break;
      }
      case 'callout':
        this.thump(ctx, bus, t, 0.4 * v, 110);
        this.noiseHit(ctx, bus, t, 0.25, 900, 0.1 * v, 'lowpass');
        this.brass(ctx, bus, wet, t, 0.4, 220 * Math.pow(1.122, level), 0.06 * v);
        break;
      case 'bossSting': {
        this.whooshUp(ctx, bus, t, 0.5, 0.1 * v);
        this.timpani(ctx, bus, t + 0.5, 0.9 * v);
        this.gong(ctx, bus, wet, t + 0.5, 0.22 * v);
        for (const f of [73.42, 110, 146.83])
          this.brass(ctx, bus, wet, t + 0.5, 1.8, f, 0.08 * v, 900);
        break;
      }
      case 'phase':
        this.gong(ctx, bus, wet, t, 0.18 * v);
        this.timpani(ctx, bus, t, 0.8 * v);
        this.drone(ctx, bus, t, 1.4, 55, 0.18 * v);
        break;
      case 'heartbeat':
        this.thump(ctx, bus, t, 0.55 * v, 62);
        this.thump(ctx, bus, t + 0.17, 0.38 * v, 55);
        break;
      case 'waveClear':
        for (const [i, f] of [440, 554.37, 659.25].entries())
          this.bell(ctx, bus, wet, t + i * 0.08, 0.6, f, 0.07 * v);
        break;
      case 'finalWave':
        this.timpani(ctx, bus, t, 0.6 * v);
        this.timpani(ctx, bus, t + 0.22, 0.6 * v);
        this.timpani(ctx, bus, t + 0.44, 0.9 * v);
        this.brass(ctx, bus, wet, t + 0.44, 1.1, 146.83, 0.09 * v, 800);
        break;
      case 'ultReady':
        this.riser(ctx, bus, t, 0.35, 0.06 * v);
        this.bell(ctx, bus, wet, t + 0.3, 0.9, 1174.66, 0.07 * v);
        this.bell(ctx, bus, wet, t + 0.36, 0.9, 1760, 0.05 * v);
        break;
      case 'ultBurst':
        this.thump(ctx, bus, t, 0.8 * v, 70);
        this.gong(ctx, bus, wet, t, 0.12 * v);
        this.shimmer(ctx, wet, t, 0.9, 0.06 * v);
        break;
      case 'unlock':
        this.whooshUp(ctx, bus, t, 0.4, 0.08 * v);
        for (const [i, f] of [587.33, 739.99, 880, 1174.66].entries())
          this.bell(ctx, bus, wet, t + 0.3 + i * 0.09, 1.3, f, 0.08 * v);
        this.shimmer(ctx, wet, t + 0.3, 1.5, 0.07 * v);
        break;
      case 'chapter': {
        const chords = [
          [146.83, 220, 293.66],
          [116.54, 174.61, 293.66],
          [130.81, 196, 329.63],
          [146.83, 220, 369.99],
        ];
        chords.forEach((c, i) => {
          for (const f of c) this.brass(ctx, bus, wet, t + i * 0.55, 0.9, f, 0.06 * v, 1200);
        });
        this.timpani(ctx, bus, t + 1.65, 0.7 * v);
        this.shimmer(ctx, wet, t + 1.65, 1.6, 0.06 * v);
        break;
      }
      case 'goal':
        this.bell(ctx, bus, wet, t, 0.7, 987.77, 0.08 * v);
        this.bell(ctx, bus, wet, t + 0.09, 0.9, 1318.5, 0.07 * v);
        break;
      case 'power':
        this.riser(ctx, bus, t, 0.25, 0.05 * v);
        this.bell(ctx, bus, null, t + 0.2, 0.4, 880 * Math.pow(1.06, level), 0.05 * v);
        break;
      case 'whoosh':
        this.whooshUp(ctx, bus, t, 0.3, 0.05 * v);
        break;
      case 'page':
        this.noiseHit(ctx, bus, t, 0.18, 2400, 0.05 * v, 'bandpass');
        break;
    }
  }

  /** Loot reveal cue for an item rarity. */
  loot(rarity: Rarity, volume = 1): void {
    this.play('loot', LOOT_TIER[rarity], volume);
  }

  // ------------------------------------------------------------------ voices

  private track(node: AudioScheduledSourceNode, ...chain: AudioNode[]): void {
    this.voices++;
    node.onended = () => {
      this.voices--;
      node.disconnect();
      for (const n of chain) n.disconnect();
    };
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noise === null || this.noise.sampleRate !== ctx.sampleRate) {
      const len = ctx.sampleRate;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let seed = 4242;
      for (let i = 0; i < len; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        d[i] = (seed / 0x7fffffff) * 2 - 1;
      }
      this.noise = buf;
    }
    return this.noise;
  }

  /** Shared reverb send (one convolver per audio context). */
  private reverbIn(ctx: AudioContext, bus: AudioNode): GainNode {
    if (this.reverb !== null && this.reverb.ctx === ctx) return this.reverb.input;
    const len = Math.floor(ctx.sampleRate * 1.8);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let seed = 99 + ch * 31;
      for (let i = 0; i < len; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        d[i] = ((seed / 0x7fffffff) * 2 - 1) * Math.pow(1 - i / len, 2.6);
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    const input = ctx.createGain();
    input.gain.value = 0.55;
    input.connect(conv);
    conv.connect(bus);
    this.reverb = { ctx, input };
    return input;
  }

  private env(ctx: AudioContext, t: number, dur: number, peak: number, attack = 0.01): GainNode {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + Math.min(attack, dur * 0.4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  }

  private connect(g: GainNode, bus: AudioNode, wet: AudioNode | null): void {
    g.connect(bus);
    if (wet !== null) g.connect(wet);
  }

  /** Warm brass-like note: detuned saws through a lowpass that opens on the attack. */
  private brass(
    ctx: AudioContext,
    bus: AudioNode,
    wet: AudioNode | null,
    t: number,
    dur: number,
    f: number,
    gain: number,
    cutoff = 2200,
  ): void {
    const g = this.env(ctx, t, dur, gain, 0.04);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(cutoff * 0.3, t);
    lp.frequency.exponentialRampToValueAtTime(cutoff, t + 0.06);
    lp.frequency.exponentialRampToValueAtTime(cutoff * 0.5, t + dur);
    lp.connect(g);
    this.connect(g, bus, wet);
    for (const detune of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = detune;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.05);
      // The filter and envelope are released with the second oscillator.
      if (detune > 0) this.track(o, lp, g);
      else this.track(o);
    }
  }

  private bell(
    ctx: AudioContext,
    bus: AudioNode,
    wet: AudioNode | null,
    t: number,
    dur: number,
    f: number,
    gain: number,
  ): void {
    const g = this.env(ctx, t, dur, gain, 0.004);
    this.connect(g, bus, wet);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f * 2.76;
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    o.connect(g);
    o2.connect(g2);
    g2.connect(g);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.02);
    o2.stop(t + dur + 0.02);
    this.track(o2, g2);
    this.track(o, g);
  }

  private thump(ctx: AudioContext, bus: AudioNode, t: number, gain: number, f: number): void {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f * 2, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.5, t + 0.2);
    const g = this.env(ctx, t, 0.28, gain, 0.003);
    o.connect(g);
    g.connect(bus);
    o.start(t);
    o.stop(t + 0.3);
    this.track(o, g);
  }

  private timpani(ctx: AudioContext, bus: AudioNode, t: number, gain: number): void {
    this.thump(ctx, bus, t, gain, 70);
    this.noiseHit(ctx, bus, t, 0.35, 500, gain * 0.25, 'lowpass');
  }

  private gong(ctx: AudioContext, bus: AudioNode, wet: AudioNode, t: number, gain: number): void {
    const g = this.env(ctx, t, 3, gain, 0.01);
    this.connect(g, bus, wet);
    const partials = [1, 1.47, 2.09, 2.56, 3.17];
    partials.forEach((k, i) => {
      const o = ctx.createOscillator();
      o.frequency.value = 82 * k;
      const pg = ctx.createGain();
      pg.gain.value = 0.5 / k;
      o.connect(pg);
      pg.connect(g);
      o.start(t);
      o.stop(t + 3.05);
      if (i === partials.length - 1) this.track(o, pg, g);
      else this.track(o, pg);
    });
  }

  private drone(
    ctx: AudioContext,
    bus: AudioNode,
    t: number,
    dur: number,
    f: number,
    gain: number,
  ): void {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const g = this.env(ctx, t, dur, gain, 0.3);
    o.connect(lp);
    lp.connect(g);
    g.connect(bus);
    o.start(t);
    o.stop(t + dur + 0.05);
    this.track(o, lp, g);
  }

  private noiseHit(
    ctx: AudioContext,
    bus: AudioNode,
    t: number,
    dur: number,
    f: number,
    gain: number,
    type: BiquadFilterType,
  ): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx);
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = f;
    const g = this.env(ctx, t, dur, gain, 0.003);
    src.connect(flt);
    flt.connect(g);
    g.connect(bus);
    src.start(t, 0.1);
    src.stop(t + dur + 0.02);
    this.track(src, flt, g);
  }

  /** Filtered noise sweeping up: the air rushing before a reveal. */
  private whooshUp(ctx: AudioContext, bus: AudioNode, t: number, dur: number, gain: number): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx);
    const flt = ctx.createBiquadFilter();
    flt.type = 'bandpass';
    flt.Q.value = 1.4;
    flt.frequency.setValueAtTime(300, t);
    flt.frequency.exponentialRampToValueAtTime(4200, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + dur * 0.85);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    src.connect(flt);
    flt.connect(g);
    g.connect(bus);
    src.start(t, 0.3);
    src.stop(t + dur + 0.1);
    this.track(src, flt, g);
  }

  private riser(ctx: AudioContext, bus: AudioNode, t: number, dur: number, gain: number): void {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(880, t + dur);
    const g = this.env(ctx, t, dur, gain, dur * 0.8);
    o.connect(g);
    g.connect(bus);
    o.start(t);
    o.stop(t + dur + 0.02);
    this.track(o, g);
  }

  /** High sparkle tail (reverb only). */
  private shimmer(ctx: AudioContext, wet: AudioNode, t: number, dur: number, gain: number): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx);
    const flt = ctx.createBiquadFilter();
    flt.type = 'highpass';
    flt.frequency.value = 6500;
    const g = this.env(ctx, t, dur, gain, 0.05);
    src.connect(flt);
    flt.connect(g);
    g.connect(wet);
    src.start(t, 0.5);
    src.stop(t + dur + 0.02);
    this.track(src, flt, g);
  }
}
