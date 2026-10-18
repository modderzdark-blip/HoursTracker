import type { Boss } from '../actors/Boss';
import type { Player } from '../actors/Player';
import type { BossDef } from '../data/bosses';
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
    }
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
    this.interrupt();
    this.airborne = false;
    this.enemy.visualLift = 0;
    this.enter('broken');
    this.enemy.anim.play('stagger', { loop: true, fade: 0.12 });
    this.ctx.bus.emit('boss:break', { broken: true });
  }

  private goTransition(phase: number): void {
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

  protected override indicatorOrigin(): { x: number; z: number } {
    return this.attack?.special === 'leap' ? this.lockTarget : this.enemy.currFeet;
  }

  protected override applyAttackMovement(atk: EnemyAttackDef, frac: number, dtSec: number): void {
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

  override goDead(): void {
    super.goDead();
    this.airborne = false;
    this.enemy.visualLift = 0;
  }
}
