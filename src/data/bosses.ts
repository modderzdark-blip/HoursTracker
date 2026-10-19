import type { EnemyAttackDef, EnemyDef } from './enemies';
import type { HitSpec } from './combatTypes';

export interface BossPhaseDef {
  /** The phase begins when HP fraction drops to or below this value (phase 1 = 1). */
  readonly fromHpFrac: number;
  readonly attacks: readonly string[];
  readonly speedMult: number;
  readonly damageMult: number;
  readonly weaponFx: boolean;
  readonly label: string;
}

export interface BossDef extends EnemyDef {
  readonly title: string;
  readonly phases: readonly BossPhaseDef[];
  /** Break bar: depleted by poise damage; when empty the boss is stunned. */
  readonly breakMax: number;
  readonly breakStunMs: number;
  /** Extra damage taken while broken (0.5 = +50%). */
  readonly breakDamageBonus: number;
  readonly enrageAfterMs: number;
  readonly enrageDamageMult: number;
  readonly enrageSpeedMult: number;
  readonly introMs: number;
  readonly transitionMs: number;
  /** Phase-change shockwave: pushes the player away (no damage). */
  readonly transitionPushRadius: number;
}

export type BossId = 'hollow_warden' | 'gaoler';

const heavy = (damage: number, shape: HitSpec['shape'], extra: Partial<HitSpec> = {}): HitSpec => ({
  damage,
  poise: 0,
  reaction: 'knockback',
  knockback: 1.8,
  hitStopMs: 80,
  shake: 0.45,
  shape,
  ...extra,
});

const WARDEN_ATTACKS: readonly EnemyAttackDef[] = [
  {
    id: 'warden_cleave',
    startupMs: 720,
    activeMs: 160,
    recoveryMs: 650,
    cancelAtMs: 9999,
    range: 3.6,
    cooldownMs: 600,
    weight: 3,
    indicator: true,
    trackUntil: 0.55,
    chainNext: 'warden_backhand',
    chainChance: 0.55,
    hits: [{ offsetMs: 0, spec: heavy(1.6, { kind: 'arc', range: 5.2, angleDeg: 150 }) }],
    move: { distance: 1.2, startMs: 600, endMs: 880, ease: 'out' },
    trail: 'right',
    windPose: 'SWEEP_WIND',
    hitPose: 'SWEEP_HIT',
  },
  {
    id: 'warden_backhand',
    startupMs: 480,
    activeMs: 160,
    recoveryMs: 950,
    cancelAtMs: 9999,
    range: 4.0,
    cooldownMs: 800,
    weight: 0,
    indicator: true,
    trackUntil: 0.5,
    hits: [{ offsetMs: 0, spec: heavy(1.4, { kind: 'arc', range: 5.2, angleDeg: 150 }) }],
    trail: 'right',
    windPose: 'SWEEP_BACK_WIND',
    hitPose: 'SWEEP_BACK_HIT',
  },
  {
    id: 'warden_thrust',
    startupMs: 820,
    activeMs: 200,
    recoveryMs: 1000,
    cancelAtMs: 9999,
    range: 7,
    minRange: 2.5,
    cooldownMs: 2200,
    weight: 2,
    indicator: true,
    trackUntil: 0.6,
    sweep: true,
    hits: [
      {
        offsetMs: 0,
        spec: heavy(
          1.8,
          { kind: 'box', length: 6.5, width: 1.8, forward: 0.3 },
          { reaction: 'knockdown', knockback: 2.6 },
        ),
      },
    ],
    move: { distance: 3.2, startMs: 820, endMs: 1020, ease: 'out' },
    trail: 'right',
    windPose: 'THRUST_WIND',
    hitPose: 'THRUST_HIT',
  },
  {
    id: 'warden_flame_cleave',
    startupMs: 680,
    activeMs: 180,
    recoveryMs: 650,
    cancelAtMs: 9999,
    range: 4.0,
    cooldownMs: 600,
    weight: 3,
    indicator: true,
    trackUntil: 0.55,
    chainNext: 'warden_backhand',
    chainChance: 0.6,
    hits: [
      {
        offsetMs: 0,
        spec: heavy(
          1.7,
          { kind: 'arc', range: 6, angleDeg: 190 },
          { status: { id: 'burn', chance: 0.7 } },
        ),
      },
    ],
    move: { distance: 1.2, startMs: 560, endMs: 860, ease: 'out' },
    trail: 'right',
    windPose: 'SWEEP_WIND',
    hitPose: 'SWEEP_HIT',
  },
  {
    id: 'warden_flame_arc',
    startupMs: 950,
    activeMs: 220,
    recoveryMs: 950,
    cancelAtMs: 9999,
    range: 6,
    cooldownMs: 2600,
    weight: 2,
    indicator: true,
    trackUntil: 0.4,
    hits: [
      {
        offsetMs: 0,
        spec: heavy(
          2.0,
          { kind: 'arc', range: 7.5, angleDeg: 230 },
          { status: { id: 'burn', chance: 1 }, shake: 0.6 },
        ),
      },
    ],
    trail: 'right',
    windPose: 'OVERHEAD_WIND',
    hitPose: 'OVERHEAD_HIT',
  },
  {
    id: 'warden_leap',
    startupMs: 1150,
    activeMs: 200,
    recoveryMs: 1150,
    cancelAtMs: 9999,
    range: 16,
    minRange: 3,
    cooldownMs: 2400,
    weight: 3,
    indicator: true,
    special: 'leap',
    trackUntil: 0.45,
    chainNext: 'warden_leap',
    chainChance: 0.35,
    hits: [
      {
        offsetMs: 0,
        spec: heavy(
          2.6,
          { kind: 'circle', radius: 3.8, forward: 0 },
          {
            reaction: 'knockdown',
            knockback: 3,
            hitStopMs: 100,
            shake: 0.75,
          },
        ),
      },
    ],
    trail: 'none',
    windPose: 'OVERHEAD_WIND',
    hitPose: 'SLAM_HIT',
  },
];

