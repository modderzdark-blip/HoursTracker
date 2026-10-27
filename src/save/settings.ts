import { AUDIO_CONFIG, INPUT_CONFIG } from '../data/config';
import {
  PARTICLE_DENSITY_SCALE,
  type QualityLevel,
  type QualityOverrides,
  type QualitySetting,
} from '../data/quality';

export type FpsCap = 30 | 60;
export type CameraHeight = 'low' | 'normal' | 'high';
export type CameraFov = 'narrow' | 'normal' | 'wide';
export type CameraSmoothing = 'snappy' | 'normal' | 'smooth';
/** 'auto' follows the quality preset; 'on' / 'off' override it. */
export type QualityOverride = 'auto' | 'on' | 'off';
export type ParticleDensity = 'low' | 'normal' | 'high';
export type JoystickMode = 'floating' | 'fixed';
export type AimRange = 'short' | 'normal' | 'long';
export type VibrationStrength = 'low' | 'normal' | 'strong';

export interface Settings {
  // ---- Graphics
  quality: QualitySetting;
  /** Result of the last auto benchmark; reused on next launch so it doesn't re-run every time. */
  detectedQuality: QualityLevel | null;
  fpsCap: FpsCap;
  /** Fraction (0.5..1) of the preset's pixel ratio the 3D view renders at. */
  renderScale: number;
  shadows: QualityOverride;
  bloom: QualityOverride;
  particleDensity: ParticleDensity;
  showFps: boolean;
  showDebugOverlay: boolean;
  // ---- Audio
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  uiSounds: boolean;
  /** Suspend all audio while the app is in the background. */
  muteInBackground: boolean;
  // ---- Controls
  vibration: boolean;
  vibrationStrength: VibrationStrength;
  /** Touch button size multiplier. */
  buttonScale: number;
  /** Touch button opacity (0.4..1). */
  buttonOpacity: number;
  /** Mirror the touch layout: buttons on the left, joystick on the right. */
  leftHanded: boolean;
  /** Joystick radius multiplier over INPUT_CONFIG.joystick.radiusPx. */
  joystickScale: number;
  /** Normalised joystick dead zone. */
  joystickDeadZone: number;
  joystickMode: JoystickMode;
  autoAim: boolean;
  autoAimRange: AimRange;
  /** Melee combo hits lunge toward the auto-aimed enemy. */
  aimMagnetism: boolean;
  // ---- Camera
  /** Distance multiplier over CAMERA_CONFIG.distance (0.7..1.6). */
  cameraDistance: number;
  cameraHeight: CameraHeight;
  cameraFov: CameraFov;
  cameraSmoothing: CameraSmoothing;
  cameraLookAhead: boolean;
  /** Camera shake strength (0 = off, 1 = default, up to 1.5). */
  screenShake: number;
  // ---- HUD & accessibility
  showDamageNumbers: boolean;
  showComboCounter: boolean;
  /** Battle HUD scale (0.9..1.3). */
  hudScale: number;
  reduceFlashes: boolean;
  largeMenuText: boolean;
  /** Enemy attack telegraphs in a high-contrast colour instead of red. */
  colorblindTelegraphs: boolean;
  // ---- Gameplay
  /** Ask before salvaging rare or better gear. */
  confirmRareSalvage: boolean;
  showDefeatTips: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  quality: 'auto',
  detectedQuality: null,
  fpsCap: 60,
  renderScale: 1,
  shadows: 'auto',
  bloom: 'auto',
  particleDensity: 'normal',
  showFps: false,
  showDebugOverlay: false,
  masterVolume: AUDIO_CONFIG.defaultMasterVolume,
  sfxVolume: AUDIO_CONFIG.defaultSfxVolume,
  musicVolume: AUDIO_CONFIG.defaultMusicVolume,
  uiSounds: true,
  muteInBackground: true,
  vibration: true,
  vibrationStrength: 'normal',
  buttonScale: 1,
  buttonOpacity: 0.88,
  leftHanded: false,
  joystickScale: 1,
  joystickDeadZone: INPUT_CONFIG.joystick.deadZone,
  joystickMode: 'floating',
  autoAim: true,
  autoAimRange: 'normal',
  aimMagnetism: true,
  cameraDistance: 1,
  cameraHeight: 'normal',
  cameraFov: 'normal',
  cameraSmoothing: 'normal',
  cameraLookAhead: true,
  screenShake: 1,
  showDamageNumbers: true,
  showComboCounter: true,
  hudScale: 1,
  reduceFlashes: false,
  largeMenuText: false,
  colorblindTelegraphs: false,
  confirmRareSalvage: true,
  showDefeatTips: true,
};

