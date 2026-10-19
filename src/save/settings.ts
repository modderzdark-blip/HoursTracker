import { AUDIO_CONFIG } from '../data/config';
import type { QualityLevel, QualitySetting } from '../data/quality';

export type FpsCap = 30 | 60;

export interface Settings {
  quality: QualitySetting;
  /** Result of the last auto benchmark; reused on next launch so it doesn't re-run every time. */
  detectedQuality: QualityLevel | null;
  fpsCap: FpsCap;
  showDebugOverlay: boolean;
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  vibration: boolean;
  /** Touch button size multiplier. */
  buttonScale: number;
  /** Touch button opacity (0.4..1). */
  buttonOpacity: number;
  /** Mirror the touch layout: buttons on the left, joystick on the right. */
  leftHanded: boolean;
  /** Camera shake strength (0 = off). */
  screenShake: number;
  showDamageNumbers: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  quality: 'auto',
  detectedQuality: null,
  fpsCap: 60,
  showDebugOverlay: false,
  masterVolume: AUDIO_CONFIG.defaultMasterVolume,
  sfxVolume: AUDIO_CONFIG.defaultSfxVolume,
  musicVolume: AUDIO_CONFIG.defaultMusicVolume,
  vibration: true,
  buttonScale: 1,
  buttonOpacity: 0.88,
  leftHanded: false,
  screenShake: 1,
  showDamageNumbers: true,
};

const QUALITY_SETTINGS: readonly QualitySetting[] = ['auto', 'low', 'medium', 'high'];
const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function volume(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

/** Accepts anything (corrupt saves, older versions) and returns valid settings. Never throws. */
export function sanitizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  if (!isRecord(raw)) return { ...d };
  const quality = QUALITY_SETTINGS.find((q) => q === raw['quality']) ?? d.quality;
  const detected = QUALITY_LEVELS.find((q) => q === raw['detectedQuality']) ?? null;
  const fpsCap: FpsCap = raw['fpsCap'] === 30 ? 30 : raw['fpsCap'] === 60 ? 60 : d.fpsCap;
  return {
    quality,
    detectedQuality: detected,
    fpsCap,
    showDebugOverlay:
      typeof raw['showDebugOverlay'] === 'boolean' ? raw['showDebugOverlay'] : d.showDebugOverlay,
    masterVolume: volume(raw['masterVolume'], d.masterVolume),
    sfxVolume: volume(raw['sfxVolume'], d.sfxVolume),
    musicVolume: volume(raw['musicVolume'], d.musicVolume),
    vibration: typeof raw['vibration'] === 'boolean' ? raw['vibration'] : d.vibration,
    buttonScale: clampNum(raw['buttonScale'], 0.7, 1.4, d.buttonScale),
    buttonOpacity: clampNum(raw['buttonOpacity'], 0.4, 1, d.buttonOpacity),
    leftHanded: typeof raw['leftHanded'] === 'boolean' ? raw['leftHanded'] : d.leftHanded,
    screenShake: clampNum(raw['screenShake'], 0, 1, d.screenShake),
    showDamageNumbers:
      typeof raw['showDamageNumbers'] === 'boolean'
        ? raw['showDamageNumbers']
        : d.showDamageNumbers,
  };
}
