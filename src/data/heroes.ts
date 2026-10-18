/**
 * Hero definitions: stats, movement, body, look and the complete moveset. Balancing a hero never
 * requires touching logic code.
 */
import type { RigId } from './rigs';
import type { ActionDef, HitSpec, StatBlock } from './combatTypes';

export type HeroId = 'kael';

/**
 * Swapping a placeholder for a real model is one line: change `visual` to
 * `{ kind: 'gltf', url: 'assets/models/kael.glb', scale: 1 }` (glTF path lands with the M3 assets).
 */
export type HeroVisual =
  | { readonly kind: 'rig'; readonly rig: RigId }
  | { readonly kind: 'gltf'; readonly url: string; readonly scale: number };

export interface HeroMovement {
  readonly acceleration: number;
  readonly deceleration: number;
  readonly turnRateDeg: number;
}

export interface HeroBody {
  readonly capsuleRadius: number;
  readonly capsuleHalfHeight: number;
}

export interface DodgeDef {
  readonly durationMs: number;
  readonly iframeStartMs: number;
  readonly iframeEndMs: number;
  readonly distance: number;
  readonly cooldownMs: number;
  /** A hit landing within this time after the dodge starts counts as a perfect dodge. */
  readonly perfectWindowMs: number;
  readonly slowMoScale: number;
  /** Real-time duration of the perfect-dodge slow motion. */
  readonly slowMoMs: number;
  /** Game time after a perfect dodge during which the next attack is a counter. */
  readonly counterWindowMs: number;
  readonly counterDamageMult: number;
}

export type SkillSpecial = 'none' | 'shadowStep' | 'steerable';

export interface SkillDef extends ActionDef {
  readonly name: string;
  readonly cooldownMs: number;
  readonly special: SkillSpecial;
  /** For 'shadowStep': search radius for a target to appear behind. */
  readonly targetRange?: number;
  /** For 'steerable': movement speed multiplier while active. */
  readonly steerSpeedMult?: number;
  readonly forceCrit?: boolean;
}

export interface UltimateDef extends ActionDef {
  readonly name: string;
  /** Number of shadow clones shown during the ultimate (visual). */
  readonly clones: number;
}

export interface HeroDef {
  readonly id: HeroId;
  readonly name: string;
  readonly epithet: string;
  readonly stats: StatBlock;
  readonly movement: HeroMovement;
  readonly body: HeroBody;
  readonly visual: HeroVisual;
  readonly idlePose: 'READY' | 'NEUTRAL';
  readonly combo: readonly ActionDef[];
  /** If no attack input arrives this long after a combo step ends, the combo resets. */
  readonly comboResetMs: number;
  readonly dodge: DodgeDef;
  readonly skills: readonly [SkillDef, SkillDef, SkillDef];
  readonly ultimate: UltimateDef;
  /** Ultimate charge gained per point of damage dealt / per fraction of max HP lost. */
  readonly ultGainPerDamage: number;
  readonly ultGainPerHpLost: number;
  /** Auto-aim: snap facing toward the nearest enemy inside this cone and range on attack start. */
  readonly autoAim: { readonly rangeM: number; readonly coneDeg: number };
  readonly hurtMs: number;
  readonly knockdownMs: number;
  readonly getupMs: number;
}

const light = (damage: number, extra: Partial<HitSpec> = {}): HitSpec => ({
  damage,
  poise: 12,
  reaction: 'flinch',
  knockback: 0.35,
  hitStopMs: 55,
  shake: 0.12,
  shape: { kind: 'arc', range: 2.4, angleDeg: 150 },
  ...extra,
});

