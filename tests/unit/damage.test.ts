import { describe, expect, it } from 'vitest';
import { computeDamage, computeDotDamage, defenseFactor } from '../../src/combat/damage';
import { Health } from '../../src/combat/Health';
import { Poise } from '../../src/combat/Poise';
import { StatusEffects } from '../../src/combat/StatusEffects';
import { STATUS_EFFECTS } from '../../src/data/statusEffects';

const noCrit = (): number => 0.999;
const alwaysCrit = (): number => 0;

describe('damage formula: ATK × skill × crit × 100/(100+DEF) × difficulty', () => {
  it('defense factor', () => {
    expect(defenseFactor(0)).toBe(1);
    expect(defenseFactor(100)).toBe(0.5);
    expect(defenseFactor(300)).toBe(0.25);
    expect(defenseFactor(-50)).toBe(1); // negative DEF is clamped
  });

  it('exact values without crit', () => {
    // 100 × 0.9 × 1 × 100/130 × 1 = 69.23 → 69
    const r = computeDamage(
      { atk: 100, def: 30, skillMult: 0.9, critChance: 0.15, critDamage: 1.6, difficultyMod: 1 },
      noCrit,
    );
    expect(r).toEqual({ amount: 69, crit: false });
  });

  it('crit multiplies by critDamage', () => {
    // 100 × 1 × 1.6 × 100/140 = 114.28 → 114
    const r = computeDamage(
      { atk: 100, def: 40, skillMult: 1, critChance: 0.15, critDamage: 1.6, difficultyMod: 1 },
      alwaysCrit,
    );
    expect(r).toEqual({ amount: 114, crit: true });
  });

  it('crit chance 0 never crits and does not consume the rng', () => {
    let calls = 0;
    const rng = (): number => {
      calls++;
      return 0;
    };
    const r = computeDamage(
      { atk: 50, def: 0, skillMult: 1, critChance: 0, critDamage: 2, difficultyMod: 1 },
      rng,
    );
    expect(r.crit).toBe(false);
    expect(calls).toBe(0);
  });

  it('forceCrit, difficulty modifier and bonus multiply in', () => {
    // 90 × 2 × 1.5(forced crit) × 100/140 × 1.5 × 1.5(break bonus) = 433.9 → 434
    const r = computeDamage(
      {
        atk: 90,
        def: 40,
        skillMult: 2,
        critChance: 0,
        critDamage: 1.5,
        difficultyMod: 1.5,
        bonusMult: 1.5,
        forceCrit: true,
      },
      noCrit,
    );
    expect(r).toEqual({ amount: 434, crit: true });
  });

  it('never below 1, never negative from bad inputs', () => {
    expect(
      computeDamage(
        { atk: 1, def: 10000, skillMult: 0.01, critChance: 0, critDamage: 1, difficultyMod: 1 },
        noCrit,
      ).amount,
    ).toBe(1);
    expect(
      computeDamage(
        { atk: -100, def: 0, skillMult: -2, critChance: 0, critDamage: 1, difficultyMod: -1 },
        noCrit,
      ).amount,
    ).toBe(1);
  });

  it('crit rate is statistically close to critChance', () => {
    let s = 1;
    const rng = (): number => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    let crits = 0;
    for (let i = 0; i < 20000; i++) {
      if (
        computeDamage(
          { atk: 100, def: 0, skillMult: 1, critChance: 0.25, critDamage: 2, difficultyMod: 1 },
          rng,
        ).crit
      )
        crits++;
    }
    expect(crits / 20000).toBeGreaterThan(0.235);
    expect(crits / 20000).toBeLessThan(0.265);
  });

  it('DoT damage applies defense and difficulty, no crit', () => {
    expect(computeDotDamage(30, 50, 1)).toBe(20); // 30 × 100/150
    expect(computeDotDamage(30, 50, 2)).toBe(40);
    expect(computeDotDamage(0.1, 50, 1)).toBe(1);
  });
});

describe('Health', () => {
  it('clamps damage and heal, reports applied amounts, stays dead', () => {
    const h = new Health(100);
    expect(h.damage(30)).toBe(30);
    expect(h.heal(50)).toBe(30);
    expect(h.damage(250)).toBe(100);
    expect(h.dead).toBe(true);
    expect(h.damage(10)).toBe(0);
    expect(h.heal(10)).toBe(0);
    h.reset(0.6);
    expect(h.current).toBe(60);
    expect(h.dead).toBe(false);
  });

  it('ignores NaN / negative amounts', () => {
    const h = new Health(100);
    expect(h.damage(Number.NaN)).toBe(0);
    expect(h.damage(-5)).toBe(0);
    expect(h.current).toBe(100);
  });
});

describe('Poise', () => {
  it('breaks at zero and regenerates only after the delay', () => {
    const p = new Poise(100, 1000, 0.5);
    expect(p.apply(60)).toBe(false);
    p.tick(900);
    expect(p.current).toBe(40);
    p.tick(1000); // past the delay → regen 0.5×100/s for (1900-1000)/1000... applied per tick
    expect(p.current).toBeGreaterThan(40);
    expect(p.apply(1000)).toBe(true);
    expect(p.current).toBe(0);
    p.refill();
    expect(p.current).toBe(100);
  });
});

describe('StatusEffects (data-driven stacking)', () => {
  it('bleed stacks up to its max and refreshes duration', () => {
    const s = new StatusEffects();
    const max = STATUS_EFFECTS.bleed.maxStacks;
    for (let i = 0; i < max + 3; i++) s.apply('bleed', 100);
    expect(s.stacksOf('bleed')).toBe(max);
    s.tick(1000, () => undefined);
    s.apply('bleed', 100);
    expect(s.remainingMs('bleed')).toBe(STATUS_EFFECTS.bleed.durationMs);
  });

  it('ticks deal ATK × tickMult × stacks per tick, then expire', () => {
    const s = new StatusEffects();
    s.apply('bleed', 100);
    s.apply('bleed', 100);
    const ticks: number[] = [];
    s.tick(STATUS_EFFECTS.bleed.durationMs + 100, (_id, units) => ticks.push(units));
    expect(ticks.length).toBe(
      Math.floor(STATUS_EFFECTS.bleed.durationMs / STATUS_EFFECTS.bleed.tickMs),
    );
    expect(ticks[0]).toBeCloseTo(100 * STATUS_EFFECTS.bleed.tickAtkMult * 2);
    expect(s.has('bleed')).toBe(false);
  });

  it('burn does not stack (refresh rule)', () => {
    const s = new StatusEffects();
    s.apply('burn', 80);
    s.apply('burn', 80);
    expect(s.stacksOf('burn')).toBe(1);
  });

  it('slow multiplies movement speed while active', () => {
    const s = new StatusEffects();
    expect(s.speedMult()).toBe(1);
    s.apply('slow', 0);
    expect(s.speedMult()).toBe(STATUS_EFFECTS.slow.speedMult);
    s.tick(STATUS_EFFECTS.slow.durationMs + 1, () => undefined);
    expect(s.speedMult()).toBe(1);
  });

  it('a weaker re-application never weakens an existing DoT', () => {
    const s = new StatusEffects();
    s.apply('burn', 200);
    s.apply('burn', 10);
    const ticks: number[] = [];
    s.tick(STATUS_EFFECTS.burn.tickMs, (_id, units) => ticks.push(units));
    expect(ticks[0]).toBeCloseTo(200 * STATUS_EFFECTS.burn.tickAtkMult);
  });
});
