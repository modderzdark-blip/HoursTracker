import type { Scene } from 'three';
import {
  buildCustomActionClip,
  buildActionClip,
  buildDodgeClips,
  buildHumanoidClips,
} from '../anim/clipSets';
import { POSE_LIBRARY } from '../anim/poses';
import { ActionRunner } from '../combat/ActionRunner';
import type { CombatSystem, StrikeOptions } from '../combat/CombatSystem';
import type { Effects } from '../combat/Effects';
import { Cooldowns } from '../combat/Cooldowns';
import { UltimateMeter } from '../combat/UltimateMeter';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { ActionDef, TrailSide } from '../data/combatTypes';
import { PHYSICS_CONFIG } from '../data/config';
import { ECONOMY } from '../data/economy';
import type { StatBlock } from '../data/combatTypes';
import type { HeroDef, SkillDef } from '../data/heroes';
import { RIGS } from '../data/rigs';
import type { InputState } from '../input/InputState';
import { emptyMods, type HeroMods } from '../progression/skillTree';
import { GROUP } from '../physics/groups';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { Actor, type HitReceived } from './Actor';
import { CharacterMotor, type Displacement } from './components/CharacterMotor';
import { wrapAngle } from './components/movementMath';

export type PlayerState =
  | 'locomotion'
  | 'attack'
  | 'skill'
  | 'ultimate'
  | 'dodge'
  | 'hurt'
  | 'airborne'
  | 'knockdown'
  | 'getup'
  | 'dead';

export interface PlayerDeps {
  readonly hero: HeroDef;
  readonly physics: PhysicsWorld;
  readonly scene: Scene;
  readonly combat: CombatSystem;
  readonly input: InputState;
  readonly bus: EventBus<GameEvents>;
  readonly clock: () => number;
  /** Camera ground basis for camera-relative movement. */
  readonly basis: { forwardXZ: { x: number; z: number }; rightXZ: { x: number; z: number } };
  /** Enemies the player can target (auto-aim, Umbral Step). */
  readonly targets: () => readonly Actor[];
  /** Battle stats (level + gear); defaults to the hero's level-1 stats. */
  readonly stats?: StatBlock;
  /** Skill-tree modifiers; defaults to none. */
  readonly mods?: HeroMods;
  /** Projectiles / ground zones for emitting moves (bows, slams, traps). */
  readonly effects?: Effects;
}

const SKILL_ACTIONS = ['skill1', 'skill2', 'skill3'] as const;
const LAUNCH_VY = 8;

/**
 * The hero. A fixed-step state machine reading the buffered input:
 * locomotion ⇄ attack (combo with cancel windows) / skill / ultimate / dodge (i-frames, perfect
 * dodge), plus hurt / airborne / knockdown / getup / dead reactions. All timings come from data.
 */
export class Player extends Actor {
  readonly team = 'player' as const;
  readonly def: HeroDef;
  readonly motor: CharacterMotor;
  readonly cooldowns: Cooldowns;
  readonly ultimate = new UltimateMeter();
  readonly runner = new ActionRunner();
  state: PlayerState = 'locomotion';
  stateMs = 0;
  comboIndex = 0;
  private comboResetMs = 0;
  private actionDef: ActionDef | null = null;
  private skillDef: SkillDef | null = null;
  private skillSlot = -1;
  /** Combo currently in use (melee, or the ranged combo for bow heroes). */
  private comboSet: readonly ActionDef[];
  /** Hold-to-charge skills: time charged so far and whether the button is still held. */
  private chargeMs = 0;
  private charging = false;
  /** Damage multiplier of the current action from the skill tree (combo / skill / ultimate). */
  private actionMult = 1;
  readonly mods: HeroMods;
  private readonly hitSet = new Set<number>();
  private readonly strikeOpts: { -readonly [K in keyof StrikeOptions]: StrikeOptions[K] } = {
    difficultyMod: 1,
    hitSet: this.hitSet,
    damageMult: 1,
    forceCrit: false,
    counter: false,
    extraStatus: null,
  };
  private dodgeCooldownMs = 0;
  private readonly dodgeDir = { x: 0, z: 1 };
  private dodgeBack = false;
  private dodgeTravelled = 0;
  private perfectUsed = false;
  private counterUntilMs = -1;
  private counterArmed = false;
  private invulnMs = 0;
  private reactionMs = 0;
  private readonly move = { x: 0, y: 0 };
  /** Camera-relative stick input in world space (magnitude ≤ 1). */
  private moveX = 0;
  private moveZ = 0;
  private readonly disp: Displacement = { x: 0, y: 0, z: 0 };
  private wasRunning = false;
  revivesUsed = 0;
  /** Lifetime stats for the run. */
  damageTaken = 0;
  perfectDodges = 0;

