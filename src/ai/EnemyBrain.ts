import type { Actor } from '../actors/Actor';
import type { Enemy } from '../actors/Enemy';
import { moveTowardsAngle, wrapAngle } from '../actors/components/movementMath';
import { ActionRunner } from '../combat/ActionRunner';
import type { CombatSystem } from '../combat/CombatSystem';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { EnemyAttackDef } from '../data/enemies';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { TelegraphPort } from '../vfx/telegraphPort';
import type { AttackTokenManager } from './AttackTokens';

export type AiState =
  | 'inactive'
  | 'spawning'
  | 'idle'
  | 'patrol'
  | 'alert'
  | 'chase'
  | 'position'
  | 'telegraph'
  | 'attack'
  | 'recover'
  | 'hurt'
  | 'stagger'
  | 'airborne'
  | 'knockdown'
  | 'getup'
  | 'dead'
  // Boss-only states.
  | 'intro'
  | 'transition'
  | 'broken';

export interface BrainContext {
  readonly player: Actor;
  readonly tokens: AttackTokenManager;
  readonly physics: PhysicsWorld;
  readonly combat: CombatSystem;
  readonly bus: EventBus<GameEvents>;
  readonly telegraphs: TelegraphPort;
  readonly rng: () => number;
  /** Difficulty modifier for enemy damage. */
  readonly difficultyMod: number;
}

export const AI_TUNING = {
  spawnMs: 900,
  alertMs: 380,
  /** Steering acceleration (1/s): how fast velocity follows the desired velocity. */
  steerSharpness: 9,
  strafeSpeedFrac: 0.42,
  strafeFlipMinMs: 1400,
  strafeFlipMaxMs: 3000,
  tokenRetryMs: 300,
  /** Obstacle whisker length and how often (in logic steps) each enemy probes. */
  whiskerLength: 1.8,
  whiskerEverySteps: 4,
  avoidHoldMs: 450,
  patrolRadius: 4,
  patrolSpeedFrac: 0.35,
  telegraphColor: 0xff3a1a,
  launchVy: 7.5,
} as const;

/**
 * Per-enemy AI state machine:
 * Idle → Patrol → Alert → Chase → Position → Telegraph → Attack → Recover, plus Hurt, Stagger,
 * Airborne, Knockdown, Getup and Death. Attacks need a token from the AttackTokenManager, so only
 * N enemies attack at once while the others circle (Position).
 */
export class EnemyBrain {
  state: AiState = 'inactive';
  stateMs = 0;
  readonly runner = new ActionRunner();
  attack: EnemyAttackDef | null = null;
  protected readonly hitSet = new Set<number>();
  /** Per-attack cooldowns, indexed like enemy.def.attacks (no allocation while ticking). */
  protected cooldowns = new Float64Array(0);
  private strafeDir = 1;
  private strafeTimerMs = 0;
  private tokenRetryMs = 0;
  private avoidX = 0;
  private avoidZ = 0;
  private avoidMs = 0;
  private stepCounter = 0;
  private readonly patrolTarget = { x: 0, z: 0 };
  protected indicator = -1;
  protected reactionMs = 0;
  protected readonly lockTarget = { x: 0, z: 0 };
  private readonly onRunnerHit = (i: number): void => this.fireHit(i);
  protected enemy!: Enemy;

  constructor(protected readonly ctx: BrainContext) {}

  bind(enemy: Enemy): void {
    this.enemy = enemy;
    this.cooldowns = new Float64Array(enemy.def.attacks.length);
  }

  private cooldownIndex(a: EnemyAttackDef): number {
    return this.enemy.def.attacks.indexOf(a);
  }

  reset(): void {
    this.runner.stop();
    this.attack = null;
    this.cooldowns.fill(0);
    this.hideIndicator();
    this.ctx.tokens.release(this.enemy.id);
    this.state = 'inactive';
    this.stateMs = 0;
  }

  enter(state: AiState): void {
    this.state = state;
    this.stateMs = 0;
  }

  get busyAttacking(): boolean {
    return this.state === 'telegraph' || this.state === 'attack';
  }

  hasSuperArmor(): boolean {
    return this.busyAttacking && this.attack?.superArmor === true;
  }

  // ------------------------------------------------------------------ main loop

