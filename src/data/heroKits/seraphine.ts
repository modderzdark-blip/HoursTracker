/**
 * Seraphine, the Ember Witch — staff caster. Her combo is a string of fire bolts ending in an
 * exploding fireball (no melee: she wins by keeping her distance); skills are a cone of flame,
 * a frost nova that slows everything around her and a brand that calls a falling star onto the
 * target; the ultimate rains a storm of them.
 */
import type { ProjectileDef } from '../combatTypes';
import type { HeroDef } from '../heroes';
import { arc, circle, fx, fxAtTarget, projectiles, strike, zoneAt } from './kit';

const CRIMSON = 0xff4628;
const EMBER = 0xffa040;
const FROST = 0x9ae6ff;

const EMBER_BOLT: ProjectileDef = {
  visual: 'fireball',
  speed: 22,
  radius: 0.4,
  rangeM: 15,
  pierce: false,
  homing: 1.5,
  height: 1.35,
};

const GREAT_FIREBALL: ProjectileDef = {
  ...EMBER_BOLT,
  speed: 17,
  radius: 0.5,
  rangeM: 16,
  explodeRadius: 2.4,
};

const bolt = (damage: number): ReturnType<typeof strike> =>
  strike(damage, circle(0.4, 0), { poise: 8, knockback: 0.3, hitStopMs: 30, shake: 0.05 });

const castFlash = fx('flash', 'active', [0.9, 1.4, 0.15], 0.7, { life: 0.15, color: EMBER });