/** Valid ranges of the numeric settings (sliders use the same bounds). */
export const SETTING_RANGES = {
  renderScale: { min: 0.5, max: 1 },
  buttonScale: { min: 0.7, max: 1.4 },
  buttonOpacity: { min: 0.4, max: 1 },
  joystickScale: { min: 0.75, max: 1.35 },
  joystickDeadZone: { min: 0.05, max: 0.35 },
  cameraDistance: { min: 0.7, max: 1.6 },
  screenShake: { min: 0, max: 1.5 },
  hudScale: { min: 0.9, max: 1.3 },
} as const;

/** The camera settings "Reset camera" restores. */
export const CAMERA_SETTING_KEYS = [
  'cameraDistance',
  'cameraHeight',
  'cameraFov',
  'cameraSmoothing',
  'cameraLookAhead',
  'screenShake',
] as const satisfies readonly (keyof Settings)[];

export function cameraDefaults(): Pick<Settings, (typeof CAMERA_SETTING_KEYS)[number]> {
  const d = DEFAULT_SETTINGS;
  return {
    cameraDistance: d.cameraDistance,
    cameraHeight: d.cameraHeight,
    cameraFov: d.cameraFov,
    cameraSmoothing: d.cameraSmoothing,
    cameraLookAhead: d.cameraLookAhead,
    screenShake: d.screenShake,
  };
}

/**
 * Settings after "Reset all settings": every option back to its default. The benchmark result is
 * kept (it describes the device, not a preference) so Auto quality does not re-measure.
 */
export function resetSettings(current: Readonly<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, detectedQuality: current.detectedQuality };
}

// 'ultra' was added later; older saves simply never contain it.
const QUALITY_SETTINGS: readonly QualitySetting[] = ['auto', 'low', 'medium', 'high', 'ultra'];
const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high', 'ultra'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function volume(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

function ranged(raw: Record<string, unknown>, key: keyof typeof SETTING_RANGES): number {
  const r = SETTING_RANGES[key];
  return clampNum(raw[key], r.min, r.max, DEFAULT_SETTINGS[key]);
}

function bool(raw: Record<string, unknown>, key: keyof Settings, fallback: boolean): boolean {
  const v = raw[key];
  return typeof v === 'boolean' ? v : fallback;
}

function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return options.find((o) => o === v) ?? fallback;
}

