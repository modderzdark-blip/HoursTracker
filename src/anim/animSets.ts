import type { AnimationClip } from 'three';
import type { ActionDef } from '../data/combatTypes';
import type { EnemyDef } from '../data/enemies';
import type { HeroDef } from '../data/heroes';
import {
  buildActionClip,
  buildCustomActionClip,
  buildEnemyAttackClips,
  buildHumanoidClips,
} from './clipSets';
import { buildHeroMoveClips } from './heroMoves';
import { heroStyle, rigStyle } from './motionStyles';
import { POSE_LIBRARY } from './poses';

/** Clips one character type plays: base-layer clips and additive reactions. */
export interface AnimSet {
  readonly clips: readonly AnimationClip[];
  readonly additive: readonly AnimationClip[];
}

const heroSets = new Map<string, AnimSet>();
const enemySets = new Map<string, AnimSet>();

/** Every action a hero can perform (combo, ranged combo, skills, ultimate). */
export function heroActions(hero: HeroDef): ActionDef[] {
  return [...hero.combo, ...(hero.rangedCombo ?? []), ...hero.skills, hero.ultimate];
}

/**
 * The complete clip set of a hero, built once and shared by every instance (player, arena
 * duelist, hub dais): AnimationClips are immutable and can drive any number of mixers.
 */
export function heroAnimSet(hero: HeroDef): AnimSet {
  const hit = heroSets.get(hero.id);
  if (hit !== undefined) return hit;
  const idle = POSE_LIBRARY[hero.idlePose];
  const base = buildHumanoidClips(idle, heroStyle(hero.id));
  const clips = [...base.clips, ...buildHeroMoveClips(hero.id, idle)];
  for (const a of heroActions(hero)) {
    clips.push(
      a.clip !== undefined ? buildCustomActionClip(a.clip, a, idle) : buildActionClip(a, idle),
    );
  }
  const set: AnimSet = { clips, additive: base.additive };
  heroSets.set(hero.id, set);
  return set;
}

/** Clip set of a humanoid enemy type (shared by its whole pool). */
export function enemyAnimSet(def: EnemyDef): AnimSet {
  const hit = enemySets.get(def.id);
  if (hit !== undefined) return hit;
  const idle = POSE_LIBRARY[def.idlePose];
  const style = rigStyle(def.rig);
  const base = buildHumanoidClips(idle, style);
  const clips = [...base.clips];
  for (const a of def.attacks) clips.push(...buildEnemyAttackClips(a, idle, style));
  const set: AnimSet = { clips, additive: base.additive };
  enemySets.set(def.id, set);
  return set;
}

/** Drops cached clip sets (tests, hot reload). */
export function clearAnimSets(): void {
  heroSets.clear();
  enemySets.clear();
}