  think(dtSec: number): void {
    const e = this.enemy;
    const dtMs = dtSec * 1000;
    this.stateMs += dtMs;
    this.stepCounter++;
    for (let i = 0; i < this.cooldowns.length; i++) {
      const ms = this.cooldowns[i] ?? 0;
      if (ms > 0) this.cooldowns[i] = ms - dtMs;
    }
    const p = this.ctx.player;
    switch (this.state) {
      case 'inactive':
      case 'dead':
        e.vel.x = e.vel.z = 0;
        break;
      case 'spawning':
        e.vel.x = e.vel.z = 0;
        if (this.stateMs >= AI_TUNING.spawnMs) this.goAlert();
        break;
      case 'idle':
        this.steerStop(dtSec);
        if (p.alive && e.distanceTo(p) < e.def.aggroRange) this.goAlert();
        else if (this.stateMs > 1500) this.goPatrol();
        break;
      case 'patrol':
        if (p.alive && e.distanceTo(p) < e.def.aggroRange) {
          this.goAlert();
          break;
        }
        if (
          this.steerToward(
            dtSec,
            this.patrolTarget.x,
            this.patrolTarget.z,
            AI_TUNING.patrolSpeedFrac,
          ) < 0.4
        ) {
          this.enter('idle');
          e.playLocomotion(0);
        }
        break;
      case 'alert':
        this.steerStop(dtSec);
        this.turnToward(p.currFeet.x, p.currFeet.z, dtSec);
        if (this.stateMs >= AI_TUNING.alertMs) this.goChase();
        break;
      case 'chase':
        this.tickChase(dtSec);
        break;
      case 'position':
        this.tickPosition(dtSec);
        break;
      case 'telegraph':
      case 'attack':
      case 'recover':
        this.tickAttack(dtSec, dtMs);
        break;
      case 'hurt':
      case 'stagger':
        this.steerStop(dtSec);
        if (this.stateMs >= this.reactionMs) this.goChase();
        break;
      case 'airborne':
        e.vel.x = e.vel.z = 0;
        if (this.stateMs > 120 && e.body.grounded && e.vy <= 0) this.goKnockdown();
        break;
      case 'knockdown':
        e.vel.x = e.vel.z = 0;
        if (this.stateMs >= e.def.knockdownMs) {
          this.enter('getup');
          e.anim.play('getup', { durationSec: e.def.getupMs / 1000, fade: 0.08, restart: true });
        }
        break;
      case 'getup':
        if (this.stateMs >= e.def.getupMs) this.goChase();
        break;
    }
  }

  // ------------------------------------------------------------------ states

  goSpawning(): void {
    this.enter('spawning');
    this.enemy.anim.play('spawn', {
      durationSec: AI_TUNING.spawnMs / 1000,
      fade: 0,
      restart: true,
    });
  }

  protected goAlert(): void {
    this.enter('alert');
    this.enemy.playLocomotion(0);
  }

  protected goPatrol(): void {
    const e = this.enemy;
    const a = this.ctx.rng() * Math.PI * 2;
    const r = AI_TUNING.patrolRadius * (0.4 + this.ctx.rng() * 0.6);
    this.patrolTarget.x = e.currFeet.x + Math.cos(a) * r;
    this.patrolTarget.z = e.currFeet.z + Math.sin(a) * r;
    this.enter('patrol');
  }

  protected goChase(): void {
    this.enter('chase');
  }

  protected tickChase(dtSec: number): void {
    const e = this.enemy;
    const p = this.ctx.player;
    if (!p.alive) {
      this.steerStop(dtSec);
      return;
    }
    const gap = e.gapTo(p);
    const atk = this.pickAttack(gap);
    if (atk !== null && this.ctx.tokens.request(e.id)) {
      this.startTelegraph(atk);
      return;
    }
    const hasToken = this.ctx.tokens.holds(e.id);
    if (!hasToken && gap <= e.def.holdDistance) {
      this.enter('position');
      this.strafeDir = this.ctx.rng() < 0.5 ? -1 : 1;
      this.strafeTimerMs = this.randomStrafeMs();
      return;
    }
    // With a token (or far away): close in to attack range.
    const stopAt = hasToken ? this.closestAttackRange() * 0.8 : 0;
    if (gap > stopAt) this.steerToward(dtSec, p.currFeet.x, p.currFeet.z, 1);
    else this.steerStop(dtSec);
    this.turnToward(p.currFeet.x, p.currFeet.z, dtSec);
  }

