import type { Boss } from '../actors/Boss';
import type { Player } from '../actors/Player';
import type { BossDef } from '../data/bosses';
import type { HitSpec } from '../data/combatTypes';
import type { EnemyAttackDef } from '../data/enemies';
import { EnemyBrain, type BrainContext } from './EnemyBrain';

export const BOSS_TUNING = {
  /** Peak height of the leap arc (visual), metres. */
  leapHeight: 3.6,
  /** Fraction of the telegraph at which the boss leaves the ground. */
  leapTakeoff: 0.5,
  /** Fraction of the transition at which the shockwave fires. */
  shockwaveAt: 0.4,
  shockwavePush: 4,
  /** Boss stops approaching at this edge distance when no attack is usable. */
  approachStop: 1.6,
  /** Burrow: how deep the body sinks (visual, metres), and the telegraph fractions at which it is
   * fully under, and at which it reaches the eruption point. */
  burrowDepth: 4,
  burrowUnder: 0.3,
  burrowArrive: 0.92,
  /** Burrow: time the eruption takes to bring the body back up (ms). */
  burrowEmergeMs: 280,
} as const;

/**
 * Boss behaviour on top of the enemy brain: no attack tokens (the boss always may attack),
 * phase-based attack pools, intro / phase transition / break (stun) states, enrage timer and the
 * leap slam (target locked during the telegraph, ground indicator at the landing point).
 */
export class BossBrain extends EnemyBrain {
  phase = 0;
  enraged = false;
  fightMs = 0;
  private pendingPhase = -1;
  private shockwaveDone = false;
  private readonly jumpStart = { x: 0, z: 0 };
  private airborne = false;
  /** Grab: time left holding the player, and the follow-up hit. */
  private grabMs = 0;
  private grabSpec: HitSpec | null = null;
  private hazardMs = 0;
  /** Called when the phase-change shockwave fires (VFX/SFX/camera). */
  onShockwave: ((x: number, z: number) => void) | null = null;

  constructor(
    ctx: BrainContext,
    private readonly bossDef: BossDef,
  ) {
    super(ctx);
  }

  private get boss(): Boss {
    return this.enemy as Boss;
  }

  override reset(): void {
    super.reset();
    this.phase = 0;
    this.enraged = false;
    this.fightMs = 0;
    this.pendingPhase = -1;
    this.airborne = false;
    this.grabMs = 0;
    this.grabSpec = null;
    this.hazardMs = 0;
  }

  beginIntro(): void {
    this.enter('intro');
    this.enemy.anim.play('roar', {
      durationSec: this.bossDef.introMs / 1000,
      fade: 0.1,
      restart: true,
    });
  }

  beginFight(): void {
    this.applyPhase(0);
    this.goChase();
  }

  override hasSuperArmor(): boolean {
    // Bosses never flinch; only a break (poise) interrupts them.
    return this.state !== 'broken' && this.state !== 'dead';
  }

  override think(dtSec: number): void {
    const dtMs = dtSec * 1000;
    if (this.state !== 'intro' && this.state !== 'dead' && this.state !== 'inactive') {
      this.fightMs += dtMs;
      if (!this.enraged && this.fightMs >= this.bossDef.enrageAfterMs) this.enrage();
      if (this.state !== 'transition') this.tickHazard(dtMs);
    }
    if (this.grabMs > 0) this.tickGrab(dtMs);
    switch (this.state) {
      case 'intro':
        this.stateMs += dtMs;
        this.enemy.vel.x = this.enemy.vel.z = 0;
        return;
      case 'transition':
        this.stateMs += dtMs;
        this.tickTransition();
        return;
      case 'broken':
        this.stateMs += dtMs;
        this.steerStop(dtSec);
        if (this.stateMs >= this.bossDef.breakStunMs) {
          this.enemy.poise.refill();
          this.ctx.bus.emit('boss:break', { broken: false });
          this.goChase();
          this.enemy.playLocomotion(0);
        }
        return;
      default:
        super.think(dtSec);
    }
  }

  /** Checks HP thresholds; call after every hit that didn't kill. */
  checkPhase(): void {
    const frac = this.enemy.health.frac;
    const phases = this.bossDef.phases;
    let target = this.phase;
    for (let i = this.phase + 1; i < phases.length; i++) {
      const ph = phases[i];
      if (ph !== undefined && frac <= ph.fromHpFrac) target = i;
    }
    if (target > this.phase && this.state !== 'transition') this.goTransition(target);
  }

  goBroken(): void {
    if (this.state === 'transition' || this.state === 'intro' || this.state === 'dead') return;
    this.endGrab(false);
    this.interrupt();
    this.airborne = false;
    this.enemy.visualLift = 0;
    this.enter('broken');
    this.enemy.anim.play('stagger', { loop: true, fade: 0.12 });
    this.ctx.bus.emit('boss:break', { broken: true });
  }

