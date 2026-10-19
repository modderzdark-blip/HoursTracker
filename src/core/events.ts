import type { InputAction } from '../input/actions';
import type { QualityLevel, QualitySetting } from '../data/quality';
import type { StatusId } from '../data/statusEffects';

export type TeamName = 'player' | 'enemy' | 'neutral';

/**
 * Hit payload. The combat system reuses ONE instance for every hit (no allocation in combat):
 * listeners must read it synchronously and never keep a reference.
 */
export interface HitEvent {
  attackerId: number;
  targetId: number;
  targetTeam: TeamName;
  amount: number;
  crit: boolean;
  killed: boolean;
  poiseBroken: boolean;
  counter: boolean;
  /** Absorbed by a shield (reduced damage). */
  blocked: boolean;
  /** Damage over time tick (no hit-stop/shake). */
  dot: boolean;
  status: StatusId | null;
  x: number;
  y: number;
  z: number;
  dirX: number;
  dirZ: number;
  hitStopMs: number;
  shake: number;
}

/** Every event that crosses module boundaries. */
export interface GameEvents {
  'input:pressed': { readonly action: InputAction; readonly timeMs: number };
  'input:released': { readonly action: InputAction; readonly timeMs: number };
  'game:paused': { readonly paused: boolean };
  'quality:applied': { readonly level: QualityLevel; readonly setting: QualitySetting };
  'camera:shake': { readonly trauma: number };
  'time:hitStop': { readonly ms: number };
  'time:slowMotion': { readonly scale: number; readonly ms: number };
  'app:visibility': { readonly hidden: boolean };
  'ultimate:charge': { readonly value: number };
  'combat:hit': HitEvent;
  'combat:evaded': { readonly targetId: number; readonly perfect: boolean };
  'combat:death': {
    readonly actorId: number;
    readonly team: TeamName;
    readonly x: number;
    readonly z: number;
  };
  'player:perfectDodge': { readonly x: number; readonly z: number };
  'player:action': {
    readonly kind: 'attack' | 'dodge' | 'skill' | 'ultimate';
    readonly index: number;
  };
  'player:died': Record<string, never>;
  'player:revived': Record<string, never>;
  'enemy:telegraph': { readonly actorId: number; readonly attackId: string };
  'enemy:exploded': { readonly x: number; readonly z: number; readonly radius: number };
  'boss:grab': { readonly holding: boolean };
  'boss:phase': { readonly phase: number; readonly label: string };
  'boss:break': { readonly broken: boolean };
  'boss:enrage': Record<string, never>;
  'boss:defeated': { readonly souls: number; readonly x: number; readonly z: number };
  'wave:start': { readonly wave: number; readonly total: number };
  'wave:cleared': { readonly wave: number };
  'stage:bossIntro': Record<string, never>;
  'stage:victory': Record<string, never>;
}