  protected tickPosition(dtSec: number): void {
    const e = this.enemy;
    const p = this.ctx.player;
    if (!p.alive) {
      this.steerStop(dtSec);
      return;
    }
    const gap = e.gapTo(p);
    if (gap > e.def.holdDistance + 2.5) {
      this.goChase();
      return;
    }
    this.tokenRetryMs -= dtSec * 1000;
    if (this.tokenRetryMs <= 0) {
      this.tokenRetryMs = AI_TUNING.tokenRetryMs;
      if (this.anyAttackReady() && this.ctx.tokens.request(e.id)) {
        this.goChase();
        return;
      }
    }
    this.strafeTimerMs -= dtSec * 1000;
    if (this.strafeTimerMs <= 0) {
      this.strafeDir = -this.strafeDir;
      this.strafeTimerMs = this.randomStrafeMs();
    }
    // Circle the player: tangent + radial correction toward the hold distance.
    let dx = p.currFeet.x - e.currFeet.x;
    let dz = p.currFeet.z - e.currFeet.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const radial = Math.max(-1, Math.min(1, (gap - e.def.holdDistance) * 0.8));
    const tx = -dz * this.strafeDir + dx * radial;
    const tz = dx * this.strafeDir + dz * radial;
    this.steerDir(dtSec, tx, tz, AI_TUNING.strafeSpeedFrac, false);
    this.turnToward(p.currFeet.x, p.currFeet.z, dtSec);
  }

  protected startTelegraph(atk: EnemyAttackDef): void {
    const e = this.enemy;
    const p = this.ctx.player;
    this.attack = atk;
    this.runner.start(atk, e.actionSpeed);
    this.hitSet.clear();
    this.enter('telegraph');
    e.vel.x = e.vel.z = 0;
    this.lockTarget.x = p.currFeet.x;
    this.lockTarget.z = p.currFeet.z;
    e.anim.play(`${atk.id}:tele`, {
      durationSec: this.runner.startupEndMs / 1000,
      fade: 0.1,
      restart: true,
    });
    if (atk.indicator) {
      const at = this.indicatorOrigin();
      this.indicator = this.ctx.telegraphs.show(
        atk.hits[0]?.spec.shape ?? { kind: 'circle', radius: 1, forward: 0 },
        at.x,
        at.z,
        e.yaw,
        AI_TUNING.telegraphColor,
      );
    }
    this.ctx.bus.emit('enemy:telegraph', { actorId: e.id, attackId: atk.id });
  }

  /** Where the indicator is drawn (the attacker; leap attacks override with the landing point). */
  protected indicatorOrigin(): { x: number; z: number } {
    return this.enemy.currFeet;
  }

  protected tickAttack(dtSec: number, dtMs: number): void {
    const e = this.enemy;
    const atk = this.attack;
    if (atk === null) {
      this.goChase();
      return;
    }
    const p = this.ctx.player;
    const phaseBefore = this.runner.phase;
    if (
      phaseBefore === 'startup' &&
      this.runner.startupProgress < (atk.trackUntil ?? 0.5) &&
      p.alive
    ) {
      this.turnToward(p.currFeet.x, p.currFeet.z, dtSec);
      this.lockTarget.x = p.currFeet.x;
      this.lockTarget.z = p.currFeet.z;
    }
    const frac = this.runner.advance(dtMs, this.onRunnerHit);
    if (this.runner.sweeping) {
      const first = atk.hits[0];
      if (first !== undefined) this.strike(first.spec);
    }
    this.applyAttackMovement(atk, frac, dtSec);
    if (this.indicator >= 0) {
      const at = this.indicatorOrigin();
      this.ctx.telegraphs.update(this.indicator, this.runner.startupProgress, at.x, at.z, e.yaw);
    }
    const phase = this.runner.phase;
    if (phase !== phaseBefore) {
      if (phase === 'active') {
        this.enter('attack');
        e.anim.play(`${atk.id}:strike`, {
          durationSec: (this.runner.totalMs - this.runner.startupEndMs) / 1000,
          fade: 0.04,
          restart: true,
        });
        this.hideIndicator();
      } else if (phase === 'recovery') {
        // Punish window: free the token so another enemy can begin its telegraph.
        this.enter('recover');
        this.ctx.tokens.release(e.id);
      }
    }
    if (phase === 'done') this.finishAttack(atk);
    e.vel.x = e.vel.z = 0;
  }

