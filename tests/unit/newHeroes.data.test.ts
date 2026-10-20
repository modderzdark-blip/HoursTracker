import { describe, expect, it } from 'vitest';
import { buildCustomActionClip } from '../../src/anim/clipSets';
import { buildRigTemplate } from '../../src/anim/rigBuilder';
import { POSE_LIBRARY } from '../../src/anim/poses';
import { mulberry32 } from '../../src/core/random';
import type { ActionDef } from '../../src/data/combatTypes';
import { HEROES, type HeroDef, type HeroId } from '../../src/data/heroes';
import { RIGS } from '../../src/data/rigs';
import { SKILL_TREES } from '../../src/data/skillTrees';
import { findAdventureStage } from '../../src/data/stages';
import { buildOpponent } from '../../src/modes/meta';
import { computeHeroStats, powerRating } from '../../src/progression/heroStats';
import { PlayerProfile } from '../../src/progression/PlayerProfile';
import { sanitizeProfile } from '../../src/progression/profile';
import { createDefaultSave } from '../../src/save/SaveStore';

const ORIGINAL: readonly HeroId[] = ['kael', 'brann', 'lyra'];
const NEW_HEROES: readonly HeroId[] = ['garrick', 'seraphine', 'ryn', 'valka', 'morrow'];
const FX_SHAPES = new Set([
  'ring',
  'slash',
  'pillar',
  'flash',
  'cracks',
  'nova',
  'smoke',
  'screen',
]);

const actions = (h: HeroDef): ActionDef[] => [
  ...h.combo,
  ...(h.rangedCombo ?? []),
  ...h.skills,
  h.ultimate,
];
const totalMs = (a: ActionDef): number => a.startupMs + a.activeMs + a.recoveryMs;

/** Damage multiplier a move can deal to one target (zones count each tick, fans one shot). */
function singleTargetMult(a: ActionDef): number {
  let sum = 0;
  for (const h of a.hits) {
    const e = h.emit;
    // Zones aimed at the target all land on it; a field scattered wider than one zone lands
    // about one of its zones on a given enemy.
    const k =
      e?.kind === 'zone'
        ? e.zone.ticks * (e.place !== 'target' && e.scatter > e.zone.radius ? 1 : e.count)
        : 1;
    sum += h.spec.damage * k;
  }
  return sum;
}

/** Sustained single-target damage per second of the melee (or main) combo at level 1. */
function comboDps(h: HeroDef): number {
  const combo = h.rangedCombo ?? h.combo;
  const mult = combo.reduce((s, a) => s + singleTargetMult(a), 0);
  const ms = combo.reduce((s, a) => s + totalMs(a), 0);
  return (h.stats.atk * mult) / (ms / 1000);
}

