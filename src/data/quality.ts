export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';
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
  /** Colour grading pass (split toning, contrast, vignette, grain); replaces the CSS vignette. */
  readonly grade: boolean;
  readonly vignette: boolean;
  /** Ember + dust particles alive at once. */
  readonly particleCount: number;
  /** Decorative point lights (braziers). */
  readonly pointLights: boolean;
  /** Arena ground clutter (pebbles, shards, flakes, weeds) density; 0 = none. */
  readonly clutterDensity: number;
  /** Arena ambience: motes, smoke columns and fog banks, cave drips. */
  readonly ambientFx: boolean;
  readonly maxActiveEnemies: number;
  /** Max edge length for generated/loaded textures. */
  readonly textureMaxSize: number;
  /** Budget used by the asset loader to pick texture tiers (enforced once real assets land in M3). */
  readonly textureBudgetMB: number;
  readonly anisotropy: number;
  /** PCF shadow softness (light.shadow.radius in shadow-map texels; 1 = three's default). */
  readonly shadowRadius: number;
  /** Screen-space ambient occlusion (GTAO from the scene depth; Ultra only). */
  readonly ao: boolean;
  /** Depth of field while a cinematic camera shot plays (gameplay stays sharp). */
  readonly cinematicDof: boolean;
  /** Film-style tone curve + highlight roll-off in the grading pass. */
  readonly filmGrade: boolean;
  /** Character rim / fill light multiplier (1 = the authored look). */
  readonly characterLight: number;
  /** 'fine' = higher-resolution, wider, softer bloom (BLOOM_CONFIG.fine). */
  readonly bloomQuality: 'standard' | 'fine';
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
    grade: false,
    vignette: true,
    particleCount: 60,
    pointLights: false,
    clutterDensity: 0,
    ambientFx: false,
    maxActiveEnemies: 8,
    textureMaxSize: 512,
    textureBudgetMB: 48,
    anisotropy: 1,
    shadowRadius: 1,
    ao: false,
    cinematicDof: false,
    filmGrade: false,
    characterLight: 1,
    bloomQuality: 'standard',
  },
  medium: {
    label: 'MEDIUM',
    maxPixelRatio: 1.5,
    antialias: true,
    shadows: true,
    shadowMapSize: 1024,
    shadowFrustumHalfSize: 10,
    bloom: true,
    grade: true,
    vignette: true,
    particleCount: 160,
    pointLights: true,
    clutterDensity: 1,
    ambientFx: true,
    maxActiveEnemies: 12,
    textureMaxSize: 1024,
    textureBudgetMB: 96,
    anisotropy: 2,
    shadowRadius: 1,
    ao: false,
    cinematicDof: false,
    filmGrade: false,
    characterLight: 1,
    bloomQuality: 'standard',
  },
  high: {
    label: 'HIGH',
    maxPixelRatio: 2,
    antialias: true,
    shadows: true,
    shadowMapSize: 2048,
    shadowFrustumHalfSize: 11,
    bloom: true,
    grade: true,
    vignette: true,
    particleCount: 320,
    pointLights: true,
    clutterDensity: 1.6,
    ambientFx: true,
    maxActiveEnemies: 16,
    textureMaxSize: 2048,
    textureBudgetMB: 192,
    anisotropy: 4,
    shadowRadius: 1,
    ao: false,
    cinematicDof: true,
    filmGrade: false,
    characterLight: 1,
    bloomQuality: 'standard',
  },
  ultra: {
    label: 'ULTRA',
    maxPixelRatio: 2.5,
    antialias: true,
    shadows: true,
    shadowMapSize: 4096,
    shadowFrustumHalfSize: 12,
    bloom: true,
    grade: true,
    vignette: true,
    particleCount: 480,
    pointLights: true,
    clutterDensity: 1.6,
    ambientFx: true,
    maxActiveEnemies: 16,
    // Scanned surfaces ship at 2048 px: Ultra never downsizes them.
    textureMaxSize: 4096,
    textureBudgetMB: 320,
    anisotropy: 8,
    shadowRadius: 2.6,
    ao: true,
    cinematicDof: true,
    filmGrade: true,
    characterLight: 1.3,
    bloomQuality: 'fine',
  },
};