  protected applyAttackMovement(atk: EnemyAttackDef, frac: number, _dtSec: number): void {
    const dist = atk.move?.distance ?? 0;
    if (frac !== 0 && dist !== 0) {
      const e = this.enemy;
      e.actionDisp.x += Math.sin(e.yaw) * dist * frac;
      e.actionDisp.z += Math.cos(e.yaw) * dist * frac;
    }
  }

  protected finishAttack(atk: EnemyAttackDef): void {
    const ci = this.cooldownIndex(atk);
    if (ci >= 0) this.cooldowns[ci] = atk.cooldownMs;
    this.ctx.tokens.release(this.enemy.id);
    this.attack = null;
    this.runner.stop();
    const next = atk.chainNext;
    if (next !== undefined && this.ctx.rng() < (atk.chainChance ?? 0)) {
      const chained = this.enemy.attackById(next);
      if (chained !== undefined) {
        this.startTelegraph(chained);
        return;
      }
    }
    this.goChase();
    this.enemy.playLocomotion(0);
  }

  protected fireHit(index: number): void {
    const hit = this.attack?.hits[index];
    if (hit === undefined) return;
    if (this.attack?.sweep !== true) this.hitSet.clear();
    this.strike(hit.spec);
  }

  protected strike(spec: EnemyAttackDef['hits'][number]['spec']): void {
    const r = this.ctx.combat.strike(this.enemy, spec, {
      difficultyMod: this.ctx.difficultyMod * this.enemy.damageMult,
      hitSet: this.hitSet,
    });
    if (r.hits > 0) {
      this.ctx.bus.emit('time:hitStop', { ms: r.maxHitStopMs });
      this.ctx.bus.emit('camera:shake', { trauma: r.maxShake });
    }
  }

  // ------------------------------------------------------------------ reactions

  /** Interrupts the current attack (hit reaction / stagger). */
  interrupt(): void {
    this.runner.stop();
    this.attack = null;
    this.hideIndicator();
    this.ctx.tokens.release(this.enemy.id);
  }

  goHurt(ms: number): void {
    this.interrupt();
    this.enter('hurt');
    this.reactionMs = ms;
  }

  goStagger(ms: number): void {
    this.interrupt();
    this.enter('stagger');
    this.reactionMs = ms;
    this.enemy.anim.play('stagger', { loop: true, fade: 0.1 });
  }

  goAirborne(): void {
    this.interrupt();
    this.enter('airborne');
    this.enemy.vy = AI_TUNING.launchVy;
    this.enemy.anim.play('knockdown', { durationSec: 0.9, fade: 0.06, restart: true });
  }

  goKnockdown(): void {
    this.interrupt();
    this.enter('knockdown');
    this.enemy.anim.play('knockdown', {
      durationSec: Math.max(0.4, this.enemy.def.knockdownMs / 1000),
      fade: 0.06,
      restart: true,
    });
  }

  goDead(): void {
    this.interrupt();
    this.enter('dead');
  }

  protected hideIndicator(): void {
    if (this.indicator >= 0) {
      this.ctx.telegraphs.hide(this.indicator);
      this.indicator = -1;
    }
  }

  // ------------------------------------------------------------------ helpers

  protected attackPool(): readonly EnemyAttackDef[] {
    return this.enemy.def.attacks;
  }

  protected pickAttack(gap: number): EnemyAttackDef | null {
    let total = 0;
    for (const a of this.attackPool()) {
      if (this.usable(a, gap)) total += a.weight;
    }
    if (total <= 0) return null;
    let roll = this.ctx.rng() * total;
    for (const a of this.attackPool()) {
      if (!this.usable(a, gap)) continue;
      roll -= a.weight;
      if (roll <= 0) return a;
    }
    return null;
  }

  protected usable(a: EnemyAttackDef, gap: number): boolean {
    return (
      a.weight > 0 &&
      (this.cooldowns[this.cooldownIndex(a)] ?? 0) <= 0 &&
      gap <= a.range &&
      gap >= (a.minRange ?? -Infinity)
    );
  }

  private anyAttackReady(): boolean {
    for (const a of this.attackPool()) {
      if (a.weight > 0 && (this.cooldowns[this.cooldownIndex(a)] ?? 0) <= 0) return true;
    }
    return false;
  }

  private closestAttackRange(): number {
    let r = Infinity;
    for (const a of this.attackPool()) if (a.weight > 0) r = Math.min(r, a.range);
    return Number.isFinite(r) ? r : 1;
  }

