/**
 * Hero definitions. M1 only uses movement, body and placeholder visual data; combat stats,
 * combos and skill effects arrive in M2/M5 and extend these same records.
 */

export type HeroId = 'kael';

export type WeaponPlaceholder = 'dualBlades' | 'greatsword' | 'bowDagger';

/**
 * Swapping a placeholder for a real model is one line: change `visual` to
 * `{ kind: 'gltf', url: 'assets/models/kael.glb', scale: 1 }`. The glTF loader path lands in M3.
 */
export type HeroVisual =
  | {
      readonly kind: 'placeholder';
      readonly bodyColor: number;
      readonly trimColor: number;
      readonly weapon: WeaponPlaceholder;
      readonly weaponColor: number;
      readonly rimColor: number;
    }
  | { readonly kind: 'gltf'; readonly url: string; readonly scale: number };

export interface HeroMovement {
  /** Top run speed at full stick deflection (m/s). */
  readonly moveSpeed: number;
  /** m/s² while accelerating toward the stick direction. */
  readonly acceleration: number;
  /** m/s² while braking with no input. */
  readonly deceleration: number;
  /** Max facing turn rate (deg/s). */
  readonly turnRateDeg: number;
}

export interface HeroBody {
  readonly capsuleRadius: number;
  /** Half the height of the capsule's cylindrical part. Total height = 2*(halfHeight + radius). */
  readonly capsuleHalfHeight: number;
}

export interface SkillSlotDef {
  readonly id: string;
  readonly name: string;
  readonly cooldownMs: number;
}

export interface HeroDef {
  readonly id: HeroId;
  readonly name: string;
  readonly epithet: string;
  readonly movement: HeroMovement;
  readonly body: HeroBody;
  readonly visual: HeroVisual;
  readonly skills: readonly [SkillSlotDef, SkillSlotDef, SkillSlotDef];
  readonly ultimate: { readonly id: string; readonly name: string };
  /** Placeholder swing used by the M1 attack button (visual only; real combo data in M2). */
  readonly placeholderSwingMs: number;
}

export const HEROES: Readonly<Record<HeroId, HeroDef>> = {
  kael: {
    id: 'kael',
    name: 'Kael',
    epithet: 'the Twin Fang',
    movement: {
      moveSpeed: 6.2,
      acceleration: 48,
      deceleration: 60,
      turnRateDeg: 900,
    },
    body: { capsuleRadius: 0.34, capsuleHalfHeight: 0.56 },
    visual: {
      kind: 'placeholder',
      bodyColor: 0x2b2733,
      trimColor: 0xb8862e,
      weapon: 'dualBlades',
      weaponColor: 0xc9ccd6,
      rimColor: 0xff8a3d,
    },
    skills: [
      { id: 'kael_rendingDash', name: 'Rending Dash', cooldownMs: 4000 },
      { id: 'kael_bladeGyre', name: 'Blade Gyre', cooldownMs: 7000 },
      { id: 'kael_umbralStep', name: 'Umbral Step', cooldownMs: 10000 },
    ],
    ultimate: { id: 'kael_hollowLegion', name: 'Hollow Legion' },
    placeholderSwingMs: 260,
  },
};

export const DEFAULT_HERO: HeroId = 'kael';
