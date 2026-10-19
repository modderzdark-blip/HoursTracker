/**
 * Hero definitions: stats, movement, body, look and the complete moveset. Balancing a hero never
 * requires touching logic code.
 */
import type { PoseName } from '../anim/poses';
import type { RigId } from './rigs';
import type { ActionDef, EmitDef, HitSpec, ProjectileDef, StatBlock } from './combatTypes';

export type HeroId = 'kael' | 'brann' | 'lyra';

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

export type SkillSpecial = 'none' | 'shadowStep' | 'steerable' | 'charge';

export interface SkillDef extends ActionDef {
  readonly name: string;
  readonly cooldownMs: number;
  readonly special: SkillSpecial;
  /** For 'shadowStep': search radius for a target to appear behind. */
  readonly targetRange?: number;
  /** For 'steerable': movement speed multiplier while active. */
  readonly steerSpeedMult?: number;
  readonly forceCrit?: boolean;
  /** For 'charge': hold the button to charge up to this long (wind-up pose held). */
  readonly chargeMaxMs?: number;
  /** For 'charge': damage multiplier at full charge (scales linearly from 1). */
  readonly chargeDamageMax?: number;
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
  /** One-line playstyle description for the hero screen. */
  readonly role: string;
  /** Stats at level 1 without gear. */
  readonly stats: StatBlock;
  /** Per level: stat = base × (1 + growth × (level − 1)). */
  readonly growth: { readonly maxHp: number; readonly atk: number; readonly def: number };
  /** Weapon-trail and skill-spark colour. */
  readonly color: number;
  /** null = available from the start. */
  readonly unlock: { readonly souls: number; readonly afterStage: string } | null;
  readonly movement: HeroMovement;
  readonly body: HeroBody;
  readonly visual: HeroVisual;
  readonly idlePose: PoseName;
  readonly combo: readonly ActionDef[];
  /** Optional ranged combo, used when no enemy is within `meleeRange` (bow heroes). */
  readonly rangedCombo?: readonly ActionDef[];
  readonly meleeRange?: number;
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

const heavy = (damage: number, extra: Partial<HitSpec> = {}): HitSpec => ({
  damage,
  poise: 28,
  reaction: 'flinch',
  knockback: 0.7,
  hitStopMs: 75,
  shake: 0.22,
  shape: { kind: 'arc', range: 3.1, angleDeg: 165 },
  ...extra,
});

const ARROW: ProjectileDef = {
  visual: 'arrow',
  speed: 28,
  radius: 0.35,
  rangeM: 16,
  pierce: false,
  homing: 0,
  height: 1.3,
};

const shot = (count = 1, spreadDeg = 0): EmitDef => ({
  kind: 'projectile',
  projectile: ARROW,
  count,
  spreadDeg,
  aim: 'target',
});

const arrowHit = (damage: number, extra: Partial<HitSpec> = {}): HitSpec => ({
  damage,
  poise: 8,
  reaction: 'flinch',
  knockback: 0.3,
  hitStopMs: 30,
  shake: 0.05,
  shape: { kind: 'circle', radius: 0.4, forward: 0 },
  ...extra,
});

export const HEROES: Readonly<Record<HeroId, HeroDef>> = {
  kael: {
    id: 'kael',
    name: 'Kael',
    epithet: 'the Twin Fang',
    role: 'Dual blades — fast, combo-heavy and mobile.',
    growth: { maxHp: 0.08, atk: 0.07, def: 0.06 },
    color: 0xa07cff,
    unlock: null,
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
  brann: {
    id: 'brann',
    name: 'Brann',
    epithet: 'the Ashen Oath',
    role: 'Greatsword — slow, heavy, unstoppable mid-swing.',
    growth: { maxHp: 0.09, atk: 0.07, def: 0.07 },
    color: 0xffa040,
    unlock: { souls: 60, afterStage: 'c1s4' },
    stats: {
      maxHp: 1550,
      atk: 128,
      def: 60,
      critChance: 0.1,
      critDamage: 1.7,
      attackSpeed: 1,
      moveSpeed: 5.6,
    },
    movement: { acceleration: 36, deceleration: 48, turnRateDeg: 620 },
    body: { capsuleRadius: 0.38, capsuleHalfHeight: 0.6 },
    visual: { kind: 'rig', rig: 'brann' },
    idlePose: 'GS_READY',
    comboResetMs: 550,
    combo: [
      {
        id: 'brann_atk1',
        startupMs: 280,
        activeMs: 120,
        recoveryMs: 380,
        cancelAtMs: 430,
        hits: [{ offsetMs: 0, spec: heavy(1.4) }],
        move: { distance: 0.8, startMs: 120, endMs: 380, ease: 'out' },
        trail: 'right',
        windPose: 'GS_SIDE_WIND',
        hitPose: 'GS_SIDE_HIT',
      },
      {
        id: 'brann_atk2',
        startupMs: 260,
        activeMs: 120,
        recoveryMs: 380,
        cancelAtMs: 420,
        hits: [{ offsetMs: 0, spec: heavy(1.5) }],
        move: { distance: 0.8, startMs: 100, endMs: 360, ease: 'out' },
        trail: 'right',
        windPose: 'GS_BACK_WIND',
        hitPose: 'GS_BACK_HIT',
      },
      {
        id: 'brann_atk3',
        startupMs: 360,
        activeMs: 120,
        recoveryMs: 460,
        cancelAtMs: 540,
        superArmor: true,
        hits: [
          {
            offsetMs: 0,
            spec: heavy(2.0, {
              poise: 45,
              reaction: 'knockback',
              knockback: 1.6,
              hitStopMs: 85,
              shake: 0.4,
              shape: { kind: 'circle', radius: 2.2, forward: 1.6 },
            }),
          },
        ],
        move: { distance: 1.1, startMs: 200, endMs: 480, ease: 'inOut' },
        trail: 'right',
        windPose: 'OVERHEAD_WIND',
        hitPose: 'OVERHEAD_HIT',
      },
      {
        id: 'brann_atk4',
        startupMs: 240,
        activeMs: 420,
        recoveryMs: 440,
        cancelAtMs: 720,
        superArmor: true,
        hits: [
          {
            offsetMs: 0,
            spec: heavy(1.3, { shape: { kind: 'circle', radius: 3.2, forward: 0 } }),
          },
          {
            offsetMs: 260,
            spec: heavy(1.4, {
              poise: 40,
              reaction: 'knockdown',
              knockback: 2.4,
              hitStopMs: 90,
              shake: 0.45,
              shape: { kind: 'circle', radius: 3.2, forward: 0 },
            }),
          },
        ],
        move: { distance: 0.6, startMs: 0, endMs: 600, ease: 'linear' },
        trail: 'right',
        windPose: 'GS_SIDE_WIND',
        hitPose: 'GS_SIDE_HIT',
        clip: 'brann_spin',
      },
    ],
    dodge: {
      durationMs: 420,
      iframeStartMs: 0,
      iframeEndMs: 320,
      distance: 4.0,
      cooldownMs: 650,
      perfectWindowMs: 150,
      slowMoScale: 0.3,
      slowMoMs: 700,
      counterWindowMs: 1600,
      counterDamageMult: 1.6,
    },
    skills: [
      {
        id: 'brann_earthsplitter',
        name: 'Earthsplitter',
        cooldownMs: 6500,
        special: 'none',
        startupMs: 380,
        activeMs: 160,
        recoveryMs: 520,
        cancelAtMs: 820,
        superArmor: true,
        hits: [
          {
            offsetMs: 0,
            spec: heavy(2.4, {
              poise: 50,
              reaction: 'knockdown',
              knockback: 1.8,
              hitStopMs: 95,
              shake: 0.5,
              shape: { kind: 'circle', radius: 2.6, forward: 1.5 },
            }),
          },
          {
            offsetMs: 120,
            spec: heavy(1.2, {
              poise: 30,
              reaction: 'knockback',
              knockback: 1.8,
              hitStopMs: 40,
              shake: 0.3,
            }),
            emit: {
              kind: 'zone',
              zone: { visual: 'shockwave', radius: 5.5, delayMs: 0, ticks: 1, intervalMs: 0 },
              place: 'forward',
              forward: 1.5,
              count: 1,
              scatter: 0,
            },
          },
        ],
        trail: 'right',
        windPose: 'OVERHEAD_WIND',
        hitPose: 'OVERHEAD_HIT',
      },
      {
        id: 'brann_oathbreaker',
        name: 'Oathbreaker',
        cooldownMs: 8000,
        special: 'charge',
        chargeMaxMs: 1500,
        chargeDamageMax: 2.6,
        startupMs: 460,
        activeMs: 130,
        recoveryMs: 520,
        cancelAtMs: 900,
        superArmor: true,
        hits: [
          {
            offsetMs: 0,
            spec: heavy(3.0, {
              poise: 90,
              reaction: 'knockdown',
              knockback: 2.6,
              hitStopMs: 110,
              shake: 0.6,
              shape: { kind: 'box', length: 4.6, width: 2.2, forward: 0.3 },
            }),
          },
        ],
        trail: 'right',
        windPose: 'CHARGE_HOLD',
        hitPose: 'OVERHEAD_HIT',
      },
      {
        id: 'brann_bulwark',
        name: 'Bulwark Rush',
        cooldownMs: 7000,
        special: 'none',
        startupMs: 120,
        activeMs: 360,
        recoveryMs: 380,
        cancelAtMs: 600,
        sweep: true,
        superArmor: true,
        hits: [
          {
            offsetMs: 0,
            spec: heavy(1.6, {
              poise: 50,
              reaction: 'knockback',
              knockback: 2.6,
              hitStopMs: 60,
              shake: 0.3,
              shape: { kind: 'circle', radius: 1.5, forward: 0.6 },
            }),
          },
        ],
        move: { distance: 6.5, startMs: 120, endMs: 480, ease: 'linear' },
        trail: 'none',
        windPose: 'CROUCH',
        hitPose: 'SHOULDER',
      },
    ],
    ultimate: {
      id: 'brann_meteor',
      name: 'Meteor Cleave',
      clones: 0,
      startupMs: 700,
      activeMs: 300,
      recoveryMs: 600,
      cancelAtMs: 1550,
      invulnerable: { fromMs: 0, toMs: 1600 },
      superArmor: true,
      move: { distance: 3, startMs: 0, endMs: 700, ease: 'inOut' },
      hits: [
        {
          offsetMs: 0,
          spec: {
            damage: 6,
            poise: 150,
            reaction: 'launch',
            knockback: 3,
            hitStopMs: 120,
            shake: 0.9,
            shape: { kind: 'circle', radius: 6.5, forward: 0 },
            status: { id: 'burn', chance: 1 },
          },
          emit: {
            kind: 'zone',
            zone: { visual: 'meteor', radius: 6.5, delayMs: 0, ticks: 1, intervalMs: 0 },
            place: 'forward',
            forward: 1.8,
            count: 1,
            scatter: 0,
          },
        },
        {
          offsetMs: 250,
          spec: {
            damage: 0.5,
            poise: 5,
            reaction: 'flinch',
            knockback: 0,
            hitStopMs: 0,
            shake: 0.05,
            shape: { kind: 'circle', radius: 5, forward: 0 },
            status: { id: 'burn', chance: 0.5 },
          },
          emit: {
            kind: 'zone',
            zone: { visual: 'fire', radius: 5, delayMs: 0, ticks: 4, intervalMs: 350 },
            place: 'forward',
            forward: 1.8,
            count: 1,
            scatter: 0,
          },
        },
      ],
      trail: 'right',
      windPose: 'OVERHEAD_WIND',
      hitPose: 'OVERHEAD_HIT',
      clip: 'brann_ult',
    },
    ultGainPerDamage: 1 / 3000,
    ultGainPerHpLost: 0.7,
    autoAim: { rangeM: 6, coneDeg: 150 },
    hurtMs: 260,
    knockdownMs: 800,
    getupMs: 600,
  },
  lyra: {
    id: 'lyra',
    name: 'Lyra',
    epithet: 'of the Gloaming',
    role: 'Arcane bow and dagger — strike from range, blade up close.',
    growth: { maxHp: 0.07, atk: 0.075, def: 0.05 },
    color: 0x8fd0c0,
    unlock: { souls: 120, afterStage: 'c1s8' },
    stats: {
      maxHp: 1000,
      atk: 112,
      def: 32,
      critChance: 0.2,
      critDamage: 1.6,
      attackSpeed: 1,
      moveSpeed: 6.6,
    },
    movement: { acceleration: 52, deceleration: 64, turnRateDeg: 960 },
    body: { capsuleRadius: 0.32, capsuleHalfHeight: 0.54 },
    visual: { kind: 'rig', rig: 'lyra' },
    idlePose: 'READY',
    comboResetMs: 450,
    meleeRange: 2.6,
    rangedCombo: [
      {
        id: 'lyra_shot1',
        startupMs: 170,
        activeMs: 60,
        recoveryMs: 240,
        cancelAtMs: 240,
        hits: [{ offsetMs: 0, spec: arrowHit(0.85), emit: shot() }],
        trail: 'none',
        windPose: 'BOW_DRAW',
        hitPose: 'BOW_RELEASE',
      },
      {
        id: 'lyra_shot2',
        startupMs: 150,
        activeMs: 60,
        recoveryMs: 240,
        cancelAtMs: 230,
        hits: [{ offsetMs: 0, spec: arrowHit(0.9), emit: shot() }],
        trail: 'none',
        windPose: 'BOW_DRAW',
        hitPose: 'BOW_RELEASE',
      },
      {
        id: 'lyra_shot3',
        startupMs: 220,
        activeMs: 60,
        recoveryMs: 360,
        cancelAtMs: 340,
        hits: [
          {
            offsetMs: 0,
            spec: arrowHit(0.75, { poise: 14, reaction: 'knockback', knockback: 0.8 }),
            emit: shot(3, 20),
          },
        ],
        trail: 'none',
        windPose: 'BOW_DRAW',
        hitPose: 'BOW_RELEASE',
      },
    ],
    combo: [
      {
        id: 'lyra_stab1',
        startupMs: 110,
        activeMs: 80,
        recoveryMs: 220,
        cancelAtMs: 200,
        hits: [
          { offsetMs: 0, spec: light(0.8, { shape: { kind: 'arc', range: 2.1, angleDeg: 140 } }) },
        ],
        move: { distance: 0.5, startMs: 0, endMs: 190, ease: 'out' },
        trail: 'right',
        windPose: 'SLASH_R_WIND',
        hitPose: 'SLASH_R_HIT',
      },
      {
        id: 'lyra_stab2',
        startupMs: 110,
        activeMs: 80,
        recoveryMs: 230,
        cancelAtMs: 210,
        hits: [
          { offsetMs: 0, spec: light(0.85, { shape: { kind: 'arc', range: 2.1, angleDeg: 140 } }) },
        ],
        move: { distance: 0.5, startMs: 0, endMs: 190, ease: 'out' },
        trail: 'right',
        windPose: 'CROSS_WIND',
        hitPose: 'CROSS_HIT',
      },
      {
        id: 'lyra_stab3',
        startupMs: 160,
        activeMs: 100,
        recoveryMs: 300,
        cancelAtMs: 300,
        hits: [
          {
            offsetMs: 0,
            spec: light(1.3, {
              poise: 24,
              reaction: 'knockback',
              knockback: 2.2,
              hitStopMs: 70,
              shake: 0.25,
              shape: { kind: 'arc', range: 2.4, angleDeg: 170 },
              status: { id: 'bleed', chance: 0.4 },
            }),
          },
        ],
        move: { distance: 0.4, startMs: 0, endMs: 260, ease: 'out' },
        trail: 'right',
        windPose: 'SLASH_R_WIND',
        hitPose: 'SLASH_R_HIT',
        clip: 'kael_spin',
      },
    ],
    dodge: {
      durationMs: 340,
      iframeStartMs: 0,
      iframeEndMs: 300,
      distance: 5,
      cooldownMs: 400,
      perfectWindowMs: 150,
      slowMoScale: 0.3,
      slowMoMs: 700,
      counterWindowMs: 1500,
      counterDamageMult: 1.5,
    },
    skills: [
      {
        id: 'lyra_piercing',
        name: 'Piercing Gloam',
        cooldownMs: 5000,
        special: 'none',
        startupMs: 260,
        activeMs: 80,
        recoveryMs: 300,
        cancelAtMs: 420,
        hits: [
          {
            offsetMs: 0,
            spec: arrowHit(2.6, {
              poise: 30,
              reaction: 'knockback',
              knockback: 1.2,
              hitStopMs: 50,
              shake: 0.2,
              status: { id: 'bleed', chance: 0.6 },
            }),
            emit: {
              kind: 'projectile',
              projectile: {
                visual: 'shadow',
                speed: 34,
                radius: 0.55,
                rangeM: 22,
                pierce: true,
                homing: 0,
                height: 1.3,
              },
              count: 1,
              spreadDeg: 0,
              aim: 'target',
            },
          },
        ],
        trail: 'none',
        windPose: 'BOW_DRAW',
        hitPose: 'BOW_RELEASE',
      },
      {
        id: 'lyra_volley',
        name: 'Ashfall Volley',
        cooldownMs: 8000,
        special: 'none',
        startupMs: 300,
        activeMs: 100,
        recoveryMs: 300,
        cancelAtMs: 450,
        hits: [
          {
            offsetMs: 0,
            spec: arrowHit(0.55, {
              poise: 6,
              knockback: 0.1,
              hitStopMs: 0,
              shake: 0.03,
              status: { id: 'slow', chance: 0.5 },
            }),
            emit: {
              kind: 'zone',
              zone: { visual: 'rain', radius: 3.4, delayMs: 450, ticks: 6, intervalMs: 280 },
              place: 'target',
              forward: 6,
              count: 1,
              scatter: 0,
            },
          },
        ],
        trail: 'none',
        windPose: 'AIM_UP',
        hitPose: 'AIM_UP_RELEASE',
      },
      {
        id: 'lyra_snare',
        name: 'Snare Leap',
        cooldownMs: 9000,
        special: 'none',
        startupMs: 60,
        activeMs: 80,
        recoveryMs: 380,
        cancelAtMs: 420,
        invulnerable: { fromMs: 0, toMs: 360 },
        hits: [
          {
            offsetMs: 0,
            spec: {
              damage: 2.2,
              poise: 60,
              reaction: 'knockdown',
              knockback: 1,
              hitStopMs: 60,
              shake: 0.3,
              shape: { kind: 'circle', radius: 2.2, forward: 0 },
              status: { id: 'bleed', chance: 1 },
            },
            emit: {
              kind: 'zone',
              zone: {
                visual: 'trap',
                radius: 2.2,
                delayMs: 300,
                ticks: 1,
                intervalMs: 0,
                trigger: 'proximity',
                lifeMs: 9000,
              },
              place: 'self',
              forward: 0,
              count: 1,
              scatter: 0,
            },
          },
        ],
        move: { distance: -5.5, startMs: 60, endMs: 380, ease: 'out' },
        trail: 'none',
        windPose: 'CROUCH',
        hitPose: 'CROUCH',
        clip: 'lyra_backflip',
      },
    ],
    ultimate: {
      id: 'lyra_gloamstorm',
      name: 'Gloamstorm',
      clones: 0,
      startupMs: 500,
      activeMs: 1600,
      recoveryMs: 400,
      cancelAtMs: 2450,
      invulnerable: { fromMs: 0, toMs: 2500 },
      superArmor: true,
      hits: [0, 200, 400, 600, 800, 1000, 1200, 1400].map((offsetMs) => ({
        offsetMs,
        spec: arrowHit(0.9, { poise: 10, hitStopMs: 20, shake: 0.08 }),
        emit: {
          kind: 'projectile' as const,
          projectile: {
            visual: 'shadow' as const,
            speed: 18,
            radius: 0.45,
            rangeM: 22,
            pierce: false,
            homing: 7,
            height: 2,
          },
          count: 3,
          spreadDeg: 80,
          aim: 'facing' as const,
        },
      })),
      trail: 'none',
      windPose: 'AIM_UP',
      hitPose: 'AIM_UP_RELEASE',
      clip: 'lyra_ult',
    },
    ultGainPerDamage: 1 / 2500,
    ultGainPerHpLost: 0.6,
    autoAim: { rangeM: 14, coneDeg: 170 },
    hurtMs: 280,
    knockdownMs: 900,
    getupMs: 520,
  },
};

export const DEFAULT_HERO: HeroId = 'kael';
