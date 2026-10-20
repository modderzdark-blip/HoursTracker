import type { PoseName } from '../anim/poses';
import type { StatusId } from './statusEffects';

/** Hit area relative to the attacker's feet and facing. Distances in metres. */
export type HitShape =
  /** Cone in front of the attacker. */
  | { readonly kind: 'arc'; readonly range: number; readonly angleDeg: number }
  /** Circle whose centre is `forward` metres ahead of the attacker. */
  | { readonly kind: 'circle'; readonly radius: number; readonly forward: number }
  /** Rectangle starting `forward` metres ahead, extending `length` along the facing. */
  | {
      readonly kind: 'box';
      readonly length: number;
      readonly width: number;
      readonly forward: number;
    };

export type Reaction = 'flinch' | 'knockback' | 'launch' | 'knockdown';

export interface HitSpec {
  /** Skill multiplier in the damage formula. */
  readonly damage: number;
  readonly poise: number;
  readonly reaction: Reaction;
  /** Metres the target is pushed (knockback/launch/knockdown). */
  readonly knockback: number;
  readonly hitStopMs: number;
  /** Camera trauma added on hit (0..1). */
  readonly shake: number;
  readonly shape: HitShape;
  readonly status?: { readonly id: StatusId; readonly chance: number };
  /** Heals the attacker this fraction of the damage dealt (life drain). */
  readonly drain?: number;
  /** Drags the target toward the attacker instead of pushing it away (taunts, hooks). */
  readonly pull?: boolean;
}

/** A projectile fired by an action (arrows, bolts, fireballs). */
export interface ProjectileDef {
  /** 'orb': slow glowing bullet for enemy patterns (reads clearly, easy to weave through). */
  readonly visual: 'arrow' | 'bolt' | 'fireball' | 'shadow' | 'orb';
  /** Tint (defaults per visual). */
  readonly color?: number;
  /** m/s */
  readonly speed: number;
  /** Hit radius (m). */
  readonly radius: number;
  /** Maximum travel distance (m). */
  readonly rangeM: number;
  /** Keeps flying after a hit (each target is hit once). */
  readonly pierce: boolean;
  /** Turn rate toward the nearest opponent (rad/s); 0 = straight. */
  readonly homing: number;
  /** Launch height above the feet (m). */
  readonly height: number;
  /** Blast on impact or at the end of its range (fireballs). */
  readonly explodeRadius?: number;
}

/** A ground effect: a delayed blast, repeated ticks (rain), or a proximity trap. */
export interface ZoneDef {
  readonly visual: 'rain' | 'trap' | 'shockwave' | 'meteor' | 'fire' | 'eruption';
  readonly radius: number;
  /** Time before the first hit (shown as a ground telegraph). */
  readonly delayMs: number;
  readonly ticks: number;
  readonly intervalMs: number;
  /** Trap: waits (up to lifeMs) until an opponent steps inside, then fires its ticks. */
  readonly trigger?: 'proximity';
  readonly lifeMs?: number;
}

/** What a timed hit releases instead of a melee strike. */
export type EmitDef =
  | {
      readonly kind: 'projectile';
      readonly projectile: ProjectileDef;
      readonly count: number;
      /** Total fan angle across `count` projectiles. */
      readonly spreadDeg: number;
      /** 'target' aims at the nearest opponent in front (falls back to facing). */
      readonly aim: 'facing' | 'target';
      /** 'ring': `count` projectiles evenly around 360° (spreadDeg ignored). Default 'fan'. */
      readonly pattern?: 'fan' | 'ring';
      /** Rotates the whole pattern (spirals: increase it over successive hits). */
      readonly angleOffsetDeg?: number;
    }
  | {
      readonly kind: 'zone';
      readonly zone: ZoneDef;
      /** Where: on the actor, `forward` m ahead, or at the (locked) target position. */
      readonly place: 'self' | 'forward' | 'target';
      readonly forward: number;
      readonly count: number;
      /** Random scatter radius around the placement point (multiple zones). */
      readonly scatter: number;
    };

