import { describe, expect, it } from 'vitest';
import { ActionRunner } from '../../src/combat/ActionRunner';
import { shapeBoundingRadius, targetInShape } from '../../src/combat/hitShapes';
import type { ActionDef } from '../../src/data/combatTypes';
import { HEROES } from '../../src/data/heroes';

const spec = {
  damage: 1,
  poise: 0,
  reaction: 'flinch' as const,
  knockback: 0,
  hitStopMs: 0,
  shake: 0,
  shape: { kind: 'arc' as const, range: 2, angleDeg: 120 },
};

const DEF: ActionDef = {
  id: 't',
  startupMs: 100,
  activeMs: 100,
  recoveryMs: 200,
  cancelAtMs: 250,
  hits: [
    { offsetMs: 0, spec },
    { offsetMs: 60, spec },
  ],
  move: { distance: 2, startMs: 0, endMs: 200, ease: 'out' },
  invulnerable: { fromMs: 50, toMs: 150 },
  trail: 'right',
  windPose: 'SLASH_R_WIND',
  hitPose: 'SLASH_R_HIT',
};

describe('ActionRunner', () => {
  it('walks startup → active → recovery → done', () => {
    const r = new ActionRunner();
    r.start(DEF);
    const phases: string[] = [];
    for (let t = 0; t < 420; t += 10) {
      phases.push(r.phase);
      r.advance(10, () => undefined);
    }
    expect(phases[0]).toBe('startup');
    expect(phases).toContain('active');
    expect(phases).toContain('recovery');
    expect(r.phase).toBe('done');
    expect(r.totalMs).toBe(400);
  });

  it('fires each timed hit exactly once at the right moment, even with big steps', () => {
    const r = new ActionRunner();
    r.start(DEF);
    const fired: [number, number][] = [];
    r.advance(99, (i) => fired.push([i, r.elapsedMs]));
    expect(fired).toEqual([]);
    r.advance(1, (i) => fired.push([i, r.elapsedMs]));
    expect(fired).toEqual([[0, 100]]);
    r.advance(500, (i) => fired.push([i, r.elapsedMs]));
    expect(fired.map((f) => f[0])).toEqual([0, 1]);
  });

  it('cancel window, i-frames and super armor follow the data', () => {
    const r = new ActionRunner();
    r.start(DEF);
    r.advance(40, () => undefined);
    expect(r.isInvulnerable()).toBe(false);
    r.advance(20, () => undefined);
    expect(r.isInvulnerable()).toBe(true);
    expect(r.canCancel()).toBe(false);
    r.advance(200, () => undefined);
    expect(r.isInvulnerable()).toBe(false);
    expect(r.canCancel()).toBe(true);
    expect(r.hasSuperArmor()).toBe(false);
  });

  it('movement fractions sum to exactly 1 over the move window', () => {
    const r = new ActionRunner();
    r.start(DEF);
    let sum = 0;
    for (let i = 0; i < 50; i++) sum += r.advance(16.7, () => undefined);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('attack speed scales every duration', () => {
    const r = new ActionRunner();
    r.start(DEF, 2);
    expect(r.totalMs).toBe(200);
    const fired: number[] = [];
    r.advance(50, (i) => fired.push(i));
    expect(fired).toEqual([0]);
  });

  it("every Kael combo step's cancel window opens before its recovery ends", () => {
    for (const step of HEROES.kael.combo) {
      expect(step.cancelAtMs).toBeGreaterThanOrEqual(step.startupMs + step.activeMs);
      expect(step.cancelAtMs).toBeLessThan(step.startupMs + step.activeMs + step.recoveryMs);
    }
  });
});

describe('hit shapes', () => {
  const arc = { kind: 'arc' as const, range: 3, angleDeg: 90 };
  it('arc: inside range and half-angle, with target width allowance', () => {
    expect(targetInShape(arc, 0, 0, 0, 0, 2, 0.3)).toBe(true); // straight ahead (+Z)
    expect(targetInShape(arc, 0, 0, 0, 0, -2, 0.3)).toBe(false); // behind
    expect(targetInShape(arc, 0, 0, 0, 0, 3.25, 0.3)).toBe(true); // range + radius
    expect(targetInShape(arc, 0, 0, 0, 0, 3.4, 0.3)).toBe(false);
    expect(targetInShape(arc, 0, 0, 0, 1.9, 2, 0)).toBe(true); // just inside 45°
    expect(targetInShape(arc, 0, 0, 0, 2, 1.6, 0)).toBe(false); // ~51°
    expect(targetInShape(arc, 0, 0, 0, 2, 1.6, 0.4)).toBe(true); // width allowance
    expect(targetInShape(arc, 0, 0, Math.PI / 2, 2, 0, 0.3)).toBe(true); // facing +X
  });

  it('circle: centred ahead of the attacker', () => {
    const c = { kind: 'circle' as const, radius: 1, forward: 2 };
    expect(targetInShape(c, 0, 0, 0, 0, 2, 0)).toBe(true);
    expect(targetInShape(c, 0, 0, 0, 0, 0, 0)).toBe(false);
    expect(targetInShape(c, 0, 0, 0, 0, 0.8, 0.3)).toBe(true);
  });

  it('box: length along facing, width to the sides', () => {
    const b = { kind: 'box' as const, length: 6, width: 2, forward: 0.5 };
    expect(targetInShape(b, 0, 0, 0, 0, 3, 0)).toBe(true);
    expect(targetInShape(b, 0, 0, 0, 1.5, 3, 0)).toBe(false);
    expect(targetInShape(b, 0, 0, 0, 1.2, 3, 0.3)).toBe(true);
    expect(targetInShape(b, 0, 0, 0, 0, 7, 0)).toBe(false);
    expect(targetInShape(b, 0, 0, 0, 0, -0.5, 0)).toBe(false);
  });

  it('bounding radius covers the shape', () => {
    expect(shapeBoundingRadius({ kind: 'box', length: 6, width: 2, forward: 0 })).toBeCloseTo(
      Math.hypot(3, 1),
    );
  });
});