  private goTransition(phase: number): void {
    this.endGrab(false);
    this.interrupt();
    this.airborne = false;
    this.enemy.visualLift = 0;
    this.pendingPhase = phase;
    this.shockwaveDone = false;
    this.enter('transition');
    this.enemy.vel.x = this.enemy.vel.z = 0;
    this.enemy.anim.play('roar', {
      durationSec: this.bossDef.transitionMs / 1000,
      fade: 0.1,
      restart: true,
    });
  }

  private tickTransition(): void {
    const e = this.enemy;
    e.vel.x = e.vel.z = 0;
    const t = this.stateMs / this.bossDef.transitionMs;
    if (!this.shockwaveDone && t >= BOSS_TUNING.shockwaveAt) {
      this.shockwaveDone = true;
      this.applyPhase(this.pendingPhase);
      const p = this.ctx.player as Player;
      const d = e.distanceTo(p);
      if (p.alive && d < this.bossDef.transitionPushRadius) {
        const dx = (p.currFeet.x - e.currFeet.x) / (d || 1);
        const dz = (p.currFeet.z - e.currFeet.z) / (d || 1);
        p.shove(
          dx,
          dz,
          BOSS_TUNING.shockwavePush * (1 - d / this.bossDef.transitionPushRadius) + 1,
        );
      }
      this.ctx.bus.emit('camera:shake', { trauma: 0.7 });
      this.onShockwave?.(e.currFeet.x, e.currFeet.z);
    }
    if (t >= 1) this.goChase();
  }

  private applyPhase(index: number): void {
    const ph = this.bossDef.phases[index];
    if (ph === undefined) return;
    this.phase = index;
    this.boss.applyPhaseMultipliers(ph.speedMult, ph.damageMult, this.enraged);
    this.enemy.rig.setWeaponFx(ph.weaponFx);
    if (index > 0) this.ctx.bus.emit('boss:phase', { phase: index, label: ph.label });
  }

  private enrage(): void {
    this.enraged = true;
    const ph = this.bossDef.phases[this.phase];
    this.boss.applyPhaseMultipliers(ph?.speedMult ?? 1, ph?.damageMult ?? 1, true);
    this.enemy.rig.setGlowIntensity(4);
    this.ctx.bus.emit('boss:enrage', {});
  }

  protected override attackPool(): readonly EnemyAttackDef[] {
    return this.boss.phaseAttacks(this.phase);
  }

  protected override tickChase(dtSec: number): void {
    const e = this.enemy;
    const p = this.ctx.player;
    if (!p.alive) {
      this.steerStop(dtSec);
      return;
    }
    const gap = e.gapTo(p);
    const atk = this.pickAttack(gap);
    if (atk !== null) {
      this.startTelegraph(atk);
      return;
    }
    if (gap > BOSS_TUNING.approachStop) this.steerToward(dtSec, p.currFeet.x, p.currFeet.z, 1);
    else this.steerStop(dtSec);
    this.turnToward(p.currFeet.x, p.currFeet.z, dtSec);
  }

  protected override startTelegraph(atk: EnemyAttackDef): void {
    this.airborne = false;
    super.startTelegraph(atk);
  }

  // ------------------------------------------------------------------ grab

  protected override strike(spec: EnemyAttackDef['hits'][number]['spec']): number {
    const hits = super.strike(spec);
    const atk = this.attack;
    if (hits > 0 && atk?.special === 'grab' && atk.grab !== undefined) {
      const p = this.ctx.player as Player;
      if (p.alive) {
        p.grab(atk.grab.holdMs);
        this.grabMs = atk.grab.holdMs;
        this.grabSpec = atk.grab.spec;
        this.ctx.bus.emit('boss:grab', { holding: true });
      }
    }
    return hits;
  }

  private tickGrab(dtMs: number): void {
    this.grabMs -= dtMs;
    const e = this.enemy;
    const p = this.ctx.player;
    // Hold the player in front of the boss.
    const reach = e.radius + p.radius + 0.6;
    p.push.x += (e.currFeet.x + Math.sin(e.yaw) * reach - p.currFeet.x) * 0.25;
    p.push.z += (e.currFeet.z + Math.cos(e.yaw) * reach - p.currFeet.z) * 0.25;
    if (this.grabMs <= 0) this.endGrab(true);
  }

  private endGrab(slam: boolean): void {
    if (this.grabSpec === null) return;
    const spec = this.grabSpec;
    this.grabSpec = null;
    this.grabMs = 0;
    const p = this.ctx.player as Player;
    if (slam && p.alive) {
      const e = this.enemy;
      const dx = Math.sin(e.yaw);
      const dz = Math.cos(e.yaw);
      p.releaseGrab();
      this.ctx.combat.applyHit(e, p, spec, dx, dz, {
        difficultyMod: this.ctx.difficultyMod * e.damageMult,
      });
      this.ctx.bus.emit('camera:shake', { trauma: spec.shake });
      this.ctx.bus.emit('time:hitStop', { ms: spec.hitStopMs });
    } else {
      p.releaseGrab();
    }
    this.ctx.bus.emit('boss:grab', { holding: false });
  }

  // ------------------------------------------------------------------ hazards

