import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import {
  applyQualityOverrides,
  NO_QUALITY_OVERRIDES,
  QUALITY_PRESETS,
  sameOverrides,
  type QualityLevel,
  type QualityOverrides,
  type QualityPreset,
  type QualitySetting,
} from '../data/quality';
import { QualityBenchmark } from './qualityLogic';

/** Anything whose look depends on the preset (renderer, lights, particles, UI vignette...). */
export interface QualityTarget {
  applyQuality(preset: QualityPreset, level: QualityLevel): void;
}

/**
 * Owns the active quality level. With setting 'auto' it runs the FPS benchmark on the first
 * seconds of gameplay and steps the level up/down; the result is reported through
 * `onDetected` so it can be saved and reused on the next launch.
 */
export class QualityManager {
  private targets: QualityTarget[] = [];
  private benchmark: QualityBenchmark | null = null;
  private levelValue: QualityLevel;
  private overridesValue: QualityOverrides = NO_QUALITY_OVERRIDES;
  onDetected: ((level: QualityLevel) => void) | null = null;
  onBenchmarkStateChange: ((running: boolean) => void) | null = null;

  constructor(
    private settingValue: QualitySetting,
    initialLevel: QualityLevel,
    private readonly bus: EventBus<GameEvents>,
  ) {
    this.levelValue = settingValue === 'auto' ? initialLevel : settingValue;
  }

  get level(): QualityLevel {
    return this.levelValue;
  }

  get setting(): QualitySetting {
    return this.settingValue;
  }

  /** The active preset with the player's graphics overrides (shadows, bloom, particles) applied. */
  get preset(): QualityPreset {
    return applyQualityOverrides(QUALITY_PRESETS[this.levelValue], this.overridesValue);
  }

  get overrides(): QualityOverrides {
    return this.overridesValue;
  }

  /** Changes the overrides and re-applies the current level to every target (no-op if equal). */
  setOverrides(o: QualityOverrides): void {
    if (sameOverrides(o, this.overridesValue)) return;
    this.overridesValue = o;
    this.apply(this.levelValue);
  }

  get benchmarkRunning(): boolean {
    return this.benchmark !== null && !this.benchmark.finished;
  }

  get lastBenchmarkMedianMs(): number {
    return this.benchmark?.lastMedianMs ?? 0;
  }

  addTarget(target: QualityTarget): void {
    this.targets.push(target);
    target.applyQuality(this.preset, this.levelValue);
  }

  removeTarget(target: QualityTarget): void {
    const i = this.targets.indexOf(target);
    if (i >= 0) this.targets.splice(i, 1);
  }

  /**
   * @param detected previously benchmarked level for 'auto' (skip re-benchmarking when known)
   */
  setSetting(
    setting: QualitySetting,
    startLevel: QualityLevel,
    detected: QualityLevel | null,
  ): void {
    this.settingValue = setting;
    if (setting === 'auto') {
      if (detected !== null) {
        this.stopBenchmark();
        this.apply(detected);
      } else {
        this.apply(startLevel);
        this.startBenchmark();
      }
    } else {
      this.stopBenchmark();
      this.apply(setting);
    }
  }

  startBenchmark(): void {
    this.benchmark = new QualityBenchmark(this.levelValue);
    this.onBenchmarkStateChange?.(true);
  }

  /** Feed real frame intervals (ms). */
  onFrame(intervalMs: number): void {
    const b = this.benchmark;
    if (b === null || b.finished) return;
    const next = b.addFrame(intervalMs);
    if (next !== null) {
      console.info(`[quality] benchmark median ${b.lastMedianMs.toFixed(1)} ms → ${next}`);
      this.apply(next);
    }
    if (b.finished) {
      console.info(
        `[quality] benchmark done: ${b.currentLevel} (median ${b.lastMedianMs.toFixed(1)} ms)`,
      );
      this.onDetected?.(b.currentLevel);
      this.onBenchmarkStateChange?.(false);
    }
  }

  apply(level: QualityLevel): void {
    this.levelValue = level;
    const preset = this.preset;
    for (const t of this.targets) t.applyQuality(preset, level);
    this.bus.emit('quality:applied', { level, setting: this.settingValue });
  }

  private stopBenchmark(): void {
    if (this.benchmark !== null && !this.benchmark.finished) this.onBenchmarkStateChange?.(false);
    this.benchmark = null;
  }
}