/** Accepts anything (corrupt saves, older versions) and returns valid settings. Never throws. */
export function sanitizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  if (!isRecord(raw)) return { ...d };
  const override = ['auto', 'on', 'off'] as const;
  const fpsCap: FpsCap = raw['fpsCap'] === 30 ? 30 : raw['fpsCap'] === 60 ? 60 : d.fpsCap;
  return {
    quality: oneOf(raw['quality'], QUALITY_SETTINGS, d.quality),
    detectedQuality: QUALITY_LEVELS.find((q) => q === raw['detectedQuality']) ?? null,
    fpsCap,
    renderScale: ranged(raw, 'renderScale'),
    shadows: oneOf(raw['shadows'], override, d.shadows),
    bloom: oneOf(raw['bloom'], override, d.bloom),
    particleDensity: oneOf(
      raw['particleDensity'],
      ['low', 'normal', 'high'] as const,
      d.particleDensity,
    ),
    showFps: bool(raw, 'showFps', d.showFps),
    showDebugOverlay: bool(raw, 'showDebugOverlay', d.showDebugOverlay),
    masterVolume: volume(raw['masterVolume'], d.masterVolume),
    sfxVolume: volume(raw['sfxVolume'], d.sfxVolume),
    musicVolume: volume(raw['musicVolume'], d.musicVolume),
    uiSounds: bool(raw, 'uiSounds', d.uiSounds),
    muteInBackground: bool(raw, 'muteInBackground', d.muteInBackground),
    vibration: bool(raw, 'vibration', d.vibration),
    vibrationStrength: oneOf(
      raw['vibrationStrength'],
      ['low', 'normal', 'strong'] as const,
      d.vibrationStrength,
    ),
    buttonScale: ranged(raw, 'buttonScale'),
    buttonOpacity: ranged(raw, 'buttonOpacity'),
    leftHanded: bool(raw, 'leftHanded', d.leftHanded),
    joystickScale: ranged(raw, 'joystickScale'),
    joystickDeadZone: ranged(raw, 'joystickDeadZone'),
    joystickMode: oneOf(raw['joystickMode'], ['floating', 'fixed'] as const, d.joystickMode),
    autoAim: bool(raw, 'autoAim', d.autoAim),
    autoAimRange: oneOf(raw['autoAimRange'], ['short', 'normal', 'long'] as const, d.autoAimRange),
    aimMagnetism: bool(raw, 'aimMagnetism', d.aimMagnetism),
    cameraDistance: ranged(raw, 'cameraDistance'),
    cameraHeight: oneOf(raw['cameraHeight'], ['low', 'normal', 'high'] as const, d.cameraHeight),
    cameraFov: oneOf(raw['cameraFov'], ['narrow', 'normal', 'wide'] as const, d.cameraFov),
    cameraSmoothing: oneOf(
      raw['cameraSmoothing'],
      ['snappy', 'normal', 'smooth'] as const,
      d.cameraSmoothing,
    ),
    cameraLookAhead: bool(raw, 'cameraLookAhead', d.cameraLookAhead),
    screenShake: ranged(raw, 'screenShake'),
    showDamageNumbers: bool(raw, 'showDamageNumbers', d.showDamageNumbers),
    showComboCounter: bool(raw, 'showComboCounter', d.showComboCounter),
    hudScale: ranged(raw, 'hudScale'),
    reduceFlashes: bool(raw, 'reduceFlashes', d.reduceFlashes),
    largeMenuText: bool(raw, 'largeMenuText', d.largeMenuText),
    colorblindTelegraphs: bool(raw, 'colorblindTelegraphs', d.colorblindTelegraphs),
    confirmRareSalvage: bool(raw, 'confirmRareSalvage', d.confirmRareSalvage),
    showDefeatTips: bool(raw, 'showDefeatTips', d.showDefeatTips),
  };
}

function overrideValue(o: QualityOverride): boolean | null {
  return o === 'auto' ? null : o === 'on';
}

/** Graphics settings → overrides layered on the active quality preset. */
export function qualityOverridesFrom(
  s: Pick<Settings, 'shadows' | 'bloom' | 'particleDensity'>,
): QualityOverrides {
  return {
    shadows: overrideValue(s.shadows),
    bloom: overrideValue(s.bloom),
    particleScale: PARTICLE_DENSITY_SCALE[s.particleDensity],
  };
}

/** Vibration pulse length for a requested duration at the chosen strength. */
export const VIBRATION_SCALE: Readonly<Record<VibrationStrength, number>> = {
  low: 0.5,
  normal: 1,
  strong: 1.7,
};

export function vibrationMs(ms: number, strength: VibrationStrength): number {
  return Math.max(1, Math.round(ms * VIBRATION_SCALE[strength]));
}
