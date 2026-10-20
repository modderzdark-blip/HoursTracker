import type { ActionDef, HitSpec, StatBlock } from './combatTypes';
import type { CreatureId, CreatureMotion } from './creatures';
import type { RigId } from './rigs';

/** Enemy attack: `startupMs` is the telegraph (wind-up) time players read and react to. */
export interface EnemyAttackDef extends ActionDef {
  /** AI starts this attack when the player is within this distance (edge to edge). */
  readonly range: number;
  readonly minRange?: number;
  /** Per-attack cooldown after it finishes. */
  readonly cooldownMs: number;
  /** Relative pick weight among usable attacks. */
  readonly weight: number;
  /** Show a ground indicator during the telegraph (area attacks). */
  readonly indicator: boolean;
  /** Attack that may immediately follow this one (boss combos). */
  readonly chainNext?: string;
  readonly chainChance?: number;
  /**
   * 'leap': jump onto the target point locked at telegraph start (boss).
   * 'explode': the attacker destroys itself when the attack lands (suicide enemies).
   * 'fly': rise out of reach during the attack (hits are emitted from the air), then land.
   * 'grab': if the strike connects, the player is held, then takes `grab.spec`.
   * 'burrow': sink into the ground during the telegraph, tunnel to the target point locked at
   * the end of tracking, and erupt there when the attack becomes active (untouchable below).
   */
  readonly special?: 'leap' | 'explode' | 'fly' | 'grab' | 'burrow';
  /** Creature bodies: which procedural motion plays for this attack (default 'bite'). */
  readonly motion?: CreatureMotion;
  /** Adds summoned when the attack becomes active. */
  readonly summon?: { readonly enemy: EnemyId; readonly count: number };
  readonly grab?: { readonly holdMs: number; readonly spec: HitSpec };
  /** 'fly': hover height (m). */
  readonly flyHeight?: number;
  /** Track the player's position while telegraphing until this fraction of the telegraph. */
  readonly trackUntil?: number;
}

export type EnemyId =
  'thrall' | 'imp' | 'brute' | 'bulwark' | 'seer' | 'wretch' | 'broodling' | 'ash_hound';

export interface EnemyDef {
  readonly id: string;
  readonly name: string;
  /** Humanoid body (ignored when `creature` is set). */
  readonly rig: RigId;
  /** Non-humanoid body (spider, beast, wyrm) animated procedurally. */
  readonly creature?: CreatureId;
  readonly stats: StatBlock;
  readonly poise: number;
  readonly radius: number;
  readonly halfHeight: number;
  readonly aggroRange: number;
  /** Distance kept while circling without an attack token. */
  readonly holdDistance: number;
  readonly turnRateDeg: number;
  readonly attacks: readonly EnemyAttackDef[];
  readonly hurtMs: number;
  readonly staggerMs: number;
  readonly knockdownMs: number;
  readonly getupMs: number;
  readonly deathMs: number;
  /** 0 = full knockback, 1 = immovable. */
  readonly knockbackResist: number;
  /** Front shield: hits from inside the arc are blocked (damage × blockMult, poise × poiseMult). */
  readonly shield?: {
    readonly arcDeg: number;
    readonly blockMult: number;
    readonly poiseMult: number;
  };
  /** Ranged enemies back away when the player gets closer than this (edge distance). */
  readonly preferredRange?: number;
  /** Idle/locomotion pose family. */
  readonly idlePose: 'HUNCHED' | 'NEUTRAL';
  readonly souls: number;
}

