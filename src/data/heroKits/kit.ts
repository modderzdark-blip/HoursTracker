/**
 * Small builders shared by the hero kits (hit specs, shapes, emits, visual cues) so each kit
 * reads as data.
 */
import type { EmitDef, FxCue, HitShape, HitSpec, ProjectileDef, ZoneDef } from '../combatTypes';

export const arc = (range: number, angleDeg: number): HitShape => ({
  kind: 'arc',
  range,
  angleDeg,
});
export const circle = (radius: number, forward = 0): HitShape => ({
  kind: 'circle',
  radius,
  forward,
});
export const box = (length: number, width: number, forward = 0): HitShape => ({
  kind: 'box',
  length,
  width,
  forward,
});

/** A hit with light defaults (flinch, short hit-stop); override what the move needs. */
export const strike = (damage: number, shape: HitShape, extra: Partial<HitSpec> = {}): HitSpec => ({
  damage,
  poise: 12,
  reaction: 'flinch',
  knockback: 0.35,
  hitStopMs: 50,
  shake: 0.1,
  shape,
  ...extra,
});

export const projectiles = (
  projectile: ProjectileDef,
  count = 1,
  spreadDeg = 0,
  aim: 'facing' | 'target' = 'target',
): EmitDef => ({ kind: 'projectile', projectile, count, spreadDeg, aim });

export const zoneAt = (
  zone: ZoneDef,
  place: 'self' | 'forward' | 'target',
  forward = 0,
  count = 1,
  scatter = 0,
): EmitDef => ({ kind: 'zone', zone, place, forward, count, scatter });

type Offset = readonly [number, number, number];

/** One visual cue: `shape` at time `at` (s, 'start' or 'active'), `offset` forward/up/right. */
export const fx = (
  shape: FxCue['shape'],
  at: FxCue['at'],
  offset: Offset,
  scale: number,
  extra: Omit<FxCue, 'shape' | 'at' | 'offset' | 'scale'> = {},
): FxCue => ({ shape, at, offset, scale, ...extra });

/** The same cue placed on the action's locked target (meteors, curses, lightning). */
export const fxAtTarget = (
  shape: FxCue['shape'],
  at: FxCue['at'],
  up: number,
  scale: number,
  extra: Omit<FxCue, 'shape' | 'at' | 'offset' | 'scale' | 'atTarget'> = {},
): FxCue => ({ shape, at, offset: [0, up, 0], scale, atTarget: true, ...extra });

/**
 * A ground impact: glowing fissures, a shockwave, an energy shell, a column of light, soot and a
 * screen flash. `size` is the blast radius in metres.
 */
export function impactFx(
  at: FxCue['at'],
  forward: number,
  size: number,
  color?: number,
  flash = 0.3,
): FxCue[] {
  const c = color === undefined ? {} : { color };
  return [
    fx('cracks', at, [forward, 0, 0], size, { life: 1.1, ...c }),
    fx('ring', at, [forward, 0, 0], size * 1.05, { life: 0.5, ...c }),
    fx('nova', at, [forward, 0.4, 0], size * 0.45, { life: 0.45, ...c }),
    fx('pillar', at, [forward, 0, 0], Math.max(0.6, size * 0.3), { life: 0.5, ...c }),
    fx('flash', at, [forward, 0.7, 0], size * 0.5, { life: 0.2, ...c }),
    fx('smoke', at, [forward, 0.3, 0], size * 0.5, { amount: Math.round(6 + size * 2) }),
    fx('screen', at, [0, 0, 0], 0.5, { amount: flash, ...c }),
  ];
}