export const SERAPHINE: HeroDef = {
  id: 'seraphine',
  name: 'Seraphine',
  epithet: 'the Ember Witch',
  role: 'Fire staff — bolts, flame and falling stars from afar.',
  growth: { maxHp: 0.07, atk: 0.078, def: 0.05 },
  color: CRIMSON,
  unlock: { souls: 200, afterStage: 'c2s8' },
  stats: {
    maxHp: 950,
    atk: 118,
    def: 28,
    critChance: 0.14,
    critDamage: 1.7,
    attackSpeed: 1,
    moveSpeed: 6.3,
  },
  movement: { acceleration: 50, deceleration: 62, turnRateDeg: 940 },
  body: { capsuleRadius: 0.31, capsuleHalfHeight: 0.54 },
  visual: { kind: 'rig', rig: 'seraphine' },
  idlePose: 'STAFF_READY',
  comboResetMs: 480,
  combo: [
    {
      id: 'seraphine_bolt1',
      startupMs: 190,
      activeMs: 60,
      recoveryMs: 230,
      cancelAtMs: 240,
      hits: [{ offsetMs: 0, spec: bolt(0.8), emit: projectiles(EMBER_BOLT) }],
      trail: 'none',
      windPose: 'STAFF_CAST_WIND',
      hitPose: 'STAFF_CAST_HIT',
      fx: [castFlash],
    },
    {
      id: 'seraphine_bolt2',
      startupMs: 170,
      activeMs: 60,
      recoveryMs: 240,
      cancelAtMs: 230,
      hits: [{ offsetMs: 0, spec: bolt(0.85), emit: projectiles(EMBER_BOLT) }],
      trail: 'none',
      windPose: 'STAFF_CAST_WIND',
      hitPose: 'STAFF_CAST_HIT',
      fx: [castFlash],
    },
    {
      id: 'seraphine_bolt3',
      startupMs: 230,
      activeMs: 60,
      recoveryMs: 330,
      cancelAtMs: 340,
      hits: [
        {
          offsetMs: 0,
          spec: bolt(0.55),
          emit: projectiles(EMBER_BOLT, 3, 26),
        },
      ],
      trail: 'none',
      windPose: 'STAFF_CAST_WIND',
      hitPose: 'STAFF_CAST_HIT',
      fx: [castFlash, fx('ring', 'active', [0.6, 0, 0], 1, { life: 0.3, color: EMBER })],
    },
    {
      id: 'seraphine_bolt4',
      startupMs: 340,
      activeMs: 80,
      recoveryMs: 420,
      cancelAtMs: 520,
      hits: [
        {
          offsetMs: 0,
          spec: strike(1.6, circle(0.5, 0), {
            poise: 30,
            reaction: 'knockback',
            knockback: 1.4,
            hitStopMs: 50,
            shake: 0.25,
            status: { id: 'burn', chance: 0.6 },
          }),
          emit: projectiles(GREAT_FIREBALL),
        },
      ],
      trail: 'none',
      windPose: 'STAFF_RAISE',
      hitPose: 'STAFF_CAST_HIT',
      fx: [
        fx('flash', 'start', [0.3, 2.3, 0.2], 1, { life: 0.35, color: EMBER }),
        fx('flash', 'active', [1, 1.4, 0.15], 1.2, { life: 0.2 }),
        fx('ring', 'active', [0.8, 0, 0], 1.4, { life: 0.35 }),
      ],
    },
  ],
  dodge: {
    durationMs: 340,
    iframeStartMs: 0,
    iframeEndMs: 300,
    distance: 5,
    cooldownMs: 420,
    perfectWindowMs: 150,
    slowMoScale: 0.3,
    slowMoMs: 700,
    counterWindowMs: 1500,
    counterDamageMult: 1.5,
  },
  skills: [
    {
      id: 'seraphine_cinderWave',
      name: 'Cinder Wave',
      cooldownMs: 5500,
      special: 'none',
      startupMs: 260,
      activeMs: 100,
      recoveryMs: 360,
      cancelAtMs: 520,
      hits: [
        {
          offsetMs: 0,
          spec: strike(2.2, arc(6, 70), {
            poise: 40,
            reaction: 'knockback',
            knockback: 1.8,
            hitStopMs: 60,
            shake: 0.3,
            status: { id: 'burn', chance: 1 },
          }),
        },
      ],
      trail: 'none',
      windPose: 'STAFF_CAST_WIND',
      hitPose: 'STAFF_CAST_HIT',
      fx: [
        fx('flash', 'start', [0.4, 1.9, 0.2], 0.8, { life: 0.3, color: EMBER }),
        fx('slash', 'active', [0.6, 1.0, 0], 3.2, { life: 0.35, tilt: 0 }),
        fx('slash', 0.31, [1.5, 0.8, 0], 5, { life: 0.4, tilt: -0.1, color: EMBER }),
        fx('cracks', 'active', [3, 0, 0], 3, { life: 1 }),
        fx('flash', 'active', [3.5, 0.8, 0], 2.2, { life: 0.22, color: EMBER }),
        fx('flash', 0.34, [5, 0.6, 0], 1.6, { life: 0.2 }),
        fx('smoke', 0.34, [4, 0.4, 0], 2, { amount: 10 }),
        fx('screen', 'active', [0, 0, 0], 0.4, { amount: 0.15 }),
      ],
    },
    {
      id: 'seraphine_frostNova',
      name: 'Frost Nova',
      cooldownMs: 8000,
      special: 'none',
      startupMs: 220,
      activeMs: 100,
      recoveryMs: 380,
      cancelAtMs: 500,
      invulnerable: { fromMs: 0, toMs: 320 },
      hits: [
        {
          offsetMs: 0,
          spec: strike(1.5, circle(4.6, 0), {
            poise: 45,
            reaction: 'knockback',
            knockback: 1.8,
            hitStopMs: 70,
            shake: 0.35,
            status: { id: 'slow', chance: 1 },
          }),
        },
      ],
      trail: 'none',
      windPose: 'NOVA_WIND',
      hitPose: 'NOVA_HIT',
      fx: [
        fx('smoke', 'start', [0, 0.3, 0], 1, { amount: 6 }),
        fx('nova', 'active', [0, 0.6, 0], 2.6, { life: 0.6, color: FROST }),
        fx('ring', 'active', [0, 0, 0], 4.8, { life: 0.5, color: FROST }),
        fx('ring', 0.3, [0, 0, 0], 3, { life: 0.45, color: 0xffffff }),
        fx('cracks', 'active', [0, 0, 0], 4.4, { life: 1.3, color: FROST }),
        fx('pillar', 'active', [0, 0, 0], 0.9, { life: 0.5, color: FROST }),
        fx('flash', 'active', [0, 1.2, 0], 2, { life: 0.2, color: FROST }),
        fx('smoke', 'active', [0, 0.3, 0], 3, { amount: 14 }),
        fx('screen', 'active', [0, 0, 0], 0.8, { amount: 0.3, color: FROST }),
      ],
    },
    {
      id: 'seraphine_starfall',
      name: 'Starfall Brand',
      cooldownMs: 9000,
      special: 'none',
      startupMs: 320,
      activeMs: 80,
      recoveryMs: 360,
      cancelAtMs: 500,
      hits: [
        {
          offsetMs: 0,
          spec: strike(3.4, circle(0.1, 0), {
            poise: 70,
            reaction: 'knockdown',
            knockback: 1.6,
            hitStopMs: 90,
            shake: 0.55,
            status: { id: 'burn', chance: 1 },
          }),
          emit: zoneAt(
            { visual: 'meteor', radius: 3.2, delayMs: 650, ticks: 1, intervalMs: 0 },
            'target',
            7,
          ),
        },
      ],
      trail: 'none',
      windPose: 'STAFF_CAST_WIND',
      hitPose: 'STAFF_RAISE',
      fx: [
        fx('flash', 'active', [0.3, 2.5, 0.2], 1.2, { life: 0.3, color: EMBER }),
        fxAtTarget('pillar', 'active', 0, 1, { life: 0.7, color: EMBER }),
        fxAtTarget('ring', 'active', 0, 3.2, { life: 0.65 }),
        fxAtTarget('cracks', 0.97, 0, 3.2, { life: 1.2 }),
        fxAtTarget('ring', 0.97, 0, 3.6, { life: 0.5, color: EMBER }),
        fxAtTarget('nova', 0.97, 0.5, 2.2, { life: 0.45 }),
        fxAtTarget('pillar', 0.97, 0, 2, { life: 0.6, color: EMBER }),
        fxAtTarget('smoke', 0.97, 0.4, 2.5, { amount: 16 }),
        fx('screen', 0.97, [0, 0, 0], 0.8, { amount: 0.35 }),
      ],
    },
  ],
  ultimate: {
    id: 'seraphine_pyre',
    name: 'Pyre of Heaven',
    clones: 0,
    startupMs: 600,
    activeMs: 2100,
    recoveryMs: 500,
    cancelAtMs: 3050,
    invulnerable: { fromMs: 0, toMs: 3200 },
    superArmor: true,
    hits: [
      ...[0, 300, 600, 900, 1200, 1500, 1800].map((offsetMs) => ({
        offsetMs,
        spec: strike(1.0, circle(0.1, 0), {
          poise: 40,
          reaction: 'knockback' as const,
          knockback: 1.2,
          hitStopMs: 40,
          shake: 0.4,
          status: { id: 'burn' as const, chance: 1 },
        }),
        emit: zoneAt(
          { visual: 'meteor', radius: 2.8, delayMs: 450, ticks: 1, intervalMs: 0 },
          'target',
          6,
          2,
          3,
        ),
      })),
      {
        offsetMs: 2000,
        spec: strike(0.5, circle(0.1, 0), {
          poise: 5,
          knockback: 0,
          hitStopMs: 0,
          shake: 0.05,
          status: { id: 'burn', chance: 1 },
        }),
        emit: zoneAt(
          { visual: 'fire', radius: 4.5, delayMs: 0, ticks: 4, intervalMs: 300 },
          'target',
          6,
        ),
      },
    ],
    trail: 'none',
    windPose: 'STAFF_CAST_WIND',
    hitPose: 'STAFF_RAISE',
    clip: 'seraphine_ult',
    fx: [
      fx('ring', 'start', [0, 0, 0], 1.8, { life: 0.8, color: EMBER }),
      fx('nova', 'start', [0, 1.2, 0], 1.6, { life: 0.8 }),
      fx('cracks', 'start', [0, 0, 0], 2.4, { life: 3 }),
      fx('screen', 'active', [0, 0, 0], 0.6, { amount: 0.25 }),
      ...[0, 1, 2, 3, 4, 5, 6].flatMap((i) => {
        const t = 0.6 + 0.3 * i + 0.45;
        return [
          fxAtTarget('pillar', t, 0, 1.6, { life: 0.5, color: EMBER }),
          fxAtTarget('ring', t, 0, 3.5, { life: 0.45 }),
        ];
      }),
      fxAtTarget('cracks', 2.6, 0, 5, { life: 2 }),
      fxAtTarget('nova', 2.6, 0.5, 3, { life: 0.6 }),
      fxAtTarget('smoke', 2.6, 0.4, 3.5, { amount: 20 }),
      fx('screen', 2.6, [0, 0, 0], 1, { amount: 0.45 }),
    ],
  },
  ultGainPerDamage: 1 / 2600,
  ultGainPerHpLost: 0.6,
  autoAim: { rangeM: 14, coneDeg: 170 },
  hurtMs: 290,
  knockdownMs: 900,
  getupMs: 520,
};