export const QUALITY_ORDER: readonly QualityLevel[] = ['low', 'medium', 'high', 'ultra'];

/** Ember / dust particles the field allocates (Ultra's count; every other preset draws fewer). */
export const PARTICLE_CAPACITY = 480;
/**
 * Highest ember count below Ultra. Particle-density "High" on the High preset stays capped here,
 * exactly as before Ultra existed (spark density is measured against it too).
 */
export const PARTICLE_REFERENCE = 320;

/** Particles the ember field draws for a preset (Ultra may use the full capacity). */
export function emberCountFor(preset: QualityPreset, level: QualityLevel): number {
  const cap = level === 'ultra' ? PARTICLE_CAPACITY : PARTICLE_REFERENCE;
  return Math.min(Math.max(0, preset.particleCount), cap);
}

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
  /** Strength used with "Reduce flashes" (bright hits and flashes glare less). */
  reducedStrength: 0.25,
  /** Ultra: bloom buffers at a higher resolution, a wider and slightly softer glow. */
  fine: { radius: 0.5, threshold: 0.8, resolutionScale: 0.75, strengthMult: 1.1 },
} as const;

/** Which post-processing passes a preset runs (RenderContext.setPost). */
export interface PostSettings {
  readonly bloom: boolean;
  readonly grade: boolean;
  /** Ambient occlusion from the scene depth. */
  readonly ao: boolean;
  /** Cinematic depth of field (only enabled while a camera shot plays). */
  readonly dof: boolean;
  /** Film tone curve in the grading pass. */
  readonly film: boolean;
  readonly bloomQuality: 'standard' | 'fine';
}

/**
 * The post chain for a preset. AO, depth of field and the film curve need the full-screen chain,
 * so they only run when grading does; Low (no post at all) and Medium are unchanged.
 */
export function postSettingsFor(preset: QualityPreset): PostSettings {
  return {
    bloom: preset.bloom,
    grade: preset.grade,
    ao: preset.ao && preset.grade,
    dof: preset.cinematicDof && preset.grade,
    film: preset.filmGrade && preset.grade,
    bloomQuality: preset.bloomQuality,
  };
}

/** Player overrides layered on top of the active preset (Settings → Graphics). */
export interface QualityOverrides {
  /** null = keep the preset's value. */
  readonly shadows: boolean | null;
  readonly bloom: boolean | null;
  /** Multiplier on `particleCount` (ember / dust field and hit-spark density). */
  readonly particleScale: number;
}

export const NO_QUALITY_OVERRIDES: QualityOverrides = {
  shadows: null,
  bloom: null,
  particleScale: 1,
};

/** Particle density setting → multiplier on the preset's particle count. */
export const PARTICLE_DENSITY_SCALE = { low: 0.5, normal: 1, high: 1.5 } as const;

/** The preset with the player's overrides applied (pure; the preset objects are never mutated). */
export function applyQualityOverrides(preset: QualityPreset, o: QualityOverrides): QualityPreset {
  if (o.shadows === null && o.bloom === null && o.particleScale === 1) return preset;
  return {
    ...preset,
    shadows: o.shadows ?? preset.shadows,
    bloom: o.bloom ?? preset.bloom,
    particleCount: Math.max(0, Math.round(preset.particleCount * o.particleScale)),
  };
}

export function sameOverrides(a: QualityOverrides, b: QualityOverrides): boolean {
  return a.shadows === b.shadows && a.bloom === b.bloom && a.particleScale === b.particleScale;
}

/**
 * Device pixel ratio the renderer uses: the device ratio clamped to the preset's maximum, then
 * scaled by the resolution-scale setting (0.5..1; never below 0.5 overall).
 */
export function resolvePixelRatio(
  devicePixelRatio: number,
  maxPixelRatio: number,
  renderScale = 1,
): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const scale = Number.isFinite(renderScale) ? Math.min(1, Math.max(0.5, renderScale)) : 1;
  return Math.max(0.5, Math.min(dpr, maxPixelRatio) * scale);
}
