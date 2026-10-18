export interface ShakeConfig {
  readonly decayPerSec: number;
  readonly maxOffset: number;
  readonly maxRollDeg: number;
  readonly frequencyHz: number;
}

export interface ShakeSample {
  x: number;
  y: number;
  rollRad: number;
}

/**
 * Trauma-based shake: impulses add trauma (0..1), which decays linearly; the visible strength is
 * trauma² so small hits stay subtle and big hits punch. Offsets come from summed sines with
 * incommensurate frequencies (smooth, deterministic, allocation-free).
 */
export class CameraShake {
  private trauma = 0;
  private t = 0;

  constructor(private readonly config: ShakeConfig) {}

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + Math.max(0, amount));
  }

  get currentTrauma(): number {
    return this.trauma;
  }

  update(dtSec: number, out: ShakeSample): ShakeSample {
    this.trauma = Math.max(0, this.trauma - this.config.decayPerSec * dtSec);
    this.t += dtSec;
    const s = this.trauma * this.trauma;
    if (s === 0) {
      out.x = 0;
      out.y = 0;
      out.rollRad = 0;
      return out;
    }
    const w = this.t * this.config.frequencyHz * Math.PI * 2;
    out.x = this.config.maxOffset * s * (Math.sin(w) * 0.6 + Math.sin(w * 1.73 + 1.1) * 0.4);
    out.y = this.config.maxOffset * s * (Math.sin(w * 1.31 + 2.3) * 0.6 + Math.sin(w * 2.11) * 0.4);
    out.rollRad = ((this.config.maxRollDeg * Math.PI) / 180) * s * Math.sin(w * 0.87 + 0.7);
    return out;
  }

  reset(): void {
    this.trauma = 0;
  }
}