  private randomStrafeMs(): number {
    return (
      AI_TUNING.strafeFlipMinMs +
      this.ctx.rng() * (AI_TUNING.strafeFlipMaxMs - AI_TUNING.strafeFlipMinMs)
    );
  }

  protected turnToward(x: number, z: number, dtSec: number): void {
    const e = this.enemy;
    const dx = x - e.currFeet.x;
    const dz = z - e.currFeet.z;
    if (dx * dx + dz * dz < 1e-6) return;
    const target = Math.atan2(dx, dz);
    e.yaw = moveTowardsAngle(
      e.yaw,
      target,
      ((e.def.turnRateDeg * e.speedMult * Math.PI) / 180) * dtSec,
    );
  }

  /** Steers toward a point; returns the remaining distance. */
  protected steerToward(dtSec: number, x: number, z: number, speedFrac: number): number {
    const e = this.enemy;
    const dx = x - e.currFeet.x;
    const dz = z - e.currFeet.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) {
      this.steerStop(dtSec);
      return 0;
    }
    this.steerDir(dtSec, dx / d, dz / d, speedFrac, true);
    return d;
  }

  /** Velocity steering with whisker-ray obstacle avoidance against level geometry. */
  protected steerDir(
    dtSec: number,
    dirX: number,
    dirZ: number,
    speedFrac: number,
    faceMove: boolean,
  ): void {
    const e = this.enemy;
    let dx = dirX;
    let dz = dirZ;
    this.avoidMs -= dtSec * 1000;
    if (this.avoidMs > 0) {
      dx = dx * 0.35 + this.avoidX * 0.65;
      dz = dz * 0.35 + this.avoidZ * 0.65;
    } else if ((this.stepCounter + e.id) % AI_TUNING.whiskerEverySteps === 0) {
      const len = AI_TUNING.whiskerLength + e.radius;
      const y = e.currFeet.y + 0.5;
      const ahead = this.ctx.physics.castWorldRay(e.currFeet.x, y, e.currFeet.z, dx, dz, len);
      if (ahead < len) {
        const c = Math.SQRT1_2;
        const lx = dx * c - dz * c;
        const lz = dx * c + dz * c;
        const rx = dx * c + dz * c;
        const rz = -dx * c + dz * c;
        const left = this.ctx.physics.castWorldRay(e.currFeet.x, y, e.currFeet.z, lx, lz, len);
        const right = this.ctx.physics.castWorldRay(e.currFeet.x, y, e.currFeet.z, rx, rz, len);
        if (left >= right) {
          this.avoidX = lx;
          this.avoidZ = lz;
        } else {
          this.avoidX = rx;
          this.avoidZ = rz;
        }
        this.avoidMs = AI_TUNING.avoidHoldMs;
        dx = this.avoidX;
        dz = this.avoidZ;
      }
    }
    const len = Math.hypot(dx, dz) || 1;
    const speed = e.def.stats.moveSpeed * e.speedMult * e.status.speedMult() * speedFrac;
    const tx = (dx / len) * speed;
    const tz = (dz / len) * speed;
    const k = 1 - Math.exp(-AI_TUNING.steerSharpness * dtSec);
    e.vel.x += (tx - e.vel.x) * k;
    e.vel.z += (tz - e.vel.z) * k;
    if (faceMove && speed > 0.1) {
      e.yaw = moveTowardsAngle(
        e.yaw,
        Math.atan2(tx, tz),
        ((e.def.turnRateDeg * Math.PI) / 180) * dtSec,
      );
    }
    e.playLocomotion(Math.hypot(e.vel.x, e.vel.z));
  }

  protected steerStop(dtSec: number): void {
    const e = this.enemy;
    const k = 1 - Math.exp(-AI_TUNING.steerSharpness * dtSec);
    e.vel.x -= e.vel.x * k;
    e.vel.z -= e.vel.z * k;
    e.playLocomotion(Math.hypot(e.vel.x, e.vel.z));
  }

  /** Signed angle from the enemy's facing to the player (for look-at). */
  angleToPlayer(): number {
    const e = this.enemy;
    const p = this.ctx.player;
    return wrapAngle(Math.atan2(p.currFeet.x - e.currFeet.x, p.currFeet.z - e.currFeet.z) - e.yaw);
  }
}