  constructor(private readonly deps: PlayerDeps) {
    const hero = deps.hero;
    if (hero.visual.kind !== 'rig') throw new Error('glTF heroes arrive with the M3 assets');
    const idle = POSE_LIBRARY[hero.idlePose];
    const base = buildHumanoidClips(idle);
    const clips = [...base.clips, ...buildDodgeClips(idle)];
    const all: ActionDef[] = [...hero.combo, ...hero.skills, hero.ultimate];
    for (const a of all) {
      clips.push(
        a.clip !== undefined ? buildCustomActionClip(a.clip, a, idle) : buildActionClip(a, idle),
      );
    }
    const stats = deps.stats ?? hero.stats;
    super({
      rig: RIGS[hero.visual.rig],
      stats,
      poise: 1,
      radius: hero.body.capsuleRadius,
      halfHeight: hero.body.capsuleHalfHeight,
      physics: deps.physics,
      membership: GROUP.player,
      clips,
      additiveClips: base.additive,
      scene: deps.scene,
      knockbackResist: 0,
    });
    this.def = hero;
    this.comboSet = hero.combo;
    this.mods = deps.mods ?? emptyMods();
    const mods = this.mods;
    this.motor = new CharacterMotor(hero.movement, PHYSICS_CONFIG.gravity, stats.moveSpeed);
    this.cooldowns = new Cooldowns(
      hero.skills.map((s, i) => Math.round(s.cooldownMs * (mods.skillCooldown[i] ?? 1))),
    );
    this.anim.play('idle', { loop: true, fade: 0 });
  }

  // ------------------------------------------------------------------ queries

  /** Debug cheat: ignore all damage. */
  god = false;

  isInvulnerable(): boolean {
    if (this.god) return true;
    if (this.state === 'dead' || this.state === 'getup' || this.invulnMs > 0) return true;
    if (this.state === 'dodge') {
      const d = this.def.dodge;
      return this.stateMs >= d.iframeStartMs && this.stateMs < d.iframeEndMs;
    }
    if (this.state === 'attack' || this.state === 'skill' || this.state === 'ultimate') {
      return this.runner.isInvulnerable();
    }
    return false;
  }

  hasSuperArmor(): boolean {
    if (
      this.state === 'skill' &&
      (this.charging || this.mods.skillSuperArmor[this.skillSlot] === true)
    )
      return true;
    return (
      (this.state === 'attack' || this.state === 'skill' || this.state === 'ultimate') &&
      this.runner.hasSuperArmor()
    );
  }

  /** 0..1 while a hold-to-charge skill is charging (HUD / VFX). */
  get chargeFrac(): number {
    const max = this.skillDef?.chargeMaxMs ?? 0;
    return this.charging && max > 0 ? Math.min(1, this.chargeMs / max) : 0;
  }

  get actionId(): string | null {
    return this.actionDef?.id ?? null;
  }

  get counterReady(): boolean {
    return this.counterUntilMs > this.deps.clock();
  }

  /** Which blades leave a trail right now (startup + active phases of an action). */
  trailSide(): TrailSide {
    if (this.state !== 'attack' && this.state !== 'skill' && this.state !== 'ultimate')
      return 'none';
    const def = this.actionDef;
    if (def === null) return 'none';
    const p = this.runner.phase;
    if (p === 'active' || (p === 'startup' && this.runner.startupProgress > 0.6)) return def.trail;
    return 'none';
  }

  // ------------------------------------------------------------------ logic

