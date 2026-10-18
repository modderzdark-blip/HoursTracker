export type QualityLevel = 'low' | 'medium' | 'high';
export type QualitySetting = QualityLevel | 'auto';

export interface QualityPreset {
  readonly label: string;
  /** Device pixel ratio is clamped to this. Biggest single GPU cost lever on phones. */
  readonly maxPixelRatio: number;
  /** MSAA on the default framebuffer. Fixed at renderer creation (WebGL limitation). */
  readonly antialias: boolean;
  readonly shadows: boolean;
  readonly shadowMapSize: number;
  /** Half-size of the orthographic shadow frustum around the player (metres). */
  readonly shadowFrustumHalfSize: number;
  readonly bloom: boolean;
  readonly vignette: boolean;
  /** Ember + dust particles alive at once. */
  readonly particleCount: number;
  /** Decorative point lights (braziers). */
  readonly pointLights: boolean;
  readonly maxActiveEnemies: number;
  /** Max edge length for generated/loaded textures. */
  readonly textureMaxSize: number;
  /** Budget used by the asset loader to pick texture tiers (enforced once real assets land in M3). */
  readonly textureBudgetMB: number;
  readonly anisotropy: number;
}

export const QUALITY_PRESETS: Readonly<Record<QualityLevel, QualityPreset>> = {
  low: {
    label: 'LOW',
    maxPixelRatio: 1,
    antialias: false,
    shadows: false,
    shadowMapSize: 512,
    shadowFrustumHalfSize: 9,
    bloom: false,
    vignette: true,
    particleCount: 60,
    pointLights: false,
    maxActiveEnemies: 8,
    textureMaxSize: 512,
    textureBudgetMB: 48,
    anisotropy: 1,
  },
  medium: {
    label: 'MEDIUM',
    maxPixelRatio: 1.5,
    antialias: true,
    shadows: true,
    shadowMapSize: 1024,
    shadowFrustumHalfSize: 10,
    bloom: false,
    vignette: true,
    particleCount: 160,
    pointLights: true,
    maxActiveEnemies: 12,
    textureMaxSize: 1024,
    textureBudgetMB: 96,
    anisotropy: 2,
  },
  high: {
    label: 'HIGH',
    maxPixelRatio: 2,
    antialias: true,
    shadows: true,
    shadowMapSize: 2048,
    shadowFrustumHalfSize: 11,
    bloom: true,
    vignette: true,
    particleCount: 320,
    pointLights: true,
    maxActiveEnemies: 16,
    textureMaxSize: 2048,
    textureBudgetMB: 192,
    anisotropy: 4,
  },
};

export const QUALITY_ORDER: readonly QualityLevel[] = ['low', 'medium', 'high'];

export const BENCHMARK_CONFIG = {
  /** Frames ignored after the arena appears (shader compile, texture upload). */
  warmupFrames: 45,
  /** Frames measured per benchmark pass. */
  sampleFrames: 120,
  /** Median frame interval at or below this means the device holds 60 FPS → try one level up. */
  upgradeIfMedianMsBelow: 17.6,
  /** Median frame interval above this → drop one level. */
  downgradeIfMedianMsAbove: 21.5,
  /** Above this, drop straight to LOW. */
  dropToLowIfMedianMsAbove: 34,
  /** Benchmark passes before the result is locked in. */
  maxPasses: 3,
} as const;

export const BLOOM_CONFIG = {
  strength: 0.55,
  radius: 0.35,
  threshold: 0.82,
  /** Bloom buffers render at this fraction of the canvas resolution. */
  resolutionScale: 0.5,
} as const;
