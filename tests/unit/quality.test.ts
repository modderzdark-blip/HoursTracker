import { describe, expect, it } from 'vitest';
import {
  emberCountFor,
  PARTICLE_CAPACITY,
  postSettingsFor,
  QUALITY_ORDER,
  QUALITY_PRESETS,
} from '../../src/data/quality';
import {
  autoQualityCeiling,
  QualityBenchmark,
  guessInitialQuality,
  stepQuality,
} from '../../src/render/qualityLogic';

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
    expect(stepQuality('ultra', 1)).toBe('ultra');
    expect(stepQuality('high', 1)).toBe('ultra');
    expect(stepQuality('medium', 1)).toBe('high');
  });

  it('respects a ceiling but never forces a level above it down', () => {
    expect(stepQuality('high', 1, 'high')).toBe('high');
    expect(stepQuality('medium', 1, 'medium')).toBe('medium');
    expect(stepQuality('ultra', 1, 'high')).toBe('ultra');
    expect(stepQuality('ultra', -1, 'high')).toBe('high');
  });
});

describe('autoQualityCeiling', () => {
  const strong = {
    isMobile: false,
    cores: 12,
    deviceMemoryGB: 8,
    gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  };
  it('allows Ultra only on clearly strong desktops', () => {
    expect(autoQualityCeiling(strong)).toBe('ultra');
    expect(
      autoQualityCeiling({ ...strong, gpu: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2)' }),
    ).toBe('ultra');
  });
  it('keeps phones, weak, unknown and software GPUs at High', () => {
    expect(autoQualityCeiling({ ...strong, isMobile: true })).toBe('high');
    expect(autoQualityCeiling({ ...strong, gpu: 'Adreno (TM) 750' })).toBe('high');
    expect(autoQualityCeiling({ ...strong, gpu: 'Intel(R) UHD Graphics 630' })).toBe('high');
    expect(autoQualityCeiling({ ...strong, gpu: 'Google SwiftShader' })).toBe('high');
    expect(autoQualityCeiling({ ...strong, gpu: undefined })).toBe('high');
    expect(autoQualityCeiling({ ...strong, cores: 4 })).toBe('high');
    expect(autoQualityCeiling({ ...strong, deviceMemoryGB: undefined })).toBe('high');
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

  it('never upgrades past its ceiling (default High)', () => {
    const b = new QualityBenchmark('high', tuning);
    expect(feed(b, 10, 15)).toEqual([]);
    expect(b.currentLevel).toBe('high');
    const u = new QualityBenchmark('high', tuning, 'ultra');
    expect(feed(u, 10, 15)).toEqual(['ultra']);
  });

  it('steps Ultra down to High on a struggling device', () => {
    const b = new QualityBenchmark('ultra', tuning);
    expect(feed(b, 25, 15)).toEqual(['high']);
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
    expect(high.particleCount).toBeLessThanOrEqual(320); // the reference count below Ultra
  });

  it('Ultra sits above High and adds the cinematic features', () => {
    const high = QUALITY_PRESETS.high;
    const ultra = QUALITY_PRESETS.ultra;
    expect(QUALITY_ORDER).toEqual(['low', 'medium', 'high', 'ultra']);
    expect(Object.keys(ultra).sort()).toEqual(Object.keys(high).sort());
    expect(ultra.maxPixelRatio).toBeGreaterThan(high.maxPixelRatio);
    expect(ultra.shadowMapSize).toBeGreaterThan(high.shadowMapSize);
    expect(ultra.shadowRadius).toBeGreaterThan(high.shadowRadius);
    expect(ultra.particleCount).toBeGreaterThan(high.particleCount);
    expect(ultra.particleCount).toBeLessThanOrEqual(PARTICLE_CAPACITY);
    expect(ultra.textureMaxSize).toBeGreaterThanOrEqual(2048);
    expect(ultra.ao && ultra.cinematicDof && ultra.filmGrade).toBe(true);
    expect(ultra.characterLight).toBeGreaterThan(1);
    expect(ultra.maxActiveEnemies).toBe(high.maxActiveEnemies); // same gameplay
  });

  it('Low, Medium and High keep their look (no AO, film or extra light)', () => {
    for (const l of ['low', 'medium', 'high'] as const) {
      const p = QUALITY_PRESETS[l];
      expect(p.ao).toBe(false);
      expect(p.filmGrade).toBe(false);
      expect(p.shadowRadius).toBe(1);
      expect(p.characterLight).toBe(1);
      expect(p.bloomQuality).toBe('standard');
    }
    expect(postSettingsFor(QUALITY_PRESETS.low)).toMatchObject({
      bloom: false,
      ao: false,
      dof: false,
    });
    expect(postSettingsFor(QUALITY_PRESETS.medium)).toMatchObject({
      ao: false,
      dof: false,
      film: false,
    });
    expect(postSettingsFor(QUALITY_PRESETS.high)).toMatchObject({
      ao: false,
      dof: true,
      film: false,
    });
    expect(postSettingsFor(QUALITY_PRESETS.ultra)).toMatchObject({
      ao: true,
      dof: true,
      film: true,
    });
    // Without the grading chain the depth effects cannot run.
    expect(postSettingsFor({ ...QUALITY_PRESETS.ultra, grade: false })).toMatchObject({
      ao: false,
    });
  });

  it('ember count: High stays capped at the old 320, Ultra may use the full capacity', () => {
    const boosted = { ...QUALITY_PRESETS.high, particleCount: 480 };
    expect(emberCountFor(boosted, 'high')).toBe(320);
    expect(emberCountFor(QUALITY_PRESETS.ultra, 'ultra')).toBe(480);
    expect(emberCountFor({ ...QUALITY_PRESETS.ultra, particleCount: 720 }, 'ultra')).toBe(480);
    expect(emberCountFor(QUALITY_PRESETS.low, 'low')).toBe(60);
  });
});

describe('character light', () => {
  it('is one shared value set from the preset (no per-material state)', async () => {
    const { getCharacterLight, setCharacterLight } = await import('../../src/render/rimLight');
    setCharacterLight(QUALITY_PRESETS.ultra.characterLight);
    expect(getCharacterLight()).toBeCloseTo(1.3);
    setCharacterLight(-2);
    expect(getCharacterLight()).toBe(0);
    setCharacterLight(QUALITY_PRESETS.high.characterLight);
    expect(getCharacterLight()).toBe(1);
  });
});
