import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CameraDirector, easeShot, type OrbitShot } from '../../src/camera/CameraDirector';
import {
  bearingDeg,
  bossDeathShot,
  CINEMATIC_CONFIG,
  isElite,
  KillCamLimiter,
  killCamShot,
  stageIntroShots,
  ultimateCamStyle,
  ultimateShot,
  wrapDeg,
} from '../../src/camera/cinematics';
import { FollowCamera } from '../../src/camera/FollowCamera';
import { DEFAULT_CAMERA_OPTIONS } from '../../src/camera/cameraOptions';
import { CAMERA_CONFIG } from '../../src/data/config';
import { HEROES } from '../../src/data/heroes';

function shot(ms: number, extra: Partial<OrbitShot> = {}): OrbitShot {
  return {
    center: new Vector3(),
    radius: 4,
    height: 2,
    fromDeg: 0,
    toDeg: 90,
    durationMs: ms,
    lookHeight: 1,
    ...extra,
  };
}

/** Runs the director for `ms` in 16 ms frames. */
function run(d: CameraDirector, cam: PerspectiveCamera, ms: number): void {
  for (let t = 0; t < ms; t += 16) d.update(0.016, cam);
}

describe('CameraDirector sequences', () => {
  it('plays shots back to back, then calls onDone once', () => {
    const d = new CameraDirector();
    const cam = new PerspectiveCamera();
    let done = 0;
    d.playSequence([shot(200), shot(200), shot(200)], () => done++, null, 'test');
    expect(d.active).toBe(true);
    expect(d.kind).toBe('test');
    run(d, cam, 250);
    expect(d.sequenceIndex).toBe(1);
    expect(done).toBe(0);
    run(d, cam, 400);
    expect(d.active).toBe(false);
    expect(done).toBe(1);
    expect(d.kind).toBe('');
  });

  it('skip ends the whole sequence on the last shot’s final pose', () => {
    const d = new CameraDirector();
    const cam = new PerspectiveCamera();
    let done = 0;
    const last = shot(300, { center: new Vector3(10, 0, 0), radius: 5, toDeg: 0, height: 3 });
    d.playSequence([shot(1000), shot(1000), last], () => done++);
    d.update(0.016, cam);
    d.skip();
    expect(d.update(0.016, cam)).toBe(true);
    expect(done).toBe(1);
    expect(d.active).toBe(false);
    // The camera ends exactly where the last shot ends (no jump when gameplay blends in).
    expect(cam.position.x).toBeCloseTo(10);
    expect(cam.position.y).toBeCloseTo(3);
    expect(cam.position.z).toBeCloseTo(5);
  });

  it('interpolates height, look height, radius and centre', () => {
    const d = new CameraDirector();
    const cam = new PerspectiveCamera();
    d.play(
      shot(100, {
        fromDeg: 0,
        toDeg: 0,
        height: 10,
        endHeight: 2,
        endRadiusMult: 0.5,
        toCenter: new Vector3(0, 0, -6),
      }),
      () => {},
    );
    run(d, cam, 200);
    expect(cam.position.y).toBeCloseTo(2);
    expect(cam.position.z).toBeCloseTo(-6 + 2);
    expect(d.focusDistance).toBeGreaterThan(1);
  });

  it('a new shot started from onDone plays (victory after the boss death)', () => {
    const d = new CameraDirector();
    const cam = new PerspectiveCamera();
    let second = false;
    d.play(shot(50), () => d.play(shot(50), () => (second = true), null, 'victory'), null, 'death');
    run(d, cam, 80);
    expect(d.kind).toBe('victory');
    run(d, cam, 80);
    expect(second).toBe(true);
  });

  it('eases monotonically from 0 to 1', () => {
    for (const e of ['smooth', 'out', 'in'] as const) {
      expect(easeShot(0, e)).toBe(0);
      expect(easeShot(1, e)).toBe(1);
      expect(easeShot(0.5, e)).toBeGreaterThan(easeShot(0.25, e));
    }
  });
});

describe('stage intro', () => {
  const follow = { distance: 5.8, height: 5, lookAtHeight: 1.1, yawDeg: 0 };
  const shots = stageIntroShots({
    hero: new Vector3(0, 0, 8),
    heroYaw: Math.PI,
    landmark: { x: 0, z: -10 },
    arenaRadius: 24,
    follow,
  });

  it('sweeps high and wide, cranes down to the hero, then lands on the gameplay pose', () => {
    expect(shots).toHaveLength(3);
    const [sweep, descend, settle] = shots;
    if (!sweep || !descend || !settle) throw new Error('missing shots');
    expect(sweep.height).toBeGreaterThan(8);
    expect(sweep.center.z).toBeCloseTo(-10);
    expect(descend.endHeight).toBeLessThan(2);
    expect(descend.toCenter?.z).toBeCloseTo(8);
    // Ends exactly at the follow camera offset: distance, height, yaw.
    expect(settle.radius * (settle.endRadiusMult ?? 1)).toBeCloseTo(follow.distance);
    expect(settle.endHeight).toBe(follow.height);
    expect(wrapDeg(settle.toDeg - follow.yawDeg)).toBeCloseTo(0);
    expect(Math.abs(settle.toDeg - settle.fromDeg)).toBeLessThanOrEqual(180);
  });

  it('lasts 2–3.5 s in total', () => {
    const total = shots.reduce((t, s) => t + s.durationMs, 0);
    expect(total).toBeGreaterThanOrEqual(2000);
    expect(total).toBeLessThanOrEqual(3500);
  });
});

