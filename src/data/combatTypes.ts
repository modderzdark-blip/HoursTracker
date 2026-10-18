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
}

export interface TimedHit {
  /** Offset from the start of the active phase. */
  readonly offsetMs: number;
  readonly spec: HitSpec;
}

/** Data-driven displacement along the facing ("root motion" for placeholder clips). */
export interface MoveSpec {
  readonly distance: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly ease: 'linear' | 'out' | 'inOut';
}

export type TrailSide = 'right' | 'left' | 'both' | 'none';

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
  readonly invulnerable?: { readonly fromMs: number; readonly toMs: number };
  readonly trail: TrailSide;
  /** Animation: wind-up pose, hit pose; the clip is built to match the timings. */
  readonly windPose: PoseName;
  readonly hitPose: PoseName;
  /** Optional custom clip name (spins, rolls) instead of the wind/hit transition. */
  readonly clip?: string;
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