export interface TimedHit {
  /** Offset from the start of the active phase. */
  readonly offsetMs: number;
  readonly spec: HitSpec;
  /** Releases a projectile / zone carrying `spec` instead of a melee strike. */
  readonly emit?: EmitDef;
}

/** Data-driven displacement along the facing ("root motion" for placeholder clips). */
export interface MoveSpec {
  readonly distance: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly ease: 'linear' | 'out' | 'inOut';
}

export type TrailSide = 'right' | 'left' | 'both' | 'none';

/** Shaped battle effects (src/vfx/Fx.ts). */
export type FxShape = 'ring' | 'slash' | 'pillar' | 'flash' | 'cracks' | 'nova' | 'scorch';

/**
 * A visual cue an action plays: a shaped effect, a smoke puff or a screen flash, at the action's
 * start, when it becomes active, or after a delay; placed in the actor's frame.
 */
export interface FxCue {
  readonly shape: FxShape | 'smoke' | 'screen';
  /** 'start' (default), 'active' (the strike), or seconds after the start (at speed 1). */
  readonly at?: 'start' | 'active' | number;
  /** Offset in the actor's frame: forward, up, right (m). */
  readonly offset?: readonly [number, number, number];
  /** Place at the action's locked target instead of the actor (leaps, rains, meteors). */
  readonly atTarget?: boolean;
  readonly scale?: number;
  readonly color?: number;
  readonly life?: number;
  /** Slash roll: 0 horizontal sweep, ±π/2 vertical chop. */
  readonly tilt?: number;
  readonly yawOffset?: number;
  readonly mirror?: boolean;
  /** Screen cue: flash strength (0..1); smoke: number of puffs. */
  readonly amount?: number;
  /** Repeat the cue this many times (default 1), `every` seconds apart. */
  readonly repeat?: number;
  readonly every?: number;
  /** Extra yaw added per repeat (radians): spinning slash storms. */
  readonly spin?: number;
  /** Random scatter radius around the placement point (m). */
  readonly spread?: number;
  /** Camera shake (trauma 0..1) when the cue fires. */
  readonly shake?: number;
  /** Slow motion when the cue fires: time scale for this many ms. */
  readonly slowMoMs?: number;
}

/** A timed action (combo step, skill, ultimate, enemy attack). Times in ms at speed 1. */
export interface ActionDef {
  readonly id: string;
  readonly startupMs: number;
  readonly activeMs: number;
  readonly recoveryMs: number;
  /** From the action start: after this, attack/dodge/skill input may interrupt. */
  readonly cancelAtMs: number;
  readonly hits: readonly TimedHit[];
  /** Re-test the hit shape every logic step during the active phase (each target once). */
  readonly sweep?: boolean;
  readonly move?: MoveSpec;
  readonly superArmor?: boolean;
  /** Multiplier on damage taken while the action runs (guard stances; 1 = none). */
  readonly damageTakenMult?: number;
  readonly invulnerable?: { readonly fromMs: number; readonly toMs: number };
  readonly trail: TrailSide;
  /** Animation: wind-up pose, hit pose; the clip is built to match the timings. */
  readonly windPose: PoseName;
  readonly hitPose: PoseName;
  /** Optional custom clip name (spins, rolls) instead of the wind/hit transition. */
  readonly clip?: string;
  /** Visual cues (melee actions without any get an automatic slash arc). */
  readonly fx?: readonly FxCue[];
}

/** Core combat stats. Same shape for heroes, enemies and bosses. */
export interface StatBlock {
  readonly maxHp: number;
  readonly atk: number;
  readonly def: number;
  /** 0..1 */
  readonly critChance: number;
  /** Multiplier applied on crit (e.g. 1.6 = +60%). */
  readonly critDamage: number;
  /** 1 = normal; 1.2 = actions 20% faster. */
  readonly attackSpeed: number;
  /** m/s */
  readonly moveSpeed: number;
}