  think(dtSec: number): void {
    const dtMs = dtSec * 1000;
    this.stateMs += dtMs;
    this.cooldowns.tick(dtMs);
    this.dodgeCooldownMs = Math.max(0, this.dodgeCooldownMs - dtMs);
    this.invulnMs = Math.max(0, this.invulnMs - dtMs);
    if (this.comboResetMs > 0) {
      this.comboResetMs -= dtMs;
      if (this.comboResetMs <= 0) this.comboIndex = 0;
    }
    this.readWorldMove();
    this.motor.moveSpeed = this.stats.moveSpeed;
    this.motor.speedMultiplier = this.status.speedMult();

    switch (this.state) {
      case 'locomotion':
        this.tickLocomotion(dtSec);
        break;
      case 'attack':
      case 'skill':
      case 'ultimate':
        this.tickAction(dtMs);
        break;
      case 'dodge':
        this.tickDodge();
        break;
      case 'hurt':
        this.brake(dtSec);
        if (this.stateMs >= this.reactionMs) this.enterLocomotion();
        break;
      case 'airborne':
        this.vel.x = this.vel.z = 0;
        if (this.stateMs > 120 && this.body.grounded && this.vy <= 0) this.enterKnockdown();
        break;
      case 'knockdown':
        this.vel.x = this.vel.z = 0;
        if (this.stateMs >= this.def.knockdownMs)
          this.enterState('getup', 'getup', this.def.getupMs);
        break;
      case 'getup':
        if (this.stateMs >= this.def.getupMs) this.enterLocomotion();
        break;
      case 'dead':
        this.vel.x = this.vel.z = 0;
        break;
    }
  }

  private readWorldMove(): void {
    this.deps.input.readMove(this.move);
    const b = this.deps.basis;
    this.moveX = b.forwardXZ.x * this.move.y + b.rightXZ.x * this.move.x;
    this.moveZ = b.forwardXZ.z * this.move.y + b.rightXZ.z * this.move.x;
  }

  private get moveMag(): number {
    return Math.hypot(this.moveX, this.moveZ);
  }

  private tickLocomotion(dtSec: number): void {
    if (this.tryStartFromInput(true)) return;
    this.motor.yaw = this.yaw;
    this.motor.step(this.moveX, this.moveZ, dtSec, true, this.disp);
    this.vel.x = this.motor.velocity.x;
    this.vel.z = this.motor.velocity.z;
    this.yaw = this.motor.yaw;
    const speed = this.motor.planarSpeed;
    const running = speed > (this.wasRunning ? 0.35 : 0.6);
    if (running) {
      const cadence = Math.min(1.5, 0.72 * (this.stats.moveSpeed / Math.max(speed, 0.5)));
      this.anim.play('run', {
        loop: true,
        durationSec: cadence,
        fade: this.wasRunning ? 0.12 : 0.15,
      });
    } else if (this.wasRunning || this.anim.playing !== 'idle') {
      this.anim.play('idle', { loop: true, fade: 0.2 });
    }
    this.wasRunning = running;
  }

  /**
   * Consumes buffered inputs in priority order. `allowAttack` is false inside an action whose
   * cancel window only allows dodge/skill (handled by the caller for combo chaining).
   */
  private tryStartFromInput(allowAttack: boolean): boolean {
    const input = this.deps.input;
    if (this.ultimate.isReady && input.consume('ultimate')) {
      this.startUltimate();
      return true;
    }
    for (let i = 0; i < SKILL_ACTIONS.length; i++) {
      const action = SKILL_ACTIONS[i];
      if (action !== undefined && this.cooldowns.isReady(i) && input.consume(action)) {
        this.startSkill(i);
        return true;
      }
    }
    if (this.dodgeCooldownMs <= 0 && input.consume('dodge')) {
      this.startDodge();
      return true;
    }
    if (allowAttack && input.consume('attack')) {
      const set = this.pickComboSet();
      const index = this.comboResetMs > 0 && set === this.comboSet ? this.comboIndex : 0;
      this.comboSet = set;
      this.startAttack(index);
      return true;
    }
    return false;
  }