describe('ultimate cams', () => {
  it('derive a style from each hero’s ultimate data and stay under ~1 s', () => {
    const styles = new Set<string>();
    for (const h of Object.values(HEROES)) {
      styles.add(ultimateCamStyle(h.ultimate));
      const s = ultimateShot(h.ultimate, new Vector3(), 0);
      expect(s.durationMs).toBeLessThanOrEqual(CINEMATIC_CONFIG.ultimateMaxMs);
      expect(s.durationMs).toBeGreaterThanOrEqual(700);
    }
    // The roster mixes moves: more than one kind of shot is used.
    expect(styles.size).toBeGreaterThan(1);
  });

  it('leaps get a low angle, area strikes a pull-out, flurries an orbit', () => {
    const base = HEROES.kael.ultimate;
    expect(
      ultimateCamStyle({
        ...base,
        fx: [],
        move: { distance: 3, startMs: 0, endMs: 300, ease: 'out' },
      }),
    ).toBe('lowAngle');
    expect(
      ultimateCamStyle({ ...base, move: undefined, fx: [{ shape: 'pillar', atTarget: true }] }),
    ).toBe('pullOut');
    expect(ultimateCamStyle({ ...base, move: undefined, fx: [{ shape: 'ring' }] })).toBe('orbit');
  });
});

describe('kill cam rate limit', () => {
  it('fires, then respects the per-kind cooldown', () => {
    const k = new KillCamLimiter();
    expect(k.tryFire('elite', 0)).toBe(true);
    expect(k.tryFire('elite', 10_000)).toBe(false);
    expect(k.tryFire('elite', 20_000)).toBe(true);
  });

  it('keeps a minimum gap between any two kill cams', () => {
    const k = new KillCamLimiter();
    expect(k.tryFire('elite', 0)).toBe(true);
    expect(k.tryFire('waveEnd', 1000)).toBe(false);
    expect(k.tryFire('waveEnd', 6000)).toBe(true);
  });

  it('caps the number per run; reset() starts over', () => {
    const k = new KillCamLimiter({ cooldownMs: { elite: 0, waveEnd: 0 }, maxPerRun: 2 }, 0);
    expect(k.tryFire('waveEnd', 0)).toBe(true);
    expect(k.tryFire('waveEnd', 1)).toBe(true);
    expect(k.tryFire('waveEnd', 2)).toBe(false);
    expect(k.fired).toBe(2);
    k.reset();
    expect(k.tryFire('elite', 3)).toBe(true);
  });

  it('elite = a heavy enemy', () => {
    expect(isElite(1500)).toBe(true);
    expect(isElite(420)).toBe(false);
  });
});

describe('kill / boss death shots', () => {
  it('put the camera on the hero’s side of the victim', () => {
    const victim = new Vector3(0, 0, 0);
    const hero = new Vector3(0, 0, 5);
    const s = killCamShot(victim, hero);
    const side = bearingDeg(0, 0, 0, 5);
    expect(Math.abs(wrapDeg(s.fromDeg - side))).toBeLessThan(60);
    expect(s.endRadiusMult).toBeLessThan(1);
    expect(s.center.z).toBeLessThan(1);
    // Far (ranged) kill: the shot aims between victim and hero.
    const far = killCamShot(victim, new Vector3(0, 0, 14));
    expect(far.center.z).toBeGreaterThan(2);
    expect(far.center.z).toBeLessThan(7);
    const b = bossDeathShot(victim, hero, 1.6);
    expect(b.radius).toBeGreaterThan(s.radius);
    expect(b.durationMs).toBe(CINEMATIC_CONFIG.bossDeath.durationMs);
  });
});

describe('dynamic gameplay framing', () => {
  const still = new Vector3();
  function step(cam: FollowCamera, target: Vector3, sec: number): void {
    for (let t = 0; t < sec; t += 0.016) cam.update(target, still, 0.016, 6);
  }

  it('a zoom punch rises and settles back to zero', () => {
    const cam = new FollowCamera(2);
    cam.snap(new Vector3());
    cam.punch(-0.16, 1000);
    step(cam, new Vector3(), 0.25);
    expect(cam.dynamicZoom).toBeLessThan(-0.1);
    step(cam, new Vector3(), 1);
    expect(cam.dynamicZoom).toBeCloseTo(0, 5);
  });

  it('eases back for a crowd, within its cap', () => {
    const cam = new FollowCamera(2);
    cam.snap(new Vector3());
    cam.setCrowd(40);
    step(cam, new Vector3(), 8);
    expect(cam.dynamicZoom).toBeGreaterThan(0.1);
    expect(cam.dynamicZoom).toBeLessThanOrEqual(CAMERA_CONFIG.dynamic.crowdZoom + 1e-6);
    cam.setCrowd(1);
    step(cam, new Vector3(), 10);
    expect(cam.dynamicZoom).toBeLessThan(0.01);
  });

  it('leans toward the nearest threat only with look-ahead on', () => {
    const lean = (lookAhead: number): number => {
      const cam = new FollowCamera(2, { ...DEFAULT_CAMERA_OPTIONS, lookAhead });
      cam.snap(new Vector3());
      cam.setThreat(new Vector3(4, 0, 0));
      step(cam, new Vector3(), 4);
      return cam.camera.position.x;
    };
    expect(lean(CAMERA_CONFIG.lookAhead)).toBeGreaterThan(0.2);
    expect(lean(CAMERA_CONFIG.lookAhead)).toBeLessThanOrEqual(CAMERA_CONFIG.dynamic.threatLead);
    expect(Math.abs(lean(0))).toBeLessThan(1e-6);
  });
});