describe('new heroes: data', () => {
  it.each(NEW_HEROES)('%s: rig, poses, clips and timings are valid', (id) => {
    const h = HEROES[id];
    expect(h.id).toBe(id);
    expect(h.visual.kind).toBe('rig');
    if (h.visual.kind === 'rig') expect(RIGS[h.visual.rig]).toBeDefined();
    expect(POSE_LIBRARY[h.idlePose]).toBeDefined();
    for (const a of actions(h)) {
      expect(POSE_LIBRARY[a.windPose], a.id).toBeDefined();
      expect(POSE_LIBRARY[a.hitPose], a.id).toBeDefined();
      expect(a.cancelAtMs, a.id).toBeLessThanOrEqual(totalMs(a));
      expect(a.hits.length, a.id).toBeGreaterThan(0);
      for (const hit of a.hits) {
        expect(hit.offsetMs, a.id).toBeLessThan(a.activeMs);
        expect(hit.spec.damage, a.id).toBeGreaterThan(0);
      }
      if (a.move !== undefined) expect(a.move.endMs, a.id).toBeLessThanOrEqual(totalMs(a));
      if (a.invulnerable !== undefined)
        expect(a.invulnerable.toMs, a.id).toBeLessThanOrEqual(totalMs(a) + 200);
      // A named clip must be a real custom clip, not the wind/hit fallback.
      if (a.clip !== undefined)
        expect(buildCustomActionClip(a.clip, a, POSE_LIBRARY[h.idlePose]).name).toBe(a.clip);
    }
    for (const s of h.skills) expect(s.cooldownMs).toBeGreaterThanOrEqual(4000);
  });

  it('action ids are unique across the whole roster', () => {
    const ids = Object.values(HEROES).flatMap((h) => actions(h).map((a) => a.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(NEW_HEROES)('%s: every skill and the ultimate carry rich visual cues', (id) => {
    const h = HEROES[id];
    for (const a of [...h.skills, h.ultimate]) {
      const cues = a.fx ?? [];
      expect(cues.length, a.id).toBeGreaterThanOrEqual(4);
      expect(new Set(cues.map((c) => c.shape)).size, a.id).toBeGreaterThanOrEqual(3);
      for (const c of cues) {
        expect(FX_SHAPES.has(c.shape), a.id).toBe(true);
        if (typeof c.at === 'number') {
          expect(c.at).toBeGreaterThanOrEqual(0);
          // Delayed cues (falling stars, curses) may outlast the cast, but not by long.
          expect(c.at, a.id).toBeLessThanOrEqual((totalMs(a) + 3000) / 1000);
        }
      }
    }
    // Ultimates end in a screen flash.
    expect(h.ultimate.fx?.some((c) => c.shape === 'screen')).toBe(true);
  });

  it.each(NEW_HEROES)('%s: unlocks after a later stage of chapters 2-4 for souls', (id) => {
    const u = HEROES[id].unlock;
    expect(u).not.toBeNull();
    if (u === null) return;
    expect(u.afterStage).toMatch(/^c[2-4]s[4-8]$/);
    expect(findAdventureStage(u.afterStage)).toBeDefined();
    expect(u.souls).toBeGreaterThan(HEROES.lyra.unlock?.souls ?? 0);
  });

  it('new heroes unlock one after another, each costing more', () => {
    let souls = 0;
    for (const id of NEW_HEROES) {
      const u = HEROES[id].unlock;
      if (u === null) throw new Error(`${id} has no unlock`);
      expect(u.souls).toBeGreaterThan(souls);
      souls = u.souls;
    }
  });

  it.each(NEW_HEROES)('%s: skill tree is complete and names the hero’s moves', (id) => {
    const nodes = SKILL_TREES[id];
    expect(nodes.length).toBe(SKILL_TREES.kael.length);
    const ids = new Set(nodes.map((n) => n.id));
    expect(ids.size).toBe(nodes.length);
    for (const n of nodes) if (n.requires !== null) expect(ids.has(n.requires)).toBe(true);
    const text = nodes.map((n) => `${n.name} ${n.description}`).join(' ');
    for (const s of HEROES[id].skills) expect(text).toContain(s.name);
    expect(text).toContain(HEROES[id].ultimate.name);
  });

  it.each(NEW_HEROES)('%s: rig builds within the hero triangle budget with weapon trails', (id) => {
    const t = buildRigTemplate(RIGS[id]);
    const tris = (t.geometry.getIndex()?.count ?? 0) / 3;
    expect(tris).toBeLessThan(12000);
    expect(t.sockets.rightTip.offset.distanceTo(t.sockets.rightBase.offset)).toBeGreaterThan(0.2);
    t.geometry.dispose();
    t.glowGeometry.dispose();
  });
});

describe('new heroes: balance against the original three', () => {
  const powers = ORIGINAL.map((id) => powerRating(HEROES[id].stats));
  const dps = ORIGINAL.map((id) => comboDps(HEROES[id]));

  it.each(NEW_HEROES)('%s: power at level 1 and 30 stays inside the roster band', (id) => {
    const p1 = powerRating(HEROES[id].stats);
    expect(p1).toBeGreaterThan(Math.min(...powers) * 0.9);
    expect(p1).toBeLessThan(Math.max(...powers) * 1.1);
    const p30 = powerRating(computeHeroStats(HEROES[id], 30, [], null));
    const o30 = ORIGINAL.map((o) => powerRating(computeHeroStats(HEROES[o], 30, [], null)));
    expect(p30).toBeGreaterThan(Math.min(...o30) * 0.88);
    expect(p30).toBeLessThan(Math.max(...o30) * 1.12);
  });

  it.each(NEW_HEROES)('%s: combo damage per second is in line with the originals', (id) => {
    const d = comboDps(HEROES[id]);
    expect(d).toBeGreaterThan(Math.min(...dps) * 0.85);
    expect(d).toBeLessThan(Math.max(...dps) * 1.05);
  });

  it.each(NEW_HEROES)('%s: skills and the ultimate hit as hard as the originals’', (id) => {
    const h = HEROES[id];
    const ults = ORIGINAL.map((o) => singleTargetMult(HEROES[o].ultimate));
    const u = singleTargetMult(h.ultimate);
    expect(u).toBeGreaterThan(Math.min(...ults) * 0.9);
    expect(u).toBeLessThan(Math.max(...ults) * 1.1);
    for (const s of h.skills) {
      // Damage per second of cooldown, so a strong skill must wait longer.
      const perSec = singleTargetMult(s) / (s.cooldownMs / 1000);
      expect(perSec, s.id).toBeGreaterThan(0.08);
      expect(perSec, s.id).toBeLessThan(0.6);
    }
  });

  it('the tank is the toughest, the casters the frailest', () => {
    const ehp = (id: HeroId): number => HEROES[id].stats.maxHp * (1 + HEROES[id].stats.def / 100);
    for (const id of [...ORIGINAL, ...NEW_HEROES])
      if (id !== 'garrick') expect(ehp('garrick')).toBeGreaterThan(ehp(id));
    expect(ehp('seraphine')).toBeLessThan(ehp('kael'));
  });
});

describe('new heroes: progression and arena', () => {
  it('start locked; summoning needs the stage first, then the souls', () => {
    const p = new PlayerProfile(createDefaultSave(), () => undefined, mulberry32(3));
    for (const id of NEW_HEROES) {
      expect(p.hero(id).unlocked).toBe(false);
      expect(p.heroUnlockBlock(id)).toBe('stage');
      expect(p.selectHero(id)).toBe(false);
    }
    const u = HEROES.garrick.unlock;
    if (u === null) throw new Error('garrick unlock');
    p.submitStageResult(u.afterStage, 'normal', 3, 100);
    expect(p.heroUnlockBlock('garrick')).toBe('souls');
    expect(p.heroUnlockBlock('seraphine')).toBe('stage');
    p.wallet.add('souls', u.souls);
    expect(p.heroUnlockBlock('garrick')).toBeNull();
    expect(p.unlockHero('garrick')).toBe(true);
    expect(p.wallet.get('souls')).toBe(0);
    expect(p.selectHero('garrick')).toBe(true);
    expect(p.stats('garrick').maxHp).toBe(HEROES.garrick.stats.maxHp);
  });

  it('a save from before the new heroes keeps its heroes and gains the new ones, locked', () => {
    const p = sanitizeProfile({
      selectedHero: 'brann',
      heroes: {
        kael: { unlocked: true, level: 12 },
        brann: { unlocked: true, level: 9 },
        lyra: { unlocked: false, level: 1 },
      },
    });
    expect(p.selectedHero).toBe('brann');
    expect(p.heroes.kael.level).toBe(12);
    expect(p.heroes.brann.unlocked).toBe(true);
    for (const id of NEW_HEROES) {
      expect(p.heroes[id].unlocked).toBe(false);
      expect(p.heroes[id].level).toBe(1);
    }
  });

  it.each(NEW_HEROES)('%s: arena opponents are built near the target power', (id) => {
    const o = buildOpponent(mulberry32(11), 'Shade', id, 1100, 2500);
    expect(o.heroId).toBe(id);
    expect(Math.abs(o.power - 2500) / 2500).toBeLessThan(0.25);
  });
});