const GAOLER_ATTACKS: readonly EnemyAttackDef[] = [
  {
    id: 'gaoler_slam',
    startupMs: 900,
    activeMs: 150,
    recoveryMs: 850,
    cancelAtMs: 9999,
    range: 2.8,
    cooldownMs: 1500,
    weight: 3,
    indicator: true,
    trackUntil: 0.5,
    hits: [
      {
        offsetMs: 0,
        spec: heavy(
          1.9,
          { kind: 'circle', radius: 3, forward: 2 },
          { reaction: 'knockdown', knockback: 2.4 },
        ),
      },
    ],
    trail: 'right',
    windPose: 'SLAM_WIND',
    hitPose: 'SLAM_HIT',
  },
  {
    id: 'gaoler_sweep',
    startupMs: 700,
    activeMs: 170,
    recoveryMs: 700,
    cancelAtMs: 9999,
    range: 3.2,
    cooldownMs: 1200,
    weight: 2,
    indicator: true,
    trackUntil: 0.5,
    chainNext: 'gaoler_slam',
    chainChance: 0.4,
    hits: [{ offsetMs: 0, spec: heavy(1.4, { kind: 'arc', range: 4.2, angleDeg: 170 }) }],
    trail: 'right',
    windPose: 'SWEEP_WIND',
    hitPose: 'SWEEP_HIT',
  },
  {
    id: 'gaoler_charge',
    startupMs: 850,
    activeMs: 350,
    recoveryMs: 900,
    cancelAtMs: 9999,
    range: 10,
    minRange: 3.5,
    cooldownMs: 3200,
    weight: 2,
    indicator: true,
    trackUntil: 0.6,
    sweep: true,
    hits: [
      {
        offsetMs: 0,
        spec: heavy(
          1.6,
          { kind: 'circle', radius: 1.6, forward: 0.8 },
          { reaction: 'knockdown', knockback: 3 },
        ),
      },
    ],
    move: { distance: 7.5, startMs: 850, endMs: 1200, ease: 'linear' },
    trail: 'none',
    windPose: 'CROUCH',
    hitPose: 'DASH_LEAN',
  },
];

