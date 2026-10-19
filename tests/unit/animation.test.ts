import { describe, expect, it } from 'vitest';
import { BodyDynamics } from '../../src/anim/BodyDynamics';
import { strikeKeys } from '../../src/anim/clipSets';
import { NEUTRAL, OVERHEAD_HIT, OVERHEAD_WIND, blendPose } from '../../src/anim/poses';

function run(d: BodyDynamics, sec: number, speed = 0, fwd = 0, turn = 0): void {
  for (let t = 0; t < sec; t += 1 / 60) d.update(1 / 60, speed, fwd, turn);
}

describe('body dynamics', () => {
  it('a hit from the front bends the torso back, from behind forward, then settles', () => {
    const front = new BodyDynamics();
    // Facing +Z (yaw 0); the hit pushes toward −Z (attacker in front).
    front.impulse(0, -1, 0, 1.5);
    run(front, 0.05);
    expect(front.pitchRad).toBeLessThan(-0.05);
    run(front, 2);
    expect(Math.abs(front.pitchRad)).toBeLessThan(0.005);
    const back = new BodyDynamics();
    back.impulse(0, 1, 0, 1.5);
    run(back, 0.05);
    expect(back.pitchRad).toBeGreaterThan(0.05);
  });

  it('a hit from the left bends toward the right (positive roll), bounded', () => {
    const d = new BodyDynamics();
    // Character right at yaw 0 is −X; a push toward −X comes from the left.
    d.impulse(-1, 0, 0, 99);
    run(d, 0.05);
    expect(d.rollRad).toBeGreaterThan(0.05);
    expect(Math.abs(d.rollRad)).toBeLessThanOrEqual((26 * Math.PI) / 180 + 1e-6);
  });

  it('banks into a left turn while running and stays upright when idle', () => {
    const d = new BodyDynamics();
    run(d, 1, 6, 6, 3);
    expect(d.rollRad).toBeLessThan(-0.02);
    run(d, 2, 0, 0, 0);
    expect(Math.abs(d.rollRad)).toBeLessThan(0.005);
    expect(Number.isFinite(d.pitchRad)).toBe(true);
  });

  it('survives a long frame hitch without exploding', () => {
    const d = new BodyDynamics();
    d.impulse(1, 0, 0, 2);
    d.update(2, 10, 10, 12);
    expect(Math.abs(d.rollRad)).toBeLessThan(1);
    expect(Math.abs(d.pitchRad)).toBeLessThan(1);
  });
});

describe('strike keys', () => {
  it('times are ordered, start/end at idle, and the strike overshoots the hit pose', () => {
    const keys = strikeKeys(NEUTRAL, OVERHEAD_WIND, OVERHEAD_HIT, 0.4, 0.55);
    for (let i = 1; i < keys.length; i++)
      expect(keys[i]?.t ?? 0).toBeGreaterThanOrEqual(keys[i - 1]?.t ?? 0);
    expect(keys[0]?.pose).toBe(NEUTRAL);
    expect(keys[keys.length - 1]?.pose).toBe(NEUTRAL);
    const atHit = keys.find((k) => Math.abs(k.t - 0.55) < 1e-9);
    const wind = OVERHEAD_WIND.r.RightArm?.[0] ?? 0;
    const hit = OVERHEAD_HIT.r.RightArm?.[0] ?? 0;
    const over = atHit?.pose.r.RightArm?.[0] ?? 0;
    // Past the hit pose, in the direction of the swing.
    expect(Math.sign(over - hit)).toBe(Math.sign(hit - wind));
  });

  it('blendPose interpolates and extrapolates per bone', () => {
    const a = { r: { Spine: [0, 0, 0] as const }, root: [0, 0, 0] as const };
    const b = { r: { Spine: [10, 20, -10] as const }, root: [0, 1, 0] as const };
    expect(blendPose(a, b, 0.5).r.Spine).toEqual([5, 10, -5]);
    expect(blendPose(a, b, 1.1).r.Spine?.[0]).toBeCloseTo(11);
    expect(blendPose(a, b, 0.5).root).toEqual([0, 0.5, 0]);
  });
});

describe('run cycle keeps the feet planted', () => {
  it('stance foot moves backward at about the running speed (no ice skating)', async () => {
    const { HumanoidRig } = await import('../../src/anim/HumanoidRig');
    const { AnimationController } = await import('../../src/anim/AnimationController');
    const { buildHumanoidClips } = await import('../../src/anim/clipSets');
    const { runCycleSec } = await import('../../src/anim/locomotion');
    const { RIGS } = await import('../../src/data/rigs');
    const { Vector3: V3 } = await import('three');
    for (const speed of [3, 6.2]) {
      const rig = new HumanoidRig(RIGS.kael);
      const clips = buildHumanoidClips(NEUTRAL);
      const anim = new AnimationController(rig.root, clips.clips, clips.additive);
      const cycle = runCycleSec(speed, 1);
      anim.play('run', { loop: true, durationSec: cycle, fade: 0 });
      const ankle = new V3();
      const shin = RIGS.kael.proportions.shin;
      const samples: { y: number; z: number }[] = [];
      const dt = cycle / 120;
      for (let i = 0; i < 240; i++) {
        anim.update(dt);
        rig.root.updateMatrixWorld(true);
        ankle.set(0, -shin, 0);
        rig.bone('LeftLeg').localToWorld(ankle);
        if (i >= 120) samples.push({ y: ankle.y, z: ankle.z });
      }
      // Stance = the lowest third of the cycle; measure the foot's backward speed there.
      const ys = samples.map((s) => s.y).sort((a, b) => a - b);
      const cut = ys[Math.floor(ys.length / 3)] ?? 0;
      let dist = 0;
      let time = 0;
      for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1];
        const b = samples[i];
        if (a === undefined || b === undefined || a.y > cut || b.y > cut) continue;
        dist += a.z - b.z;
        time += dt;
      }
      const footSpeed = dist / time;
      expect(footSpeed, `speed ${speed}`).toBeGreaterThan(speed * 0.6);
      expect(footSpeed, `speed ${speed}`).toBeLessThan(speed * 1.5);
      anim.dispose();
      rig.dispose();
    }
  });
});
