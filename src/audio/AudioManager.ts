import { AUDIO_CONFIG } from '../data/config';

type AudioContextCtor = typeof AudioContext;

/**
 * Small Web Audio wrapper. Mobile browsers start audio "locked": the AudioContext must be created
 * or resumed inside a user gesture, so `unlock()` is wired to the first touch. Master → (sfx,
 * music) gain buses; Sfx and Music synthesise on top of them.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private music: GainNode | null = null;
  private volumes: { master: number; sfx: number; music: number } = {
    master: AUDIO_CONFIG.defaultMasterVolume,
    sfx: AUDIO_CONFIG.defaultSfxVolume,
    music: AUDIO_CONFIG.defaultMusicVolume,
  };

  get state(): AudioContextState | 'uninitialised' {
    return this.ctx?.state ?? 'uninitialised';
  }

  /** Call from a pointer/touch handler. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx === null) {
      const Ctor =
        window.AudioContext ??
        (window as Window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
      if (Ctor === undefined) {
        console.warn('[audio] Web Audio not supported');
        return;
      }
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.sfx = this.ctx.createGain();
      this.music = this.ctx.createGain();
      this.sfx.connect(this.master);
      this.music.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.applyVolumes();
      // A one-sample silent buffer completes the unlock on older iOS/Android WebViews.
      const buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.ctx.destination);
      src.start(0);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch((err: unknown) => console.warn('[audio] resume failed', err));
    }
  }

  /** Suspend while the app is hidden to save battery; resume on return. */
  setHidden(hidden: boolean): void {
    if (this.ctx === null) return;
    if (hidden && this.ctx.state === 'running') {
      this.ctx.suspend().catch((err: unknown) => console.warn('[audio] suspend failed', err));
    } else if (!hidden && this.ctx.state === 'suspended') {
      this.ctx.resume().catch((err: unknown) => console.warn('[audio] resume failed', err));
    }
  }

  setVolumes(master: number, sfx: number, music: number): void {
    this.volumes = { master, sfx, music };
    this.applyVolumes();
  }

  /** Running context + SFX bus, or null while audio is locked/suspended. */
  get sfxOutput(): { ctx: AudioContext; bus: GainNode } | null {
    if (this.ctx === null || this.sfx === null || this.ctx.state !== 'running') return null;
    return { ctx: this.ctx, bus: this.sfx };
  }

  /** Running context + music bus, or null while audio is locked/suspended. */
  get musicOutput(): { ctx: AudioContext; bus: GainNode } | null {
    if (this.ctx === null || this.music === null || this.ctx.state !== 'running') return null;
    return { ctx: this.ctx, bus: this.music };
  }

  /** Short synthesized UI tick (original, procedural — no asset needed). */
  playUiClick(): void {
    const ctx = this.ctx;
    if (ctx === null || this.sfx === null || ctx.state !== 'running') return;
    const c = AUDIO_CONFIG.uiClick;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(c.frequencyHz, t);
    osc.frequency.exponentialRampToValueAtTime(c.frequencyHz * 0.6, t + c.durationMs / 1000);
    gain.gain.setValueAtTime(c.gain, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + c.durationMs / 1000);
    osc.connect(gain);
    gain.connect(this.sfx);
    osc.start(t);
    osc.stop(t + c.durationMs / 1000 + 0.01);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  private applyVolumes(): void {
    if (this.master !== null) this.master.gain.value = this.volumes.master;
    if (this.sfx !== null) this.sfx.gain.value = this.volumes.sfx;
    if (this.music !== null) this.music.gain.value = this.volumes.music;
  }
}