  private brake(dtSec: number): void {
    this.motor.step(0, 0, dtSec, true, this.disp);
    this.vel.x = this.motor.velocity.x;
    this.vel.z = this.motor.velocity.z;
  }

  private beginAction(def: ActionDef, state: 'attack' | 'skill' | 'ultimate'): void {
    this.state = state;
    this.stateMs = 0;
    this.actionDef = def;
    this.runner.start(def, this.stats.attackSpeed);
    this.hitSet.clear();
    this.motor.velocity.x = this.motor.velocity.z = 0;
    this.vel.x = this.vel.z = 0;
    this.wasRunning = false;
    const counter = this.counterReady;
    this.counterArmed = counter;
    const m = this.mods;
    this.actionMult =
      state === 'attack'
        ? m.comboDamage
        : state === 'ultimate'
          ? m.ultDamage
          : (m.skillDamage[this.skillSlot] ?? 1);
    this.strikeOpts.damageMult =
      this.actionMult * (counter ? this.def.dodge.counterDamageMult + m.counterBonus : 1);
    this.strikeOpts.forceCrit = counter || this.skillDef?.forceCrit === true;
    this.strikeOpts.counter = counter;
    this.strikeOpts.extraStatus =
      state === 'skill' ? (m.skillStatus[this.skillSlot] ?? null) : null;
    if (counter) this.counterUntilMs = -1;
    this.anim.play(def.clip ?? def.id, {
      durationSec: this.runner.totalMs / 1000,
      fade: 0.05,
      restart: true,
    });
  }

  /** Bow heroes shoot when nothing is in melee range, and switch to the dagger up close. */
  private pickComboSet(): readonly ActionDef[] {
    const ranged = this.def.rangedCombo;
    if (ranged === undefined) return this.def.combo;
    const reach = this.def.meleeRange ?? 2.5;
    for (const t of this.deps.targets()) {
      if (t.alive && this.gapTo(t) <= reach) return this.def.combo;
    }
    return ranged;
  }

  startAttack(index: number): void {
    const def = this.comboSet[index];
    if (def === undefined) return;
    this.skillDef = null;
    this.skillSlot = -1;
    this.autoAim();
    this.comboIndex = index;
    this.comboResetMs = 0;
    this.beginAction(def, 'attack');
    this.deps.bus.emit('player:action', { kind: 'attack', index });
  }

  startSkill(slot: number): void {
    const def = this.def.skills[slot];
    if (def === undefined || !this.cooldowns.tryUse(slot)) return;
    this.skillDef = def;
    this.skillSlot = slot;
    this.chargeMs = 0;
    this.charging = def.special === 'charge';
    if (def.special === 'shadowStep') this.shadowStep(def);
    else this.autoAim();
    this.beginAction(def, 'skill');
    this.deps.bus.emit('player:action', { kind: 'skill', index: slot });
  }

  startUltimate(): void {
    if (!this.ultimate.tryConsume()) return;
    this.skillDef = null;
    this.skillSlot = -1;
    this.autoAim();
    this.beginAction(this.def.ultimate, 'ultimate');
    this.deps.bus.emit('ultimate:charge', { value: 0 });
    this.deps.bus.emit('player:action', { kind: 'ultimate', index: 0 });
  }

