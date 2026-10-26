import { BENCHMARK_CONFIG, QUALITY_ORDER, type QualityLevel } from '../data/quality';

export interface DeviceHints {
  readonly isMobile: boolean;
  /** navigator.deviceMemory (GB, Chrome only, capped at 8 by the browser). */
  readonly deviceMemoryGB?: number | undefined;
  readonly cores?: number | undefined;
  /** Unmasked WebGL renderer string, if available. */
  readonly gpu?: string | undefined;
}

/** Known-weak mobile GPU families → start on LOW. Matched case-insensitively. */
const WEAK_GPU_PATTERNS: readonly RegExp[] = [
  /mali-4\d\d/i,
  /mali-t[67]\d\d/i,
  /adreno \(tm\) [345]\d\d/i,
  /powervr sgx/i,
  /powervr rogue ge8/i,
];

/**
 * First guess before any frame is measured. Deliberately conservative: the benchmark upgrades
 * quickly if the device copes, while starting too high causes a visible stutter.
 */
export function guessInitialQuality(hints: DeviceHints): QualityLevel {
  if (!hints.isMobile) return 'high';
  if (hints.gpu !== undefined && WEAK_GPU_PATTERNS.some((p) => p.test(hints.gpu ?? ''))) {
    return 'low';
  }
  if (hints.deviceMemoryGB !== undefined && hints.deviceMemoryGB <= 3) return 'low';
  if (hints.cores !== undefined && hints.cores <= 4) return 'low';
  return 'medium';
}

/** Desktop GPUs that are clearly strong enough for Ultra (discrete cards, Apple silicon). */
const STRONG_GPU_PATTERNS: readonly RegExp[] = [
  /geforce (gtx 1[06-9]|rtx)/i,
  /\brtx\b/i,
  /radeon (rx|pro)/i,
  /apple m[1-9]/i,
];

/** Software / integrated renderers that must never get Ultra on their own. */
const SOFT_GPU_PATTERNS: readonly RegExp[] = [
  /swiftshader/i,
  /llvmpipe/i,
  /software/i,
  /basic render/i,
];

/**
 * The highest level Auto may pick. Ultra only on clearly strong devices — a desktop with 8+ cores,
 * 8 GB (the most browsers report) and a known discrete-class GPU. Phones top out at High (the
 * player can still choose Ultra by hand).
 */
export function autoQualityCeiling(hints: DeviceHints): QualityLevel {
  if (hints.isMobile) return 'high';
  const gpu = hints.gpu ?? '';
  if (gpu.length === 0 || SOFT_GPU_PATTERNS.some((p) => p.test(gpu))) return 'high';
  if (!STRONG_GPU_PATTERNS.some((p) => p.test(gpu))) return 'high';
  if (hints.cores === undefined || hints.cores < 8) return 'high';
  if (hints.deviceMemoryGB === undefined || hints.deviceMemoryGB < 8) return 'high';
  return 'ultra';
}

export function stepQuality(
  level: QualityLevel,
  delta: -1 | 1,
  ceiling: QualityLevel = 'ultra',
): QualityLevel {
  const i = QUALITY_ORDER.indexOf(level);
  const top = Math.max(i, QUALITY_ORDER.indexOf(ceiling));
  const next = QUALITY_ORDER[Math.min(Math.max(i + delta, 0), top, QUALITY_ORDER.length - 1)];
  return next ?? level;
}

export interface BenchmarkTuning {
  readonly warmupFrames: number;
  readonly sampleFrames: number;
  readonly upgradeIfMedianMsBelow: number;
  readonly downgradeIfMedianMsAbove: number;
  readonly dropToLowIfMedianMsAbove: number;
  readonly maxPasses: number;
}

/**
 * Short runtime FPS benchmark. Feed it real frame intervals; it returns a new level whenever the
 * device can't hold the current one (or clearly has headroom). After any downgrade it never
 * upgrades again, so it can't oscillate. Allocation-free per frame.
 */
export class QualityBenchmark {
  private readonly samples: Float64Array;
  private readonly scratch: Float64Array;
  private frame = 0;
  private passes = 0;
  private downgraded = false;
  private done = false;
  lastMedianMs = 0;

  /**
   * @param ceiling the highest level an upgrade may reach (autoQualityCeiling); a start level
   *   above it is kept unless the device is too slow for it.
   */
  constructor(
    private level: QualityLevel,
    private readonly tuning: BenchmarkTuning = BENCHMARK_CONFIG,
    private readonly ceiling: QualityLevel = 'high',
  ) {
    this.samples = new Float64Array(tuning.sampleFrames);
    this.scratch = new Float64Array(tuning.sampleFrames);
  }

  get finished(): boolean {
    return this.done;
  }

  get currentLevel(): QualityLevel {
    return this.level;
  }

  /** Returns the new level when a change is needed, otherwise null. */
  addFrame(intervalMs: number): QualityLevel | null {
    if (this.done) return null;
    this.frame++;
    if (this.frame <= this.tuning.warmupFrames) return null;
    const i = this.frame - this.tuning.warmupFrames - 1;
    this.samples[i] = intervalMs;
    if (i < this.tuning.sampleFrames - 1) return null;

    this.passes++;
    this.frame = 0;
    const median = this.median();
    this.lastMedianMs = median;
    const t = this.tuning;
    let next: QualityLevel = this.level;
    if (median > t.dropToLowIfMedianMsAbove) {
      next = 'low';
    } else if (median > t.downgradeIfMedianMsAbove) {
      next = stepQuality(this.level, -1, this.ceiling);
    } else if (median < t.upgradeIfMedianMsBelow && !this.downgraded) {
      next = stepQuality(this.level, 1, this.ceiling);
    }

    if (next === this.level) {
      this.done = true;
      return null;
    }
    if (QUALITY_ORDER.indexOf(next) < QUALITY_ORDER.indexOf(this.level)) this.downgraded = true;
    this.level = next;
    if (this.passes >= t.maxPasses) this.done = true;
    return next;
  }

  private median(): number {
    this.scratch.set(this.samples);
    this.scratch.sort();
    const n = this.scratch.length;
    const mid = n >> 1;
    return n % 2 === 0
      ? ((this.scratch[mid - 1] ?? 0) + (this.scratch[mid] ?? 0)) / 2
      : (this.scratch[mid] ?? 0);
  }
}
