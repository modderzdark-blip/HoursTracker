import { beforeAll, describe, expect, it } from 'vitest';
import { CharacterMotor } from '../../src/actors/components/CharacterMotor';
import { PHYSICS_CONFIG } from '../../src/data/config';
import { HEROES } from '../../src/data/heroes';
import { CharacterBody } from '../../src/physics/CharacterBody';
import { PhysicsWorld, loadRapier, type Rapier } from '../../src/physics/PhysicsWorld';

/** Real Rapier (WASM) in Node: verifies the kinematic controller against level geometry. */
let rapier: Rapier;
beforeAll(async () => {
  rapier = await loadRapier();
});

const R = HEROES.kael.body.capsuleRadius;
const H = HEROES.kael.body.capsuleHalfHeight;
const DT = 1 / 60;

function setup(): { world: PhysicsWorld; body: CharacterBody; motor: CharacterMotor } {
  const world = new PhysicsWorld(rapier);
  world.addStaticCuboid(0, -0.5, 0, 50, 0.5, 50); // floor top at y=0
  const body = new CharacterBody(world, R, H, 0, 3, 0);
  const motor = new CharacterMotor(
    HEROES.kael.movement,
    PHYSICS_CONFIG.gravity,
    HEROES.kael.stats.moveSpeed,
  );
  return { world, body, motor };
}

function run(
  s: { world: PhysicsWorld; body: CharacterBody; motor: CharacterMotor },
  seconds: number,
  ix: number,
  iz: number,
): number {
  const d = { x: 0, y: 0, z: 0 };
  let maxFeetY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    s.motor.step(ix, iz, DT, s.body.grounded, d);
    s.body.move(d.x, d.y, d.z);
    s.world.step(DT);
    maxFeetY = Math.max(maxFeetY, s.body.position.y - s.body.footOffset);
  }
  return maxFeetY;
}

describe('CharacterBody (Rapier kinematic controller)', () => {
  it('falls under gravity and lands on the floor', () => {
    const s = setup();
    run(s, 1.5, 0, 0);
    expect(s.body.grounded).toBe(true);
    const feet = s.body.position.y - s.body.footOffset;
    expect(Math.abs(feet)).toBeLessThan(0.08);
    s.world.dispose();
  });

  it('moves at the hero run speed across open floor', () => {
    const s = setup();
    run(s, 1, 0, 0);
    const z0 = s.body.position.z;
    run(s, 2, 0, 1);
    const dist = s.body.position.z - z0;
    // ~2 s at 6.2 m/s minus the short acceleration ramp.
    expect(dist).toBeGreaterThan(11);
    expect(dist).toBeLessThan(12.6);
    s.world.dispose();
  });

  it('is blocked by a wall and slides along it', () => {
    const s = setup();
    s.world.addStaticCuboid(0, 1.5, 3, 10, 1.5, 0.25); // wall face at z=2.75
    run(s, 1, 0, 0);
    run(s, 2, 0.7, 0.7); // push diagonally into the wall
    expect(s.body.position.z).toBeLessThan(2.75 - R + 0.05);
    expect(s.body.position.x).toBeGreaterThan(3); // slid sideways
    s.world.dispose();
  });

  it('auto-steps a low ledge but not a tall block', () => {
    const s = setup();
    s.world.addStaticCuboid(0, 0.12, 4, 2, 0.12, 1); // 24 cm step at z 3..5
    run(s, 1, 0, 0);
    const peak = run(s, 1.2, 0, 1);
    // Walked up onto the 24 cm step (and off the far side).
    expect(s.body.position.z).toBeGreaterThan(5);
    expect(peak).toBeGreaterThan(0.2);
    s.world.dispose();

    const t = setup();
    t.world.addStaticCuboid(0, 0.5, 4, 2, 0.5, 1); // 1 m block
    run(t, 1, 0, 0);
    run(t, 1.5, 0, 1);
    expect(t.body.position.z).toBeLessThan(3);
    t.world.dispose();
  });

  it('teleport resets position', () => {
    const s = setup();
    s.body.teleport(5, 2, -5);
    expect(s.body.position).toEqual({ x: 5, y: 2, z: -5 });
    s.world.dispose();
  });
});
