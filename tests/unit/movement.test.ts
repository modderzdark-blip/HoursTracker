import { describe, expect, it } from 'vitest';
import { CharacterMotor } from '../../src/actors/components/CharacterMotor';
import {
  approachVelocity,
  lerpAngle,
  moveTowardsAngle,
  wrapAngle,
} from '../../src/actors/components/movementMath';
import { CameraShake } from '../../src/camera/CameraShake';
import { smoothingFactor } from '../../src/camera/FollowCamera';
import { CAMERA_CONFIG } from '../../src/data/config';
import { HEROES } from '../../src/data/heroes';

describe('angle math', () => {
  it('wrapAngle maps into (-π, π]', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(0.5)).toBeCloseTo(0.5);
  });

  it('moveTowardsAngle takes the shortest arc and respects the limit', () => {
    // From 170° to -170° is +20° across the seam, not -340°.
    const a = moveTowardsAngle((170 * Math.PI) / 180, (-170 * Math.PI) / 180, (5 * Math.PI) / 180);
    expect((wrapAngle(a) * 180) / Math.PI).toBeCloseTo(175);
    expect(moveTowardsAngle(0, 0.1, 1)).toBeCloseTo(0.1);
  });

  it('lerpAngle interpolates across the seam', () => {
    expect(Math.abs(lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5))).toBeCloseTo(Math.PI);
  });

  it('approachVelocity never overshoots', () => {
    const v = { x: 0, z: 0 };
    approachVelocity(v, 10, 0, 3);
    expect(v.x).toBeCloseTo(3);
    approachVelocity(v, 10, 0, 100);
    expect(v.x).toBe(10);
  });
});

describe('CharacterMotor', () => {
  const kael = HEROES.kael;
  const dt = 1 / 60;
  const out = { x: 0, y: 0, z: 0 };

  it('reaches top speed at full stick and analog speed at half stick', () => {
    const m = new CharacterMotor(kael.movement, -28);
    for (let i = 0; i < 60; i++) m.step(1, 0, dt, true, out);
    expect(m.planarSpeed).toBeCloseTo(kael.movement.moveSpeed);
    const half = new CharacterMotor(kael.movement, -28);
    for (let i = 0; i < 60; i++) half.step(0, 0.5, dt, true, out);
    expect(half.planarSpeed).toBeCloseTo(kael.movement.moveSpeed * 0.5);
  });

  it('accelerates over time rather than instantly (no robotic snapping)', () => {
    const m = new CharacterMotor(kael.movement, -28);
    m.step(1, 0, dt, true, out);
    expect(m.planarSpeed).toBeCloseTo(kael.movement.acceleration * dt);
    expect(m.planarSpeed).toBeLessThan(kael.movement.moveSpeed);
  });

  it('stops when input is released', () => {
    const m = new CharacterMotor(kael.movement, -28);
    for (let i = 0; i < 60; i++) m.step(1, 0, dt, true, out);
    for (let i = 0; i < 30; i++) m.step(0, 0, dt, true, out);
    expect(m.planarSpeed).toBe(0);
  });

  it('over-long input is clamped to top speed', () => {
    const m = new CharacterMotor(kael.movement, -28);
    for (let i = 0; i < 60; i++) m.step(3, 4, dt, true, out);
    expect(m.planarSpeed).toBeCloseTo(kael.movement.moveSpeed);
  });

  it('turns toward the input at the configured turn rate', () => {
    const m = new CharacterMotor(kael.movement, -28);
    m.reset(0); // facing +Z
    m.step(1, 0, dt, true, out); // want +X (yaw π/2)
    expect(m.yaw).toBeCloseTo(((kael.movement.turnRateDeg * Math.PI) / 180) * dt);
    for (let i = 0; i < 30; i++) m.step(1, 0, dt, true, out);
    expect(m.yaw).toBeCloseTo(Math.PI / 2);
  });

  it('keeps facing when the stick is near the centre', () => {
    const m = new CharacterMotor(kael.movement, -28);
    m.reset(1);
    m.step(0.01, 0.01, dt, true, out);
    expect(m.yaw).toBe(1);
  });

  it('applies gravity in the air and sticks to the ground when grounded', () => {
    const m = new CharacterMotor(kael.movement, -28);
    m.step(0, 0, dt, false, out);
    m.step(0, 0, dt, false, out);
    expect(m.verticalVelocity).toBeCloseTo(-28 * 2 * dt);
    m.step(0, 0, dt, true, out);
    expect(m.verticalVelocity).toBeLessThan(0);
    expect(out.y).toBeLessThan(0);
  });
});

describe('camera', () => {
  it('smoothing factor is frame-rate independent', () => {
    // Two 30 Hz steps must equal four 60 Hz steps... i.e. remaining distance matches.
    const remain30 = (1 - smoothingFactor(9, 1 / 30)) ** 2;
    const remain60 = (1 - smoothingFactor(9, 1 / 60)) ** 4;
    expect(remain30).toBeCloseTo(remain60, 10);
  });

  it('shake decays to zero and is silent at zero trauma', () => {
    const s = new CameraShake(CAMERA_CONFIG.shake);
    const out = { x: 0, y: 0, rollRad: 0 };
    s.update(1 / 60, out);
    expect(out).toEqual({ x: 0, y: 0, rollRad: 0 });
    s.addTrauma(5);
    expect(s.currentTrauma).toBe(1);
    let maxOffset = 0;
    for (let i = 0; i < 120; i++) {
      s.update(1 / 60, out);
      maxOffset = Math.max(maxOffset, Math.abs(out.x), Math.abs(out.y));
    }
    expect(maxOffset).toBeGreaterThan(0);
    expect(maxOffset).toBeLessThanOrEqual(CAMERA_CONFIG.shake.maxOffset);
    expect(s.currentTrauma).toBe(0);
  });
});