  private tickHazard(dtMs: number): void {
    const hz = this.bossDef.phases[this.phase]?.hazard;
    if (hz === undefined || this.ctx.effects === undefined) return;
    this.hazardMs += dtMs;
    if (this.hazardMs < hz.everyMs) return;
    this.hazardMs = 0;
    const p = this.ctx.player;
    this.ctx.effects.emit(
      this.enemy,
      hz.spec,
      hz.emit,
      { difficultyMod: this.ctx.difficultyMod * this.enemy.damageMult },
      p.currFeet,
    );
  }

  protected override indicatorOrigin(): { x: number; z: number } {
    const sp = this.attack?.special;
    return sp === 'leap' || sp === 'burrow' ? this.lockTarget : this.enemy.currFeet;
  }

  protected override applyAttackMovement(atk: EnemyAttackDef, frac: number, dtSec: number): void {
    if (atk.special === 'fly') {
      this.flyMovement(atk, dtSec);
      return;
    }
    if (atk.special === 'burrow') {
      this.burrowMovement();
      return;
    }
    if (atk.special !== 'leap') {
      super.applyAttackMovement(atk, frac, dtSec);
      return;
    }
    const e = this.enemy;
    if (this.runner.phase !== 'startup') {
      if (this.airborne) {
        this.airborne = false;
        e.visualLift = 0;
      }
      return;
    }
    const prog = this.runner.startupProgress;
    if (prog < BOSS_TUNING.leapTakeoff) return;
    if (!this.airborne) {
      this.airborne = true;
      this.jumpStart.x = e.currFeet.x;
      this.jumpStart.z = e.currFeet.z;
    }
    const t = (prog - BOSS_TUNING.leapTakeoff) / (1 - BOSS_TUNING.leapTakeoff);
    const tx = this.jumpStart.x + (this.lockTarget.x - this.jumpStart.x) * t;
    const tz = this.jumpStart.z + (this.lockTarget.z - this.jumpStart.z) * t;
    e.actionDisp.x += tx - e.currFeet.x;
    e.actionDisp.z += tz - e.currFeet.z;
    e.visualLift = 4 * BOSS_TUNING.leapHeight * t * (1 - t);
  }

  /** Take off during the wind-up, hover (drifting after the player) while active, then land. */
  private flyMovement(atk: EnemyAttackDef, dtSec: number): void {
    const e = this.enemy;
    const h = atk.flyHeight ?? 4;
    const r = this.runner;
    if (r.phase === 'startup') {
      const t = r.startupProgress;
      e.visualLift = h * t * t * (3 - 2 * t);
    } else if (r.phase === 'active') {
      e.visualLift = h + Math.sin(this.stateMs / 260) * 0.25;
      const p = this.ctx.player;
      const dx = p.currFeet.x - e.currFeet.x;
      const dz = p.currFeet.z - e.currFeet.z;
      const d = Math.hypot(dx, dz);
      if (d > 3) {
        e.actionDisp.x += (dx / d) * 1.6 * dtSec;
        e.actionDisp.z += (dz / d) * 1.6 * dtSec;
      }
      this.turnToward(p.currFeet.x, p.currFeet.z, dtSec);
    } else if (r.phase === 'recovery') {
      const span = r.totalMs - r.activeEndMs;
      const t = span > 0 ? Math.min(1, (r.elapsedMs - r.activeEndMs) / span) : 1;
      e.visualLift = h * (1 - Math.min(1, t * 1.6));
    } else {
      e.visualLift = 0;
    }
  }

  /** Sink during the wind-up, tunnel to the locked point, erupt when the attack goes active. */
  private burrowMovement(): void {
    const e = this.enemy;
    const r = this.runner;
    const T = BOSS_TUNING;
    if (r.phase === 'startup') {
      const prog = r.startupProgress;
      e.visualLift = -T.burrowDepth * Math.min(1, prog / T.burrowUnder) ** 2;
      if (prog < T.burrowUnder) return;
      if (!this.airborne) {
        this.airborne = true;
        this.jumpStart.x = e.currFeet.x;
        this.jumpStart.z = e.currFeet.z;
      }
      const t = Math.min(1, (prog - T.burrowUnder) / (T.burrowArrive - T.burrowUnder));
      const k = t * t * (3 - 2 * t);
      e.actionDisp.x +=
        this.jumpStart.x + (this.lockTarget.x - this.jumpStart.x) * k - e.currFeet.x;
      e.actionDisp.z +=
        this.jumpStart.z + (this.lockTarget.z - this.jumpStart.z) * k - e.currFeet.z;
    } else if (r.phase === 'active' || r.phase === 'recovery') {
      this.airborne = false;
      const t = Math.min(1, (r.elapsedMs - r.startupEndMs) / T.burrowEmergeMs);
      e.visualLift = -T.burrowDepth * (1 - t) * (1 - t);
    } else {
      this.airborne = false;
      e.visualLift = 0;
    }
  }

  /** Below ground during a burrow (cannot be hit). */
  get submerged(): boolean {
    return this.attack?.special === 'burrow' && this.enemy.visualLift < -0.8;
  }

  override goDead(): void {
    this.endGrab(false);
    super.goDead();
    this.airborne = false;
    this.enemy.visualLift = 0;
  }
}
