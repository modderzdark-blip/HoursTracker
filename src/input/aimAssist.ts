import { INPUT_CONFIG } from '../data/config';
import type { AimRange } from '../save/settings';

/** Player-facing aim assist options (Settings → Controls), read by the human hero each action. */
export interface AimAssistOptions {
  /** Turn toward the best enemy in the hero's auto-aim cone when attacking / casting. */
  readonly autoAim: boolean;
  /** Multiplier on the hero's auto-aim range (HeroDef.autoAim.rangeM). */
  readonly rangeScale: number;
  /** Melee combo hits stretch toward the aimed enemy (INPUT_CONFIG.aimAssist.maxExtraLungeM). */
  readonly magnetism: boolean;
}

export const AIM_RANGE_SCALE: Readonly<Record<AimRange, number>> = {
  short: 0.65,
  normal: 1,
  long: 1.4,
};

export const DEFAULT_AIM_ASSIST: AimAssistOptions = {
  autoAim: true,
  rangeScale: 1,
  magnetism: true,
};

let current: AimAssistOptions = DEFAULT_AIM_ASSIST;

/** Global because the hero is built deep inside a battle; set by the App from the settings. */
export function setAimAssist(o: AimAssistOptions): void {
  current = o;
}

export function aimAssist(): AimAssistOptions {
  return current;
}

export function resolveAimAssist(s: {
  autoAim: boolean;
  autoAimRange: AimRange;
  aimMagnetism: boolean;
}): AimAssistOptions {
  return {
    autoAim: s.autoAim,
    rangeScale: AIM_RANGE_SCALE[s.autoAimRange],
    magnetism: s.aimMagnetism,
  };
}

/** Auto-aim search range for a hero (0 when auto-aim is off). */
export function autoAimRangeM(baseRangeM: number, o: AimAssistOptions): number {
  return o.autoAim ? baseRangeM * o.rangeScale : 0;
}

/** Extra lunge a melee combo hit may add to reach the aimed enemy (0 when magnetism is off). */
export function maxExtraLungeM(o: AimAssistOptions): number {
  return o.magnetism ? INPUT_CONFIG.aimAssist.maxExtraLungeM : 0;
}