export const HEROES: Readonly<Record<HeroId, HeroDef>> = {
  kael: {
    id: 'kael',
    name: 'Kael',
    epithet: 'the Twin Fang',
    stats: {
      maxHp: 1200,
      atk: 100,
      def: 40,
      critChance: 0.15,
      critDamage: 1.6,
      attackSpeed: 1,
      moveSpeed: 6.2,
    },
    movement: { acceleration: 48, deceleration: 60, turnRateDeg: 900 },
    body: { capsuleRadius: 0.34, capsuleHalfHeight: 0.56 },
    visual: { kind: 'rig', rig: 'kael' },
    idlePose: 'READY',
    comboResetMs: 450,
    combo: [
      {
        id: 'kael_atk1',
        startupMs: 130,
        activeMs: 90,
        recoveryMs: 260,
        cancelAtMs: 250,
        hits: [{ offsetMs: 0, spec: light(0.9) }],
        move: { distance: 0.6, startMs: 0, endMs: 220, ease: 'out' },
        trail: 'right',
        windPose: 'SLASH_R_WIND',
        hitPose: 'SLASH_R_HIT',
      },
      {
        id: 'kael_atk2',
        startupMs: 120,
        activeMs: 90,
        recoveryMs: 260,
        cancelAtMs: 240,
        hits: [{ offsetMs: 0, spec: light(0.95) }],
        move: { distance: 0.6, startMs: 0, endMs: 210, ease: 'out' },
        trail: 'left',
        windPose: 'SLASH_L_WIND',
        hitPose: 'SLASH_L_HIT',
      },
      {
        id: 'kael_atk3',
        startupMs: 160,
        activeMs: 110,
        recoveryMs: 300,
        cancelAtMs: 300,
        hits: [
          { offsetMs: 0, spec: light(0.6, { shape: { kind: 'arc', range: 2.6, angleDeg: 120 } }) },
          {
            offsetMs: 70,
            spec: light(0.6, { shape: { kind: 'arc', range: 2.6, angleDeg: 120 }, poise: 14 }),
          },
        ],
        move: { distance: 0.8, startMs: 0, endMs: 270, ease: 'out' },
        trail: 'both',
        windPose: 'CROSS_WIND',
        hitPose: 'CROSS_HIT',
      },
      {
        id: 'kael_atk4',
        startupMs: 110,
        activeMs: 260,
        recoveryMs: 300,
        cancelAtMs: 400,
        hits: [
          {
            offsetMs: 0,
            spec: light(0.55, {
              shape: { kind: 'circle', radius: 2.5, forward: 0 },
              knockback: 0.4,
            }),
          },
          {
            offsetMs: 130,
            spec: light(0.55, {
              shape: { kind: 'circle', radius: 2.5, forward: 0 },
              reaction: 'knockback',
              knockback: 1.4,
              poise: 16,
              hitStopMs: 65,
              shake: 0.2,
            }),
          },
        ],
        move: { distance: 0.5, startMs: 0, endMs: 300, ease: 'linear' },
        trail: 'both',
        windPose: 'ARMS_WIDE',
        hitPose: 'ARMS_WIDE',
        clip: 'kael_spin',
      },
      {
        id: 'kael_atk5',
        startupMs: 260,
        activeMs: 120,
        recoveryMs: 480,
        cancelAtMs: 560,
        hits: [
          {
            offsetMs: 0,
            spec: {
              damage: 2.0,
              poise: 40,
              reaction: 'knockdown',
              knockback: 2.2,
              hitStopMs: 90,
              shake: 0.45,
              shape: { kind: 'circle', radius: 2.3, forward: 1.3 },
              status: { id: 'bleed', chance: 0.5 },
            },
          },
        ],
        move: { distance: 1.6, startMs: 0, endMs: 300, ease: 'inOut' },
        trail: 'both',
        windPose: 'OVERHEAD_WIND',
        hitPose: 'OVERHEAD_HIT',
      },
    ],
    dodge: {
      durationMs: 360,
      iframeStartMs: 0,
      iframeEndMs: 300,
      distance: 4.5,
      cooldownMs: 450,
      perfectWindowMs: 140,
      slowMoScale: 0.3,
      slowMoMs: 700,
      counterWindowMs: 1500,
      counterDamageMult: 1.5,
    },
    skills: [
      {
        id: 'kael_rendingDash',
        name: 'Rending Dash',
        cooldownMs: 4000,
        special: 'none',
        startupMs: 80,
        activeMs: 200,
        recoveryMs: 260,
        cancelAtMs: 400,
        sweep: true,
        hits: [
          {
            offsetMs: 0,
            spec: {
              damage: 2.2,
              poise: 30,
              reaction: 'knockback',
              knockback: 1.2,
              hitStopMs: 60,
              shake: 0.25,
              shape: { kind: 'circle', radius: 1.4, forward: 0 },
              status: { id: 'bleed', chance: 1 },
            },
          },
        ],
        move: { distance: 6, startMs: 80, endMs: 280, ease: 'out' },
        invulnerable: { fromMs: 60, toMs: 300 },
        trail: 'both',
        windPose: 'CROUCH',
        hitPose: 'DASH_LEAN',
      },
      {
        id: 'kael_bladeGyre',
        name: 'Blade Gyre',
        cooldownMs: 7000,
        special: 'steerable',
        steerSpeedMult: 0.55,
        startupMs: 100,
        activeMs: 1000,
        recoveryMs: 250,
        cancelAtMs: 1100,
        superArmor: true,
        hits: [0, 160, 320, 480, 640, 800, 960].map((offsetMs, i) => ({
          offsetMs,
          spec: {
            damage: 0.45,
            poise: 8,
            reaction: i === 6 ? ('knockback' as const) : ('flinch' as const),
            knockback: i === 6 ? 1.6 : 0.3,
            hitStopMs: i === 6 ? 70 : 35,
            shake: i === 6 ? 0.25 : 0.06,
            shape: { kind: 'circle' as const, radius: 2.6, forward: 0 },
          },
        })),
        trail: 'both',
        windPose: 'ARMS_WIDE',
        hitPose: 'ARMS_WIDE',
        clip: 'kael_gyre',
      },
      {
        id: 'kael_umbralStep',
        name: 'Umbral Step',
        cooldownMs: 10000,
        special: 'shadowStep',
        targetRange: 9,
        forceCrit: true,
        startupMs: 220,
        activeMs: 100,
        recoveryMs: 320,
        cancelAtMs: 420,
        hits: [
          {
            offsetMs: 0,
            spec: {
              damage: 3,
              poise: 60,
              reaction: 'knockdown',
              knockback: 1.8,
              hitStopMs: 85,
              shake: 0.4,
              shape: { kind: 'arc', range: 2.6, angleDeg: 130 },
            },
          },
        ],
        invulnerable: { fromMs: 0, toMs: 260 },
        trail: 'both',
        windPose: 'CROSS_WIND',
        hitPose: 'CROSS_HIT',
      },
    ],
    ultimate: {
      id: 'kael_hollowLegion',
      name: 'Hollow Legion',
      clones: 4,
      startupMs: 450,
      activeMs: 1320,
      recoveryMs: 400,
      cancelAtMs: 2170,
      invulnerable: { fromMs: 0, toMs: 2170 },
      superArmor: true,
      hits: [0, 220, 440, 660, 880, 1100].map((offsetMs, i) => ({
        offsetMs,
        spec: {
          damage: 1.4,
          poise: 25,
          reaction: i === 5 ? ('launch' as const) : ('flinch' as const),
          knockback: i === 5 ? 2.5 : 0.2,
          hitStopMs: i === 5 ? 110 : 45,
          shake: i === 5 ? 0.8 : 0.2,
          shape: { kind: 'circle' as const, radius: 7, forward: 0 },
        },
      })),
      trail: 'both',
      windPose: 'OVERHEAD_WIND',
      hitPose: 'OVERHEAD_HIT',
      clip: 'kael_ult',
    },
    ultGainPerDamage: 1 / 2600,
    ultGainPerHpLost: 0.6,
    autoAim: { rangeM: 6, coneDeg: 140 },
    hurtMs: 280,
    knockdownMs: 900,
    getupMs: 550,
  },
};

export const DEFAULT_HERO: HeroId = 'kael';