export const BOSSES: Readonly<Record<BossId, BossDef>> = {
  gaoler: {
    id: 'gaoler',
    name: 'The Gaoler',
    title: 'Chainmaster of the Ash Pits',
    rig: 'gaoler',
    stats: {
      maxHp: 4200,
      atk: 125,
      def: 60,
      critChance: 0,
      critDamage: 1,
      attackSpeed: 1,
      moveSpeed: 2.9,
    },
    poise: 380,
    radius: 0.85,
    halfHeight: 1.05,
    aggroRange: 60,
    holdDistance: 3.5,
    turnRateDeg: 200,
    attacks: GAOLER_ATTACKS,
    hurtMs: 0,
    staggerMs: 3000,
    knockdownMs: 0,
    getupMs: 0,
    deathMs: 2600,
    knockbackResist: 1,
    idlePose: 'HUNCHED',
    souls: 12,
    phases: [
      {
        fromHpFrac: 1,
        attacks: ['gaoler_slam', 'gaoler_sweep', 'gaoler_charge'],
        speedMult: 1,
        damageMult: 1,
        weaponFx: false,
        label: 'I',
      },
      {
        fromHpFrac: 0.45,
        attacks: ['gaoler_slam', 'gaoler_sweep', 'gaoler_charge'],
        speedMult: 1.2,
        damageMult: 1.15,
        weaponFx: true,
        label: 'II',
      },
    ],
    breakMax: 380,
    breakStunMs: 3200,
    breakDamageBonus: 0.5,
    enrageAfterMs: 150_000,
    enrageDamageMult: 1.4,
    enrageSpeedMult: 1.25,
    introMs: 2600,
    transitionMs: 1500,
    transitionPushRadius: 5.5,
  },
  hollow_warden: {
    id: 'hollow_warden',
    name: 'The Hollow Warden',
    title: 'Keeper of the Cinder Gate',
    rig: 'warden',
    stats: {
      maxHp: 9000,
      atk: 150,
      def: 80,
      critChance: 0,
      critDamage: 1,
      attackSpeed: 1,
      moveSpeed: 3.1,
    },
    poise: 600,
    radius: 1.05,
    halfHeight: 1.35,
    aggroRange: 60,
    holdDistance: 3.5,
    turnRateDeg: 160,
    attacks: WARDEN_ATTACKS,
    hurtMs: 0,
    staggerMs: 3500,
    knockdownMs: 0,
    getupMs: 0,
    deathMs: 3200,
    knockbackResist: 1,
    idlePose: 'NEUTRAL',
    souls: 25,
    phases: [
      {
        fromHpFrac: 1,
        attacks: ['warden_cleave', 'warden_thrust'],
        speedMult: 1,
        damageMult: 1,
        weaponFx: false,
        label: 'I',
      },
      {
        fromHpFrac: 0.6,
        attacks: ['warden_flame_cleave', 'warden_flame_arc', 'warden_thrust'],
        speedMult: 1.1,
        damageMult: 1.1,
        weaponFx: true,
        label: 'II',
      },
      {
        fromHpFrac: 0.3,
        attacks: ['warden_flame_cleave', 'warden_leap', 'warden_flame_arc'],
        speedMult: 1.25,
        damageMult: 1.2,
        weaponFx: true,
        label: 'III',
      },
    ],
    breakMax: 600,
    breakStunMs: 3500,
    breakDamageBonus: 0.5,
    enrageAfterMs: 180_000,
    enrageDamageMult: 1.5,
    enrageSpeedMult: 1.3,
    introMs: 3200,
    transitionMs: 1800,
    transitionPushRadius: 7,
  },
};