  private tickAction(dtMs: number): void {
    const def = this.actionDef;
    if (def === null) {
      this.enterLocomotion();
      return;
    }
    if (this.charging && this.tickCharge(dtMs)) return;
    const frac = this.runner.advance(dtMs, this.onRunnerHit);
    if (this.runner.sweeping) {
      const first = def.hits[0];
      if (first !== undefined) this.strike(first.spec);
    }
    // Data-driven movement along the facing.
    const dist = def.move?.distance ?? 0;
    if (frac !== 0 && dist !== 0) {
      this.actionDisp.x += Math.sin(this.yaw) * dist * frac;
      this.actionDisp.z += Math.cos(this.yaw) * dist * frac;
    }
    // Steerable skills (Blade Gyre) let the stick move the hero at reduced speed.
    if (
      this.state === 'skill' &&
      this.skillDef?.special === 'steerable' &&
      this.runner.phase === 'active'
    ) {
      const s =
        this.stats.moveSpeed * (this.skillDef.steerSpeedMult ?? 0.5) * this.status.speedMult();
      this.vel.x = this.moveX * s;
      this.vel.z = this.moveZ * s;
      if (this.moveMag > 0.1) this.yaw = Math.atan2(this.moveX, this.moveZ);
    } else {
      this.vel.x = this.vel.z = 0;
    }

    if (this.runner.canCancel()) {
      if (this.state === 'attack' && this.deps.input.consume('attack')) {
        const next = this.comboIndex + 1;
        if (next < this.comboSet.length) {
          this.startAttack(next);
          return;
        }
      }
      if (this.tryStartFromInput(false)) return;
    }
    if (this.runner.phase === 'done') {
      if (this.state === 'attack') {
        this.comboIndex = (this.comboIndex + 1) % this.comboSet.length;
        this.comboResetMs = this.def.comboResetMs;
      }
      this.enterLocomotion();
    }
  }

  /**
   * Hold-to-charge: once the wind-up reaches its pose, the action holds there while the button
   * stays down (up to chargeMaxMs). Returns true while holding (the runner does not advance).
   */
  private tickCharge(dtMs: number): boolean {
    const def = this.skillDef;
    const max = def?.chargeMaxMs ?? 0;
    const action = SKILL_ACTIONS[this.skillSlot];
    const held = action !== undefined && this.deps.input.isHeld(action);
    if (
      def === null ||
      max <= 0 ||
      this.runner.phase !== 'startup' ||
      this.runner.startupProgress < 0.6
    ) {
      return false;
    }
    if (held && this.chargeMs < max) {
      this.chargeMs = Math.min(max, this.chargeMs + dtMs);
      this.vel.x = this.vel.z = 0;
      this.anim.setPaused(true);
      return true;
    }
    // Released (or full): lock in the charge bonus and let the strike play.
    this.charging = false;
    this.anim.setPaused(false);
    const frac = Math.min(1, this.chargeMs / max);
    this.actionMult *= 1 + ((def.chargeDamageMax ?? 1) - 1) * frac;
    this.strikeOpts.damageMult = this.actionMult;
    return false;
  }

  /** Bound once so advancing the runner allocates nothing per step. */
  private readonly onRunnerHit = (index: number): void => this.fireHit(index);

  private fireHit(index: number): void {
    const def = this.actionDef;
    const hit = def?.hits[index];
    if (def === undefined || def === null || hit === undefined) return;
    if (hit.emit !== undefined) {
      this.deps.effects?.emit(this, hit.spec, hit.emit, this.strikeOpts);
      this.consumeCounter();
      return;
    }
    // Each timed hit can strike every target again (multi-hit moves); sweeps share one set.
    if (def.sweep !== true) this.hitSet.clear();
    this.strike(hit.spec);
  }

  private consumeCounter(): void {
    if (!this.counterArmed) return;
    this.counterArmed = false;
    this.strikeOpts.damageMult = this.actionMult;
    this.strikeOpts.forceCrit = this.skillDef?.forceCrit === true;
    this.strikeOpts.counter = false;
  }

  private strike(spec: ActionDef['hits'][number]['spec']): void {
    const r = this.deps.combat.strike(this, spec, this.strikeOpts);
    if (r.hits > 0) {
      this.deps.bus.emit('time:hitStop', { ms: r.maxHitStopMs });
      if (r.maxShake > 0) this.deps.bus.emit('camera:shake', { trauma: r.maxShake });
      this.consumeCounter();
    }
  }

  private autoAim(): void {
    const aim = this.def.autoAim;
    const hasStick = this.moveMag > 0.2;
    const baseYaw = hasStick ? Math.atan2(this.moveX, this.moveZ) : this.yaw;
    const halfCone = (aim.coneDeg * Math.PI) / 360;
    let best: Actor | null = null;
    let bestD = Infinity;
    for (const t of this.deps.targets()) {
      if (!t.alive) continue;
      const dx = t.currFeet.x - this.currFeet.x;
      const dz = t.currFeet.z - this.currFeet.z;
      const d = Math.hypot(dx, dz) - t.radius;
      if (d > aim.rangeM || d >= bestD) continue;
      if (Math.abs(wrapAngle(Math.atan2(dx, dz) - baseYaw)) > halfCone) continue;
      best = t;
      bestD = d;
    }
    if (best !== null) this.faceToward(best.currFeet.x, best.currFeet.z);
    else this.yaw = baseYaw;
  }

