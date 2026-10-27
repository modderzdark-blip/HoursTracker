import type { StatBlock } from '../data/combatTypes';
import type { HeroDef } from '../data/heroes';
import { GEAR_CONFIG } from '../data/items';
import { addItemStats, emptyTotals, type GearItem } from './gear';
import type { PetBonus } from './pets';
import type { HeroMods } from './skillTree';

/** Hero stats at a level, before gear. */
export function heroBaseStats(def: HeroDef, level: number): StatBlock {
  const l = Math.max(1, Math.floor(level)) - 1;
  const s = def.stats;
  return {
    ...s,
    maxHp: Math.round(s.maxHp * (1 + def.growth.maxHp * l)),
    atk: Math.round(s.atk * (1 + def.growth.atk * l)),
    def: Math.round(s.def * (1 + def.growth.def * l)),
  };
}

/**
 * Final battle stats: level stats + flat gear, then gear and pet percentages, then skill-tree
 * crit, then caps. HP/ATK/DEF round to integers.
 */
export function computeHeroStats(
  def: HeroDef,
  level: number,
  equipped: readonly GearItem[],
  mods: HeroMods | null,
  pet: PetBonus | null = null,
): StatBlock {
  const base = heroBaseStats(def, level);
  const g = emptyTotals();
  for (const item of equipped) addItemStats(item, g);
  if (pet !== null)
    for (const [stat, v] of Object.entries(pet) as [keyof PetBonus, number][]) g[stat] += v;
  const caps = GEAR_CONFIG.caps;
  return {
    maxHp: Math.round((base.maxHp + g.hp) * (1 + g.hpPct)),
    atk: Math.round((base.atk + g.atk) * (1 + g.atkPct)),
    def: Math.round((base.def + g.def) * (1 + g.defPct)),
    critChance: Math.min(caps.critChance, base.critChance + g.critChance + (mods?.critChance ?? 0)),
    critDamage: base.critDamage + g.critDamage,
    attackSpeed: Math.min(caps.attackSpeed, base.attackSpeed * (1 + g.attackSpeed)),
    moveSpeed: base.moveSpeed * Math.min(caps.moveSpeedMult, 1 + g.moveSpeed),
  };
}

/** One number summarising a stat block (shown as "Power"; used for recommended power). */
export function powerRating(s: StatBlock): number {
  const offense = s.atk * (1 + s.critChance * (s.critDamage - 1)) * s.attackSpeed;
  const defense = s.maxHp * (1 + s.def / 100);
  return Math.round(offense * 4 + defense * 0.12);
}
