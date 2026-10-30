import { describe, expect, it } from 'vitest';
import { heroAnimSet } from '../../src/anim/animSets';
import { POSE_LIBRARY } from '../../src/anim/poses';
import { mulberry32 } from '../../src/core/random';
import type { ActionDef } from '../../src/data/combatTypes';
import {
  ABILITY_UNLOCK_LEVELS,
  EXTRA_SKILLS,
  HERO_ICON_MATERIAL,
  SKILL_ICONS,
} from '../../src/data/heroKits/abilities';
import { HEROES, type HeroId } from '../../src/data/heroes';
import {
  abilityLevel,
  assignSlot,
  defaultLoadout,
  heroWithLoadout,
  resolveLoadout,
  skillPool,
} from '../../src/progression/loadout';
import { PlayerProfile } from '../../src/progression/PlayerProfile';
import { sanitizeProfile } from '../../src/progression/profile';
import { createDefaultSave } from '../../src/save/SaveStore';
import { ICON_PATHS } from '../../src/ui/iconPaths';

const IDS = Object.keys(HEROES) as HeroId[];
const totalMs = (a: ActionDef): number => a.startupMs + a.activeMs + a.recoveryMs;

function singleTargetMult(a: ActionDef): number {
  let sum = 0;
  for (const h of a.hits) {
    const e = h.emit;
    const k =
      e?.kind === 'zone'
        ? e.zone.ticks * (e.place !== 'target' && e.scatter > e.zone.radius ? 1 : e.count)
        : 1;
    sum += h.spec.damage * k;
  }
  return sum;
}

describe('extra abilities: data', () => {
  it.each(IDS)('%s: three extras with valid poses, timings, cues and balance', (id) => {
    const extras = EXTRA_SKILLS[id];
    expect(extras).toHaveLength(3);
    for (const a of extras) {
      expect(POSE_LIBRARY[a.windPose], a.id).toBeDefined();
      expect(POSE_LIBRARY[a.hitPose], a.id).toBeDefined();
      expect(a.id.startsWith(`${id}_`), a.id).toBe(true);
      expect(a.cancelAtMs, a.id).toBeLessThanOrEqual(totalMs(a));
      expect(a.cooldownMs, a.id).toBeGreaterThanOrEqual(4000);
      expect(a.hits.length, a.id).toBeGreaterThan(0);
      for (const hit of a.hits) {
        expect(hit.offsetMs, a.id).toBeLessThan(a.activeMs);
        expect(hit.spec.damage, a.id).toBeGreaterThan(0);
      }
      if (a.move !== undefined) expect(a.move.endMs, a.id).toBeLessThanOrEqual(totalMs(a));
      if (a.invulnerable !== undefined)
        expect(a.invulnerable.toMs, a.id).toBeLessThanOrEqual(totalMs(a) + 200);
      const cues = a.fx ?? [];
      expect(cues.length, a.id).toBeGreaterThanOrEqual(4);
      expect(new Set(cues.map((c) => c.shape)).size, a.id).toBeGreaterThanOrEqual(3);
      // Same budget as the kits: damage per second of cooldown.
      const perSec = singleTargetMult(a) / (a.cooldownMs / 1000);
      expect(perSec, a.id).toBeGreaterThan(0.08);
      expect(perSec, a.id).toBeLessThan(0.6);
    }
  });

  it('ability ids are unique across the roster, and every ability has a real icon', () => {
    const all = IDS.flatMap((id) => skillPool(id).map((s) => s.id));
    expect(new Set(all).size).toBe(all.length);
    for (const id of all) {
      const name = SKILL_ICONS[id];
      expect(name, id).toBeDefined();
      if (name !== undefined) expect(ICON_PATHS[name as keyof typeof ICON_PATHS], id).toBeDefined();
    }
    for (const id of IDS) expect(HERO_ICON_MATERIAL[id]).toBeDefined();
  });

  it.each(IDS)('%s: the cached clip set has a clip for every ability', (id) => {
    const names = new Set(heroAnimSet(HEROES[id]).clips.map((c) => c.name));
    for (const s of skillPool(id)) expect(names.has(s.clip ?? s.id), s.id).toBe(true);
  });
});

describe('ability loadout', () => {
  it('defaults to the kit, and extras unlock with hero level', () => {
    expect(resolveLoadout('kael', [], 1)).toEqual(defaultLoadout('kael'));
    const [a, b, c] = EXTRA_SKILLS.kael;
    expect(abilityLevel('kael', a.id)).toBe(ABILITY_UNLOCK_LEVELS[0]);
    expect(abilityLevel('kael', c.id)).toBe(ABILITY_UNLOCK_LEVELS[2]);
    expect(abilityLevel('kael', HEROES.kael.skills[0].id)).toBe(1);
    // Locked or unknown picks fall back; no ability twice.
    const lo = resolveLoadout('kael', [c.id, 'nope', b.id], 1);
    expect(new Set(lo).size).toBe(3);
    expect(lo).toEqual(defaultLoadout('kael'));
    const hi = resolveLoadout('kael', [c.id, c.id, b.id], 20);
    expect(hi[0]).toBe(c.id);
    expect(hi[2]).toBe(b.id);
    expect(new Set(hi).size).toBe(3);
  });

  it('assigning an ability already on another button swaps the two', () => {
    const lo = defaultLoadout('brann');
    const swapped = assignSlot(lo, 0, lo[2]);
    expect(swapped).toEqual([lo[2], lo[1], lo[0]]);
    const extra = EXTRA_SKILLS.brann[0].id;
    expect(assignSlot(lo, 1, extra)).toEqual([lo[0], extra, lo[2]]);
  });

  it('the battle hero carries the chosen abilities on buttons I / II / III', () => {
    const extra = EXTRA_SKILLS.lyra[1];
    const hero = heroWithLoadout(HEROES.lyra, [
      extra.id,
      defaultLoadout('lyra')[1],
      defaultLoadout('lyra')[0],
    ]);
    expect(hero.skills[0]).toBe(extra);
    expect(hero.skills[2]).toBe(HEROES.lyra.skills[0]);
    expect(hero.ultimate).toBe(HEROES.lyra.ultimate);
  });

  it('a profile equips only unlocked abilities and keeps the loadout through a save', () => {
    const p = new PlayerProfile(createDefaultSave(), () => undefined, mulberry32(3));
    const extra = EXTRA_SKILLS.kael[0];
    expect(p.setLoadoutSlot('kael', 0, extra.id)).toBe(false);
    p.hero('kael').level = ABILITY_UNLOCK_LEVELS[0];
    expect(p.setLoadoutSlot('kael', 2, extra.id)).toBe(true);
    expect(p.loadout('kael')[2]).toBe(extra.id);
    expect(p.battleHero('kael').skills[2]).toBe(extra);
    expect(p.setLoadoutSlot('kael', 3, extra.id)).toBe(false);
    const back = sanitizeProfile(JSON.parse(JSON.stringify(p.data)));
    expect(back.heroes.kael.loadout[2]).toBe(extra.id);
    const junk = sanitizeProfile({ heroes: { kael: { loadout: [5, 'x'.repeat(200), null] } } });
    expect(junk.heroes.kael.loadout.every((s) => typeof s === 'string')).toBe(true);
  });
});