  private shadowStep(def: SkillDef): void {
    const range = def.targetRange ?? 8;
    let best: Actor | null = null;
    let bestD = Infinity;
    for (const t of this.deps.targets()) {
      if (!t.alive) continue;
      const d = this.distanceTo(t);
      if (d < range && d < bestD) {
        best = t;
        bestD = d;
      }
    }
    if (best === null) {
      // No target: blink forward (the controller still collides with walls).
      this.actionDisp.x += Math.sin(this.yaw) * 4;
      this.actionDisp.z += Math.cos(this.yaw) * 4;
      return;
    }
    const dx = best.currFeet.x - this.currFeet.x;
    const dz = best.currFeet.z - this.currFeet.z;
    const len = Math.hypot(dx, dz) || 1;
    const behind = best.radius + this.radius + 0.45;
    const destX = best.currFeet.x + (dx / len) * behind;
    const destZ = best.currFeet.z + (dz / len) * behind;
    this.actionDisp.x += destX - this.currFeet.x;
    this.actionDisp.z += destZ - this.currFeet.z;
    this.yaw = Math.atan2(-dx, -dz);
  }

  private startDodge(): void {
    const d = this.def.dodge;
    this.state = 'dodge';
    this.stateMs = 0;
    this.actionDef = null;
    this.runner.stop();
    this.perfectUsed = false;
    this.dodgeTravelled = 0;
    this.wasRunning = false;
    if (this.moveMag > 0.2) {
      const m = this.moveMag;
      this.dodgeDir.x = this.moveX / m;
      this.dodgeDir.z = this.moveZ / m;
      this.dodgeBack = false;
      this.yaw = Math.atan2(this.dodgeDir.x, this.dodgeDir.z);
    } else {
      this.dodgeDir.x = -Math.sin(this.yaw);
      this.dodgeDir.z = -Math.cos(this.yaw);
      this.dodgeBack = true;
    }
    this.motor.velocity.x = this.motor.velocity.z = 0;
    this.vel.x = this.vel.z = 0;
    this.anim.play(this.dodgeBack ? 'dodge_back' : 'dodge_roll', {
      durationSec: d.durationMs / 1000,
      fade: 0.04,
      restart: true,
    });
    this.deps.bus.emit('player:action', { kind: 'dodge', index: 0 });
  }

  private tickDodge(): void {
    const d = this.def.dodge;
    const t = Math.min(1, this.stateMs / d.durationMs);
    const eased = 1 - (1 - t) * (1 - t);
    const target = d.distance * (this.dodgeBack ? 0.7 : 1) * eased;
    const step = target - this.dodgeTravelled;
    this.dodgeTravelled = target;
    this.actionDisp.x += this.dodgeDir.x * step;
    this.actionDisp.z += this.dodgeDir.z * step;
    this.vel.x = this.vel.z = 0;
    if (t >= 1) {
      this.dodgeCooldownMs = d.cooldownMs * this.mods.dodgeCooldown;
      this.enterLocomotion();
    }
  }

  override onEvaded(): void {
    const d = this.def.dodge;
    if (this.state === 'dodge' && !this.perfectUsed && this.stateMs <= d.perfectWindowMs) {
      this.perfectUsed = true;
      this.perfectDodges++;
      this.counterUntilMs = this.deps.clock() + d.counterWindowMs;
      this.deps.bus.emit('time:slowMotion', { scale: d.slowMoScale, ms: d.slowMoMs });
      this.deps.bus.emit('player:perfectDodge', { x: this.currFeet.x, z: this.currFeet.z });
      this.deps.bus.emit('combat:evaded', { targetId: this.id, perfect: true });
    } else {
      this.deps.bus.emit('combat:evaded', { targetId: this.id, perfect: false });
    }
  }

