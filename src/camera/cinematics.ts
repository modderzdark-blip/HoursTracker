import { Vector3 } from 'three';
import type { ActionDef } from '../data/combatTypes';
import type { OrbitShot } from './CameraDirector';

/** Timings and rate limits of the battle cinematics (real milliseconds). */
export const CINEMATIC_CONFIG = {
  stageIntro: {
    /** High wide sweep across the arena's landmark. */
    sweepMs: 1150,
    /** Crane down onto the hero (the entrance plays as it lands). */
    descendMs: 1000,
    /** Swing round behind the hero into the gameplay camera. */
    settleMs: 800,
    /** Progress of the descent at which the hero's entrance plays. */
    entranceAt: 0.55,
  },
  killCam: {
    durationMs: 650,
    slowScale: 0.3,
    slowMs: 520,
    /** Minimum game time between two kill cams, per kind. */
    cooldownMs: { elite: 20_000, waveEnd: 7_000 },
    /** Never more than this many per stage run. */
    maxPerRun: 6,
  },
  /** Ultimate shots stay under ~1 s (gameplay keeps running). */
  ultimateMaxMs: 950,
  bossDeath: { durationMs: 1750 },
  /** Enemies with at least this much base HP count as elites for the kill cam. */
  eliteMinHp: 900,
} as const;

/** Wraps degrees into (-180, 180]. */
export function wrapDeg(deg: number): number {
  let d = deg % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
}

/** Orbit angle (degrees) of a point seen from `center` — the camera sits on that side. */
export function bearingDeg(cx: number, cz: number, px: number, pz: number): number {
  return (Math.atan2(px - cx, pz - cz) * 180) / Math.PI;
}

export interface StageIntroInput {
  /** The hero's feet. */
  readonly hero: Vector3;
  /** Hero facing (radians; facing vector = (sin, cos)). */
  readonly heroYaw: number;
  /** The arena's landmark / focal point (where the boss rises). */
  readonly landmark: { readonly x: number; readonly z: number };
  /** Floor radius of the arena (m). */
  readonly arenaRadius: number;
  /** Gameplay camera: distance, height and look-at height, and its yaw (degrees). */
  readonly follow: {
    readonly distance: number;
    readonly height: number;
    readonly lookAtHeight: number;
    readonly yawDeg: number;
  };
}

/**
 * Stage start: a high wide sweep across the landmark that reveals the arena, a crane down onto the
 * hero (front three-quarter, low — the entrance plays here), then a swing round into exactly the
 * gameplay camera pose so the follow camera takes over without a jump. ~3 s, skippable.
 */
export function stageIntroShots(i: StageIntroInput): OrbitShot[] {
  const c = CINEMATIC_CONFIG.stageIntro;
  const lm = new Vector3(i.landmark.x, 0, i.landmark.z);
  const mid = new Vector3().addVectors(lm, i.hero).multiplyScalar(0.5);
  const hero = i.hero.clone();
  const wide = Math.max(12, i.arenaRadius * 0.75);
  // Sweep from the far side of the landmark toward the hero's side.
  const towardHero = bearingDeg(lm.x, lm.z, hero.x, hero.z);
  const heroYawDeg = (i.heroYaw * 180) / Math.PI;
  const front = heroYawDeg + 28;
  // Shortest way round from the front of the hero to the follow camera's yaw.
  const settleTo = front + wrapDeg(i.follow.yawDeg - front);
  const followRadius = i.follow.distance;
  const closeRadius = 3.1;
  return [
    {
      center: lm,
      toCenter: mid,
      radius: wide,
      height: wide * 0.72,
      endHeight: wide * 0.5,
      fromDeg: towardHero - 70,
      toDeg: towardHero - 20,
      durationMs: c.sweepMs,
      lookHeight: 1.5,
      endLookHeight: 1,
      endRadiusMult: 0.85,
      ease: 'in',
    },
    {
      center: mid,
      toCenter: hero,
      radius: wide * 0.85,
      height: wide * 0.5,
      endHeight: 1.25,
      fromDeg: towardHero - 20,
      toDeg: front,
      durationMs: c.descendMs,
      lookHeight: 1,
      endLookHeight: 1.3,
      endRadiusMult: closeRadius / (wide * 0.85),
      ease: 'out',
    },
    {
      center: hero,
      radius: closeRadius,
      height: 1.25,
      endHeight: i.follow.height,
      fromDeg: front,
      toDeg: settleTo,
      durationMs: c.settleMs,
      lookHeight: 1.3,
      endLookHeight: i.follow.lookAtHeight,
      endRadiusMult: followRadius / closeRadius,
    },
  ];
}

export type UltimateCamStyle = 'lowAngle' | 'pullOut' | 'orbit';

/**
 * Picks the ultimate's camera move from its action data: a big travelling leap or slam gets a low
 * hero angle, area strikes around or ahead of the hero (meteors, storms, lances) a crane pull-out
 * that shows the area, and close-quarters flurries a tight orbit.
 */
