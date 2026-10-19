import { describe, expect, it } from 'vitest';
import { ARENAS } from '../../src/data/arenas';
import { BOSSES } from '../../src/data/bosses';
import { ENEMIES } from '../../src/data/enemies';
import { GEAR_CONFIG, GEAR_SLOTS, RARITIES, RARITY_DEFS, SLOT_DEFS } from '../../src/data/items';
import { MODES } from '../../src/data/modes';
import { SKILL_TREES } from '../../src/data/skillTrees';
import { CHAPTERS, findAdventureStage } from '../../src/data/stages';
import { CAMERA_CONFIG, INPUT_CONFIG, LOOP_CONFIG } from '../../src/data/config';
import { HEROES } from '../../src/data/heroes';

describe('data sanity', () => {
  it('heroes have positive movement stats and 3 skills with cooldowns', () => {
    for (const h of Object.values(HEROES)) {
      expect(h.stats.moveSpeed).toBeGreaterThan(0);
      expect(h.movement.acceleration).toBeGreaterThan(0);
      expect(h.movement.deceleration).toBeGreaterThan(0);
      expect(h.skills).toHaveLength(3);
      for (const s of h.skills) expect(s.cooldownMs).toBeGreaterThan(0);
    }
  });

  it('arena props sit inside the wall ring and spawns are clear of pillars', () => {
    for (const a of Object.values(ARENAS)) {
      const r = a.floorRadius;
      for (const p of a.pillars) expect(Math.hypot(p.x, p.z) + p.radius).toBeLessThan(r);
      for (const b of a.blocks) expect(Math.hypot(b.position[0], b.position[2])).toBeLessThan(r);
      for (const k of a.rocks) expect(Math.hypot(k.x, k.z)).toBeLessThan(r);
      const points: (readonly [number, number])[] = [
        [a.spawn[0], a.spawn[2]],
        a.bossSpawn,
        a.dummySpawn,
        ...a.spawnPoints,
      ];
      for (const [sx, sz] of points) {
        expect(Math.hypot(sx, sz)).toBeLessThan(r - 1);
        for (const p of a.pillars)
          expect(Math.hypot(p.x - sx, p.z - sz), `${a.id} point ${sx},${sz}`).toBeGreaterThan(
            p.radius + 1,
          );
      }
    }
  });

  it('chapters have 8 stages with rising levels, valid content and a final boss', () => {
    for (const c of CHAPTERS) {
      expect(c.stages).toHaveLength(8);
      let level = 0;
      for (const s of c.stages) {
        expect(s.level).toBeGreaterThan(level);
        level = s.level;
        expect(ARENAS[s.arena]).toBeDefined();
        expect(s.waves.length).toBeGreaterThan(0);
        for (const w of s.waves) for (const sp of w.spawns) expect(ENEMIES[sp.enemy]).toBeDefined();
        if (s.boss !== null) expect(BOSSES[s.boss]).toBeDefined();
        expect(findAdventureStage(s.id)).toBe(s);
      }
      expect(c.stages[7]?.kind).toBe('boss');
    }
  });

  it('bosses: phases descend, attacks exist, break/enrage positive', () => {
    for (const b of Object.values(BOSSES)) {
      let prev = 2;
      for (const ph of b.phases) {
        expect(ph.fromHpFrac).toBeLessThan(prev);
        prev = ph.fromHpFrac;
        for (const a of ph.attacks) expect(b.attacks.some((x) => x.id === a)).toBe(true);
      }
      expect(b.breakMax).toBeGreaterThan(0);
      expect(b.enrageAfterMs).toBeGreaterThan(0);
    }
  });

  it('gear and skill-tree data are complete', () => {
    for (const s of GEAR_SLOTS) expect(SLOT_DEFS[s].names.length).toBeGreaterThan(0);
    let prevMult = 0;
    for (const r of RARITIES) {
      expect(RARITY_DEFS[r].mainMult).toBeGreaterThan(prevMult);
      prevMult = RARITY_DEFS[r].mainMult;
    }
    expect(GEAR_CONFIG.successRates).toHaveLength(GEAR_CONFIG.maxPlus);
    for (const nodes of Object.values(SKILL_TREES)) {
      const ids = new Set(nodes.map((n) => n.id));
      expect(ids.size).toBe(nodes.length);
      for (const n of nodes) if (n.requires !== null) expect(ids.has(n.requires)).toBe(true);
    }
  });

  it('mode unlock stages exist (or belong to a later chapter of the plan)', () => {
    for (const m of Object.values(MODES)) {
      if (m.requiresStage === null) continue;
      expect(m.requiresStage).toMatch(/^c[1-3]s[1-8]$/);
    }
  });

  it('config values are in sane ranges', () => {
    expect(INPUT_CONFIG.bufferMs).toBe(150);
    expect(INPUT_CONFIG.joystick.deadZone).toBeGreaterThan(0);
    expect(INPUT_CONFIG.joystick.deadZone).toBeLessThan(0.5);
    expect(LOOP_CONFIG.logicHz).toBeGreaterThanOrEqual(30);
    expect(CAMERA_CONFIG.distance).toBeGreaterThan(0);
    expect(CAMERA_CONFIG.height).toBeGreaterThan(0);
  });
});
