import { ABILITY_UNLOCK_LEVELS, EXTRA_SKILLS } from '../data/heroKits/abilities';
import { HEROES, type HeroDef, type HeroId, type SkillDef } from '../data/heroes';

/**
 * Ability loadouts: each hero has six abilities (the kit's three plus three extras that unlock
 * with hero level) and takes any three into the skill buttons I / II / III.
 */

export type Loadout = readonly [string, string, string];

/** Every ability of a hero, in order: the kit's three, then the extras. */
export function skillPool(heroId: HeroId): readonly SkillDef[] {
  return [...HEROES[heroId].skills, ...EXTRA_SKILLS[heroId]];
}

/** Hero level an ability needs (the kit's own are available from the start). */
export function abilityLevel(heroId: HeroId, skillId: string): number {
  const i = EXTRA_SKILLS[heroId].findIndex((s) => s.id === skillId);
  return i < 0 ? 1 : (ABILITY_UNLOCK_LEVELS[i] ?? 1);
}

export function defaultLoadout(heroId: HeroId): Loadout {
  const [a, b, c] = HEROES[heroId].skills;
  return [a.id, b.id, c.id];
}

/**
 * The loadout a hero really uses: saved choices that are known, unlocked at `level` and not
 * repeated; any other slot falls back to the first default ability not already taken.
 */
export function resolveLoadout(heroId: HeroId, saved: readonly string[], level: number): Loadout {
  const pool = skillPool(heroId);
  const ok = (id: string | undefined): id is string =>
    id !== undefined && pool.some((s) => s.id === id) && abilityLevel(heroId, id) <= level;
  const out: string[] = [];
  for (let i = 0; i < 3; i++) {
    const id = saved[i];
    out.push(ok(id) && !out.includes(id) ? id : '');
  }
  const spare = [...new Set([...defaultLoadout(heroId), ...pool.map((s) => s.id)])].filter(
    (id) => ok(id) && !out.includes(id),
  );
  const def = defaultLoadout(heroId);
  for (let i = 0; i < 3; i++) if (out[i] === '') out[i] = spare.shift() ?? def[i] ?? '';
  return [out[0] ?? '', out[1] ?? '', out[2] ?? ''];
}

/** Puts `skillId` in `slot`; if it already sits in another slot the two swap. */
export function assignSlot(current: Loadout, slot: number, skillId: string): Loadout {
  const next = [...current];
  const was = next.indexOf(skillId);
  if (was >= 0) next[was] = next[slot] ?? skillId;
  next[slot] = skillId;
  return [next[0] ?? '', next[1] ?? '', next[2] ?? ''];
}

/** The hero as it enters battle: the chosen abilities on the skill buttons. */
export function heroWithLoadout(hero: HeroDef, loadout: Loadout): HeroDef {
  const pool = skillPool(hero.id);
  const pick = (i: number): SkillDef =>
    pool.find((s) => s.id === loadout[i]) ?? hero.skills[i as 0 | 1 | 2];
  return { ...hero, skills: [pick(0), pick(1), pick(2)] };
}