export function ultimateCamStyle(def: ActionDef): UltimateCamStyle {
  if ((def.move?.distance ?? 0) >= 2) return 'lowAngle';
  const fx = def.fx ?? [];
  const area = fx.some(
    (f) =>
      f.atTarget === true ||
      (f.offset !== undefined && Math.hypot(f.offset[0], f.offset[2]) >= 1.5) ||
      ((f.shape === 'pillar' || f.shape === 'nova') && (f.repeat ?? 1) >= 4),
  );
  return area ? 'pullOut' : 'orbit';
}

/** The ultimate's shot around the hero (`feet` is followed by the director). */
export function ultimateShot(def: ActionDef, feet: Vector3, yaw: number): OrbitShot {
  const yawDeg = (yaw * 180) / Math.PI;
  const ms = Math.min(CINEMATIC_CONFIG.ultimateMaxMs, Math.max(700, def.startupMs + 350));
  const center = feet.clone();
  switch (ultimateCamStyle(def)) {
    case 'lowAngle':
      // Low, looking up at the hero as the leap/slam winds up; eases back as it lands.
      return {
        center,
        radius: 3.3,
        height: 0.35,
        endHeight: 1.6,
        fromDeg: yawDeg + 115,
        toDeg: yawDeg + 160,
        durationMs: ms,
        lookHeight: 1.8,
        endLookHeight: 1.1,
        endRadiusMult: 1.7,
        ease: 'out',
      };
    case 'pullOut':
      // Close on the hero, then crane up and back to show the strikes landing around them.
      return {
        center,
        radius: 2.8,
        height: 1.4,
        endHeight: 5.2,
        fromDeg: yawDeg + 145,
        toDeg: yawDeg + 185,
        durationMs: ms,
        lookHeight: 1.25,
        endLookHeight: 0.4,
        endRadiusMult: 2.5,
      };
    case 'orbit':
      // Tight sweep across the flurry.
      return {
        center,
        radius: 2.7,
        height: 1.2,
        endHeight: 1.7,
        fromDeg: yawDeg + 95,
        toDeg: yawDeg + 195,
        durationMs: ms,
        lookHeight: 1.15,
        endRadiusMult: 1.45,
      };
  }
}

export type KillCamKind = 'elite' | 'waveEnd';

/**
 * Rate limit for kill cams so they stay a treat: a cooldown per kind, a shared minimum gap and
 * a cap per run. Pure; `nowMs` is game time.
 */
export class KillCamLimiter {
  private readonly last: Record<KillCamKind, number> = {
    elite: Number.NEGATIVE_INFINITY,
    waveEnd: Number.NEGATIVE_INFINITY,
  };
  private lastAny = Number.NEGATIVE_INFINITY;
  private count = 0;

  constructor(
    private readonly cfg: {
      readonly cooldownMs: Readonly<Record<KillCamKind, number>>;
      readonly maxPerRun: number;
    } = CINEMATIC_CONFIG.killCam,
    /** Minimum gap between any two kill cams. */
    private readonly minGapMs = 5000,
  ) {}

  get fired(): number {
    return this.count;
  }

  /** True (and records it) when a kill cam of this kind may play now. */
  tryFire(kind: KillCamKind, nowMs: number): boolean {
    if (this.count >= this.cfg.maxPerRun) return false;
    if (nowMs - this.last[kind] < this.cfg.cooldownMs[kind]) return false;
    if (nowMs - this.lastAny < this.minGapMs) return false;
    this.last[kind] = nowMs;
    this.lastAny = nowMs;
    this.count++;
    return true;
  }

  reset(): void {
    this.last.elite = Number.NEGATIVE_INFINITY;
    this.last.waveEnd = Number.NEGATIVE_INFINITY;
    this.lastAny = Number.NEGATIVE_INFINITY;
    this.count = 0;
  }
}

/** Brief push-in on the victim from the hero's side (the hero stays in the foreground). */
export function killCamShot(victim: Vector3, hero: Vector3): OrbitShot {
  const side = bearingDeg(victim.x, victim.z, hero.x, hero.z);
  return {
    center: victim.clone(),
    radius: 4.4,
    height: 2.4,
    endHeight: 1.5,
    fromDeg: side + 38,
    toDeg: side + 18,
    durationMs: CINEMATIC_CONFIG.killCam.durationMs,
    lookHeight: 0.9,
    endLookHeight: 0.8,
    endRadiusMult: 0.68,
    ease: 'out',
  };
}

/**
 * Boss death: a wide slow-motion arc around the falling boss that drifts lower as it collapses.
 * `scale` = boss height in units of a 1.9 m figure.
 */
export function bossDeathShot(boss: Vector3, hero: Vector3, scale: number): OrbitShot {
  const side = bearingDeg(boss.x, boss.z, hero.x, hero.z);
  const s = Math.max(0.8, scale);
  return {
    center: boss.clone(),
    radius: 6 * s,
    height: 2.2 * s,
    endHeight: 1.1 * s,
    fromDeg: side + 35,
    toDeg: side + 110,
    durationMs: CINEMATIC_CONFIG.bossDeath.durationMs,
    lookHeight: 1.5 * s,
    endLookHeight: 0.7 * s,
    endRadiusMult: 1.2,
  };
}

/** True for enemies big enough to earn a kill cam. */
export function isElite(maxHp: number): boolean {
  return maxHp >= CINEMATIC_CONFIG.eliteMinHp;
}
