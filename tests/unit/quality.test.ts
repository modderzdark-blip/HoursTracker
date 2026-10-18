import { describe, expect, it } from 'vitest';
import { QUALITY_ORDER, QUALITY_PRESETS } from '../../src/data/quality';
import { QualityBenchmark, guessInitialQuality, stepQuality } from '../../src/render/qualityLogic';

const tuning = {
  warmupFrames: 5,
  sampleFrames: 10,
  upgradeIfMedianMsBelow: 17.6,
  downgradeIfMedianMsAbove: 21.5,
  dropToLowIfMedianMsAbove: 34,
  maxPasses: 3,
};

function feed(b: QualityBenchmark, ms: number, frames: number): (string | null)[] {
  const out: (string | null)[] = [];
  for (let i = 0; i < frames; i++) out.push(b.addFrame(ms));
  return out.filter((x) => x !== null);
}

describe('guessInitialQuality', () => {
  it('desktop → high, weak phones → low, others → medium', () => {
    expect(guessInitialQuality({ isMobile: false })).toBe('high');
    expect(guessInitialQuality({ isMobile: true, deviceMemoryGB: 2 })).toBe('low');
    expect(guessInitialQuality({ isMobile: true, cores: 4 })).toBe('low');
    expect(guessInitialQuality({ isMobile: true, gpu: 'Mali-T720' })).toBe('low');
    expect(
      guessInitialQuality({ isMobile: true, deviceMemoryGB: 8, cores: 8, gpu: 'Adreno (TM) 740' }),
    ).toBe('medium');
  });
});

describe('stepQuality', () => {
  it('clamps at both ends', () => {
    expect(stepQuality('low', -1)).toBe('low');
    expect(stepQuality('high', 1)).toBe('high');
    expect(stepQuality('medium', 1)).toBe('high');
  });
});

describe('QualityBenchmark', () => {
  it('ignores warm-up frames (shader compile hitches)', () => {
    const b = new QualityBenchmark('medium', tuning);
    expect(feed(b, 500, 5)).toEqual([]);
  });

  it('upgrades a device that holds 60 FPS, then settles', () => {
    const b = new QualityBenchmark('medium', tuning);
    expect(feed(b, 16.7, 15)).toEqual(['high']);
    expect(feed(b, 16.7, 15)).toEqual([]);
    expect(b.finished).toBe(true);
    expect(b.currentLevel).toBe('high');
  });

  it('downgrades a struggling device and never upgrades again (no oscillation)', () => {
    const b = new QualityBenchmark('high', tuning);
    expect(feed(b, 25, 15)).toEqual(['medium']);
    expect(feed(b, 16, 15)).toEqual([]); // fast now, but no re-upgrade after a downgrade
    expect(b.currentLevel).toBe('medium');
    expect(b.finished).toBe(true);
  });

  it('drops straight to LOW when far too slow', () => {
    const b = new QualityBenchmark('high', tuning);
    expect(feed(b, 50, 15)).toEqual(['low']);
  });

  it('uses the median, so a few spikes do not cause a downgrade', () => {
    const b = new QualityBenchmark('medium', tuning);
    for (let i = 0; i < 5; i++) b.addFrame(16.7);
    const frames = [16.7, 16.7, 80, 16.7, 16.7, 90, 16.7, 16.7, 16.7, 16.7];
    const changes = frames.map((f) => b.addFrame(f)).filter((x) => x !== null);
    expect(changes).toEqual(['high']);
  });

  it('stops after maxPasses', () => {
    const b = new QualityBenchmark('high', { ...tuning, maxPasses: 1 });
    feed(b, 25, 15);
    expect(b.finished).toBe(true);
  });
});

describe('quality presets', () => {
  it('scale monotonically from LOW to HIGH', () => {
    const [low, med, high] = QUALITY_ORDER.map((l) => QUALITY_PRESETS[l]);
    if (!low || !med || !high) throw new Error('missing preset');
    expect(low.maxPixelRatio).toBeLessThanOrEqual(med.maxPixelRatio);
    expect(med.maxPixelRatio).toBeLessThanOrEqual(high.maxPixelRatio);
    expect(low.particleCount).toBeLessThan(med.particleCount);
    expect(med.particleCount).toBeLessThan(high.particleCount);
    expect(low.shadowMapSize).toBeLessThanOrEqual(med.shadowMapSize);
    expect(med.maxActiveEnemies).toBe(12); // brief: max 12 active enemies on MEDIUM
    expect(high.particleCount).toBeLessThanOrEqual(320); // EmberField allocates 320
  });
});
