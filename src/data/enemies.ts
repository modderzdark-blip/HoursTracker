import type { ActionDef, StatBlock } from './combatTypes';
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
  /** 'leap': jump onto the target point locked at telegraph start (boss). */
  readonly special?: 'leap';
  /** Track the player's position while telegraphing until this fraction of the telegraph. */
  readonly trackUntil?: number;
}

export type EnemyId = 'thrall' | 'imp' | 'brute';

export interface EnemyDef {
  readonly id: string;
  readonly name: string;
  readonly rig: RigId;
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
};