export const ENEMIES: Readonly<Record<EnemyId, EnemyDef>> = {
  thrall: {
    id: 'thrall',
    name: 'Hollow Thrall',
    rig: 'thrall',
    stats: {
      maxHp: 420,
      atk: 90,
      def: 30,
      critChance: 0,
      critDamage: 1,
      attackSpeed: 1,
      moveSpeed: 3.3,
    },
    poise: 35,
    radius: 0.4,
    halfHeight: 0.55,
    aggroRange: 20,
    holdDistance: 4.5,
    turnRateDeg: 420,
    attacks: [
      {
        id: 'thrall_chop',
        startupMs: 560,
        activeMs: 120,
        recoveryMs: 650,
        cancelAtMs: 9999,
        range: 1.6,
        cooldownMs: 1100,
        weight: 1,
        indicator: false,
        trackUntil: 0.6,
        hits: [
          {
            offsetMs: 0,
            spec: {
              damage: 1,
              poise: 20,
              reaction: 'flinch',
              knockback: 0.6,
              hitStopMs: 60,
              shake: 0.2,
              shape: { kind: 'arc', range: 2.0, angleDeg: 110 },
            },
          },
        ],
        move: { distance: 0.5, startMs: 500, endMs: 680, ease: 'out' },
        trail: 'right',
        windPose: 'CLUB_WIND',
        hitPose: 'CLUB_HIT',
      },
    ],
    hurtMs: 300,
    staggerMs: 1400,
    knockdownMs: 1100,
    getupMs: 600,
    deathMs: 1600,
    knockbackResist: 0,
    idlePose: 'HUNCHED',
    souls: 0,
  },
  imp: {
    id: 'imp',
    name: 'Cinder Imp',
    rig: 'imp',
    stats: {
      maxHp: 150,
      atk: 55,
      def: 10,
      critChance: 0,
      critDamage: 1,
      attackSpeed: 1,
      moveSpeed: 5.6,
    },
    poise: 10,
    radius: 0.3,
    halfHeight: 0.28,
    aggroRange: 24,
    holdDistance: 3.6,
    turnRateDeg: 720,
    attacks: [
      {
        id: 'imp_pounce',
        startupMs: 380,
        activeMs: 180,
        recoveryMs: 520,
        cancelAtMs: 9999,
        range: 3.0,
        cooldownMs: 900,
        weight: 1,
        indicator: false,
        trackUntil: 0.8,
        sweep: true,
        hits: [
          {
            offsetMs: 0,
            spec: {
              damage: 0.8,
              poise: 8,
              reaction: 'flinch',
              knockback: 0.3,
              hitStopMs: 45,
              shake: 0.1,
              shape: { kind: 'circle', radius: 0.9, forward: 0.4 },
              status: { id: 'burn', chance: 0.25 },
            },
          },
        ],
        move: { distance: 2.6, startMs: 380, endMs: 560, ease: 'out' },
        trail: 'both',
        windPose: 'POUNCE_WIND',
        hitPose: 'POUNCE_HIT',
      },
    ],
    hurtMs: 260,
    staggerMs: 1000,
    knockdownMs: 900,
    getupMs: 450,
    deathMs: 1300,
    knockbackResist: 0,
    idlePose: 'HUNCHED',
    souls: 0,
  },
  brute: {
    id: 'brute',
    name: 'Ashen Brute',
    rig: 'brute',
    stats: {
      maxHp: 1500,
      atk: 120,
      def: 60,
      critChance: 0,
      critDamage: 1,
      attackSpeed: 1,
      moveSpeed: 2.5,
    },
    poise: 140,
    radius: 0.65,
    halfHeight: 0.8,
    aggroRange: 20,
    holdDistance: 5.5,
    turnRateDeg: 240,
    attacks: [
      {
        id: 'brute_slam',
        startupMs: 950,
        activeMs: 140,
        recoveryMs: 900,
        cancelAtMs: 9999,
        range: 2.4,
        cooldownMs: 1800,
        weight: 2,
        indicator: true,
        superArmor: true,
        trackUntil: 0.45,
        hits: [
          {
            offsetMs: 0,
            spec: {
              damage: 2,
              poise: 50,
              reaction: 'knockdown',
              knockback: 2.4,
              hitStopMs: 85,
              shake: 0.55,
              shape: { kind: 'circle', radius: 2.5, forward: 1.7 },
            },
          },
        ],
        trail: 'right',
        windPose: 'SLAM_WIND',
        hitPose: 'SLAM_HIT',
      },
      {
        id: 'brute_sweep',
        startupMs: 700,
        activeMs: 160,
        recoveryMs: 750,
        cancelAtMs: 9999,
        range: 2.6,
        cooldownMs: 1500,
        weight: 1,
        indicator: true,
        superArmor: true,
        trackUntil: 0.5,
        hits: [
          {
            offsetMs: 0,
            spec: {
              damage: 1.4,
              poise: 40,
              reaction: 'knockback',
              knockback: 2.2,
              hitStopMs: 75,
              shake: 0.4,
              shape: { kind: 'arc', range: 3.2, angleDeg: 160 },
            },
          },
        ],
        trail: 'right',
        windPose: 'SWEEP_WIND',
        hitPose: 'SWEEP_HIT',
      },
    ],
    hurtMs: 280,
    staggerMs: 2200,
    knockdownMs: 1300,
    getupMs: 800,
    deathMs: 1900,
    knockbackResist: 0.6,
    idlePose: 'HUNCHED',
    souls: 2,
  },
  bulwark: {
    id: 'bulwark',
    name: 'Bulwark Sentinel',
    rig: 'bulwark',
    stats: {
      maxHp: 900,
      atk: 105,
      def: 70,
      critChance: 0,
      critDamage: 1,
      attackSpeed: 1,
      moveSpeed: 2.9,
    },
    poise: 90,
    radius: 0.5,
    halfHeight: 0.62,
    aggroRange: 20,
    holdDistance: 4.5,
    turnRateDeg: 260,
    shield: { arcDeg: 130, blockMult: 0.12, poiseMult: 0.45 },
    attacks: [
      {
        id: 'bulwark_bash',
        startupMs: 620,
        activeMs: 130,
        recoveryMs: 700,
        cancelAtMs: 9999,
        range: 1.8,
        cooldownMs: 1300,
        weight: 2,
        indicator: false,
        trackUntil: 0.55,
        hits: [
          {
            offsetMs: 0,
            spec: {
              damage: 1.2,
              poise: 25,
              reaction: 'flinch',
              knockback: 0.7,
              hitStopMs: 65,
              shake: 0.25,
              shape: { kind: 'arc', range: 2.2, angleDeg: 110 },
            },
          },
        ],
        move: { distance: 0.5, startMs: 560, endMs: 750, ease: 'out' },
        trail: 'right',
        windPose: 'CLUB_WIND',
        hitPose: 'CLUB_HIT',
      },
      {
        id: 'bulwark_shove',
        startupMs: 540,
        activeMs: 160,
        recoveryMs: 650,
        cancelAtMs: 9999,
        range: 1.6,
        cooldownMs: 2600,
        weight: 1,
        indicator: true,
        trackUntil: 0.5,
        sweep: true,
        hits: [
          {
            offsetMs: 0,
            spec: {
              damage: 0.9,
              poise: 40,
              reaction: 'knockback',
              knockback: 2.6,
              hitStopMs: 70,
              shake: 0.3,
              shape: { kind: 'circle', radius: 1.2, forward: 1 },
            },
          },
        ],
        move: { distance: 1.4, startMs: 540, endMs: 700, ease: 'out' },
        trail: 'none',
        windPose: 'THRUST_WIND',
        hitPose: 'THRUST_HIT',
      },
    ],
    hurtMs: 280,
    staggerMs: 2000,
    knockdownMs: 1200,
    getupMs: 700,
    deathMs: 1700,
    knockbackResist: 0.5,
    idlePose: 'NEUTRAL',
    souls: 1,
  },
  seer: {
    id: 'seer',
    name: 'Ember Seer',
    rig: 'seer',
    stats: {
      maxHp: 380,
      atk: 95,
      def: 25,
      critChance: 0,
      critDamage: 1,
      attackSpeed: 1,
      moveSpeed: 3.4,
    },
    poise: 25,
    radius: 0.38,
    halfHeight: 0.56,
    aggroRange: 26,
    holdDistance: 8,
    turnRateDeg: 420,
    preferredRange: 8,
    attacks: [
      {
        id: 'seer_bolt',
        startupMs: 650,
        activeMs: 80,
        recoveryMs: 700,
        cancelAtMs: 9999,
        range: 12,
        cooldownMs: 1700,
        weight: 3,
        indicator: false,
        trackUntil: 0.8,
        hits: [
          {
            offsetMs: 0,
            spec: {
              damage: 1,
              poise: 12,
              reaction: 'flinch',
              knockback: 0.5,
              hitStopMs: 45,
              shake: 0.15,
              shape: { kind: 'circle', radius: 0.4, forward: 0 },
              status: { id: 'burn', chance: 0.3 },
            },
            emit: {
              kind: 'projectile',
              projectile: {
                visual: 'bolt',
                speed: 13,
                radius: 0.4,
                rangeM: 16,
                pierce: false,
                homing: 0,
                height: 1.4,
              },
              count: 1,
              spreadDeg: 0,
              aim: 'target',
            },
          },
        ],
        trail: 'none',
        windPose: 'CAST_WIND',
        hitPose: 'CAST_HIT',
      },
      {
        id: 'seer_blast',
        startupMs: 700,
        activeMs: 100,
        recoveryMs: 800,
        cancelAtMs: 9999,
        range: 11,
        cooldownMs: 5000,
        weight: 2,
        indicator: false,
        trackUntil: 0.9,
        hits: [
          {
            offsetMs: 0,
            spec: {
              damage: 1.5,
              poise: 30,
              reaction: 'knockback',
              knockback: 1.6,
              hitStopMs: 60,
              shake: 0.3,
              shape: { kind: 'circle', radius: 2.2, forward: 0 },
              status: { id: 'burn', chance: 0.6 },
            },
            emit: {
              kind: 'zone',
              zone: { visual: 'eruption', radius: 2.2, delayMs: 950, ticks: 1, intervalMs: 0 },
              place: 'target',
              forward: 0,
              count: 1,
              scatter: 0,
            },
          },
        ],
        trail: 'none',
        windPose: 'CAST_WIND',
        hitPose: 'CAST_HIT',
      },
    ],
    hurtMs: 300,
    staggerMs: 1300,
    knockdownMs: 1000,
    getupMs: 600,
    deathMs: 1500,
    knockbackResist: 0,
    idlePose: 'NEUTRAL',
    souls: 1,
  },
  wretch: {
    id: 'wretch',
    name: 'Cinder Wretch',
    rig: 'wretch',
    stats: {
      maxHp: 220,
      atk: 120,
      def: 15,
      critChance: 0,
      critDamage: 1,
      attackSpeed: 1,
      moveSpeed: 6,
    },
    poise: 15,
    radius: 0.34,
    halfHeight: 0.4,
    aggroRange: 28,
    holdDistance: 3,
    turnRateDeg: 600,
    attacks: [
      {
        id: 'wretch_blast',
        startupMs: 700,
        activeMs: 60,
        recoveryMs: 300,
        cancelAtMs: 9999,
        range: 1.4,
        cooldownMs: 1000,
        weight: 1,
        indicator: true,
        special: 'explode',
        trackUntil: 0.3,
        hits: [
          {
            offsetMs: 0,
            spec: {
              damage: 2.4,
              poise: 40,
              reaction: 'knockback',
              knockback: 2.2,
              hitStopMs: 80,
              shake: 0.45,
              shape: { kind: 'circle', radius: 2.6, forward: 0 },
              status: { id: 'burn', chance: 0.6 },
            },
          },
        ],
        trail: 'none',
        windPose: 'CROUCH',
        hitPose: 'ARMS_WIDE',
      },
    ],
    hurtMs: 220,
    staggerMs: 900,
    knockdownMs: 800,
    getupMs: 400,
    deathMs: 600,
    knockbackResist: 0,
    idlePose: 'HUNCHED',
    souls: 0,
  },
  broodling: {
    id: 'broodling',
    name: 'Broodling',
    rig: 'imp',
    creature: 'broodling',
    stats: {
      maxHp: 170,
      atk: 55,
      def: 12,
      critChance: 0,
      critDamage: 1,
      attackSpeed: 1,
      moveSpeed: 5.2,
    },
    poise: 12,
    radius: 0.42,
    halfHeight: 0.3,
    aggroRange: 24,
    holdDistance: 3.4,
    turnRateDeg: 640,
    attacks: [
      {
        id: 'broodling_bite',
        startupMs: 420,
        activeMs: 160,
        recoveryMs: 520,
        cancelAtMs: 9999,
        range: 2.6,
        cooldownMs: 900,
        weight: 1,
        indicator: false,
        trackUntil: 0.75,
        sweep: true,
        motion: 'pounce',
        hits: [
          {
            offsetMs: 0,
            spec: {
              damage: 0.8,
              poise: 8,
              reaction: 'flinch',
              knockback: 0.3,
              hitStopMs: 45,
              shake: 0.1,
              shape: { kind: 'circle', radius: 0.95, forward: 0.5 },
              status: { id: 'bleed', chance: 0.3 },
            },
          },
        ],
        move: { distance: 2.2, startMs: 420, endMs: 580, ease: 'out' },
        trail: 'none',
        windPose: 'POUNCE_WIND',
        hitPose: 'POUNCE_HIT',
      },
    ],
    hurtMs: 240,
    staggerMs: 900,
    knockdownMs: 800,
    getupMs: 420,
    deathMs: 1200,
    knockbackResist: 0,
    idlePose: 'HUNCHED',
    souls: 0,
  },
  ash_hound: {
    id: 'ash_hound',
    name: 'Ash Hound',
    rig: 'imp',
    creature: 'ash_hound',
    stats: {
      maxHp: 300,
      atk: 75,
      def: 20,
      critChance: 0,
      critDamage: 1,
      attackSpeed: 1,
      moveSpeed: 5.8,
    },
    poise: 22,
    radius: 0.45,
    halfHeight: 0.45,
    aggroRange: 26,
    holdDistance: 4,
    turnRateDeg: 560,
    attacks: [
      {
        id: 'hound_lunge',
        startupMs: 480,
        activeMs: 180,
        recoveryMs: 600,
        cancelAtMs: 9999,
        range: 3.6,
        minRange: 1.4,
        cooldownMs: 1400,
        weight: 2,
        indicator: false,
        trackUntil: 0.7,
        sweep: true,
        motion: 'pounce',
        hits: [
          {
            offsetMs: 0,
            spec: {
              damage: 1,
              poise: 14,
              reaction: 'flinch',
              knockback: 0.6,
              hitStopMs: 55,
              shake: 0.15,
              shape: { kind: 'circle', radius: 1.0, forward: 0.6 },
              status: { id: 'burn', chance: 0.25 },
            },
          },
        ],
        move: { distance: 3.2, startMs: 480, endMs: 660, ease: 'out' },
        trail: 'none',
        windPose: 'POUNCE_WIND',
        hitPose: 'POUNCE_HIT',
      },
      {
        id: 'hound_bite',
        startupMs: 420,
        activeMs: 120,
        recoveryMs: 520,
        cancelAtMs: 9999,
        range: 1.5,
        cooldownMs: 800,
        weight: 1,
        indicator: false,
        trackUntil: 0.6,
        motion: 'bite',
        hits: [
          {
            offsetMs: 0,
            spec: {
              damage: 0.9,
              poise: 12,
              reaction: 'flinch',
              knockback: 0.4,
              hitStopMs: 50,
              shake: 0.12,
              shape: { kind: 'arc', range: 1.9, angleDeg: 90 },
            },
          },
        ],
        move: { distance: 0.5, startMs: 380, endMs: 520, ease: 'out' },
        trail: 'none',
        windPose: 'POUNCE_WIND',
        hitPose: 'POUNCE_HIT',
      },
    ],
    hurtMs: 260,
    staggerMs: 1100,
    knockdownMs: 900,
    getupMs: 450,
    deathMs: 1300,
    knockbackResist: 0.1,
    idlePose: 'HUNCHED',
    souls: 0,
  },
};
