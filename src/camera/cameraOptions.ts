import { CAMERA_CONFIG } from '../data/config';
import type { CameraFov, CameraHeight, CameraSmoothing, Settings } from '../save/settings';

/** Live follow-camera parameters (CAMERA_CONFIG scaled by the player's camera settings). */
export interface CameraOptions {
  readonly distance: number;
  readonly height: number;
  readonly fovDeg: number;
  readonly followSharpness: number;
  readonly lookAhead: number;
  /** Multiplier on the visible shake (0 = none). */
  readonly shake: number;
}

/** Distance presets (multipliers over CAMERA_CONFIG.distance) shown next to the fine slider. */
export const CAMERA_DISTANCE_PRESETS = [
  { id: 'close', label: 'Close', value: 0.8 },
  { id: 'normal', label: 'Normal', value: 1 },
  { id: 'far', label: 'Far', value: 1.2 },
  { id: 'veryfar', label: 'Very far', value: 1.4 },
] as const;

/** Height multipliers: lower = flatter, more cinematic angle; higher = more top-down. */
export const CAMERA_HEIGHT_SCALE: Readonly<Record<CameraHeight, number>> = {
  low: 0.72,
  normal: 1,
  high: 1.3,
};

export const CAMERA_FOV_DEG: Readonly<Record<CameraFov, number>> = {
  narrow: 42,
  normal: CAMERA_CONFIG.fovDeg,
  wide: 56,
};

/** Follow sharpness multipliers (higher = the camera catches up faster). */
export const CAMERA_SMOOTHING_SCALE: Readonly<Record<CameraSmoothing, number>> = {
  snappy: 1.8,
  normal: 1,
  smooth: 0.5,
};

export type CameraSettings = Pick<
  Settings,
  | 'cameraDistance'
  | 'cameraHeight'
  | 'cameraFov'
  | 'cameraSmoothing'
  | 'cameraLookAhead'
  | 'screenShake'
>;

/** Pure mapping from the saved camera settings to the follow camera's parameters. */
export function resolveCameraOptions(s: CameraSettings): CameraOptions {
  const c = CAMERA_CONFIG;
  // Height scales with distance too, so "Far" keeps the same angle, only further away.
  const heightScale = CAMERA_HEIGHT_SCALE[s.cameraHeight];
  return {
    distance: c.distance * s.cameraDistance,
    height: c.height * s.cameraDistance * heightScale,
    fovDeg: CAMERA_FOV_DEG[s.cameraFov],
    followSharpness: c.followSharpness * CAMERA_SMOOTHING_SCALE[s.cameraSmoothing],
    lookAhead: s.cameraLookAhead ? c.lookAhead : 0,
    shake: Math.max(0, s.screenShake),
  };
}

/** The options the game ships with (CAMERA_CONFIG unchanged). */
export const DEFAULT_CAMERA_OPTIONS: CameraOptions = {
  distance: CAMERA_CONFIG.distance,
  height: CAMERA_CONFIG.height,
  fovDeg: CAMERA_CONFIG.fovDeg,
  followSharpness: CAMERA_CONFIG.followSharpness,
  lookAhead: CAMERA_CONFIG.lookAhead,
  shake: 1,
};

/** Preset whose value matches the distance multiplier, or null for a custom (slider) value. */
export function distancePresetFor(value: number): (typeof CAMERA_DISTANCE_PRESETS)[number] | null {
  return CAMERA_DISTANCE_PRESETS.find((p) => Math.abs(p.value - value) < 0.005) ?? null;
}

/** Camera pitch below the horizon (degrees) for the given options, looking at the aim point. */
export function cameraPitchDeg(o: Pick<CameraOptions, 'distance' | 'height'>): number {
  return (Math.atan2(o.height - CAMERA_CONFIG.lookAtHeight, o.distance) * 180) / Math.PI;
}