  // ------------------------------------------------------------------ reactions

  onHit(h: HitReceived): void {
    this.damageTaken += h.amount;
    this.flashHit(0xff3020, 5);
    if (h.killed) {
      this.die();
      return;
    }
    if (this.hasSuperArmor()) return;
    this.interruptAction();
    switch (h.spec.reaction) {
      case 'flinch':
        this.anim.react('hurt', 1);
        this.enterState('hurt', null, this.def.hurtMs);
        break;
      case 'knockback':
        this.anim.react('hurt', 1.2);
        this.knockback(h.dirX, h.dirZ, h.spec.knockback);
        this.enterState('hurt', null, this.def.hurtMs + 150);
        break;
      case 'launch':
        this.knockback(h.dirX, h.dirZ, h.spec.knockback);
        this.vy = LAUNCH_VY;
        this.enterState('airborne', 'knockdown', 0);
        break;
      case 'knockdown':
        this.knockback(h.dirX, h.dirZ, h.spec.knockback);
        this.enterKnockdown();
        break;
    }
  }

  /** Pushed without damage (boss phase shockwave). */
  shove(dirX: number, dirZ: number, distance: number): void {
    if (this.state === 'dead') return;
    this.interruptAction();
    this.knockback(dirX, dirZ, distance);
    this.enterState('hurt', null, this.def.hurtMs + 200);
    this.anim.react('hurt', 1.2);
  }

  private interruptAction(): void {
    this.charging = false;
    this.anim.setPaused(false);
    this.runner.stop();
    this.actionDef = null;
    this.skillDef = null;
    this.counterArmed = false;
  }

  private enterKnockdown(): void {
    this.enterState('knockdown', 'knockdown', this.def.knockdownMs);
  }

  private enterState(state: PlayerState, clip: string | null, durationMs: number): void {
    this.state = state;
    this.stateMs = 0;
    this.reactionMs = durationMs;
    this.vel.x = this.vel.z = 0;
    this.motor.velocity.x = this.motor.velocity.z = 0;
    this.wasRunning = false;
    if (clip !== null)
      this.anim.play(clip, {
        durationSec: Math.max(0.2, durationMs / 1000),
        fade: 0.08,
        restart: true,
      });
  }

  private enterLocomotion(): void {
    this.charging = false;
    this.anim.setPaused(false);
    this.state = 'locomotion';
    this.stateMs = 0;
    this.actionDef = null;
    this.skillDef = null;
    this.skillSlot = -1;
    this.runner.stop();
    this.anim.play('idle', { loop: true, fade: 0.18 });
    this.wasRunning = false;
  }

  private die(): void {
    this.interruptAction();
    this.enterState('dead', 'death', 1200);
    this.deps.bus.emit('player:died', {});
  }

  revive(): void {
    this.health.reset(ECONOMY.reviveHpFrac);
    this.status.clear();
    this.revivesUsed++;
    this.invulnMs = ECONOMY.reviveInvulnMs;
    this.enterState('getup', 'getup', this.def.getupMs);
    this.deps.bus.emit('player:revived', {});
  }

  /** Full reset for a new run (`hpFrac` < 1 carries damage over, e.g. dungeon rooms). */
  resetForRun(x: number, z: number, yaw: number, hpFrac = 1): void {
    this.health.reset(Math.min(1, Math.max(0.05, hpFrac)), this.stats.maxHp);
    this.status.clear();
    this.cooldowns.resetAll();
    this.ultimate.reset();
    this.revivesUsed = 0;
    this.damageTaken = 0;
    this.perfectDodges = 0;
    this.counterUntilMs = -1;
    this.comboIndex = 0;
    this.comboSet = this.def.combo;
    this.comboResetMs = 0;
    this.dodgeCooldownMs = 0;
    this.invulnMs = 0;
    this.motor.reset(yaw);
    this.spawnAt(x, z, yaw);
    this.enterLocomotion();
    this.deps.bus.emit('ultimate:charge', { value: 0 });
  }
}
