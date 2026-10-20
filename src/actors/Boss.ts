import { BossBrain } from '../ai/BossBrain';
import type { BossDef } from '../data/bosses';
import type { EnemyAttackDef } from '../data/enemies';
import { Enemy, type EnemyDeps, type EnemyScale } from './Enemy';
import type { HitReceived } from './Actor';

/** A boss: an Enemy with a BossBrain, a break bar (poise), phases and enrage. */
export class Boss extends Enemy {
  readonly bossDef: BossDef;
  private readonly phasePools: EnemyAttackDef[][];

  constructor(def: BossDef, deps: EnemyDeps) {
    const brain = new BossBrain(deps.ctx, def);
    super(def, deps, brain);
    this.bossDef = def;
    this.phasePools = def.phases.map((ph) =>
      ph.attacks
        .map((id) => def.attacks.find((a) => a.id === id))
        .filter((a): a is EnemyAttackDef => a !== undefined),
    );
  }

  get bossBrain(): BossBrain {
    return this.brain as BossBrain;
  }

  phaseAttacks(phase: number): readonly EnemyAttackDef[] {
    return this.phasePools[phase] ?? this.phasePools[0] ?? [];
  }

  applyPhaseMultipliers(speed: number, damage: number, enraged: boolean): void {
    this.speedMult = speed * (enraged ? this.bossDef.enrageSpeedMult : 1);
    this.damageMult = damage * (enraged ? this.bossDef.enrageDamageMult : 1);
  }

  override activate(x: number, z: number, yaw: number, scale: EnemyScale): void {
    super.activate(x, z, yaw, scale);
    this.poise.refill(this.bossDef.breakMax * scale.poise);
    this.rig.setWeaponFx(false);
    this.rig.setGlowIntensity(2.2);
    this.bossBrain.beginIntro();
  }

  override isInvulnerable(): boolean {
    const s = this.brain.state;
    if (this.brain.attack?.special === 'fly' && this.visualLift > 1.2) return true;
    if (this.bossBrain.submerged) return true;
    return (
      s === 'intro' || s === 'transition' || s === 'dead' || s === 'inactive' || s === 'spawning'
    );
  }

  override damageTakenMult(): number {
    return this.brain.state === 'broken' ? 1 + this.bossDef.breakDamageBonus : 1;
  }

  get isBroken(): boolean {
    return this.brain.state === 'broken';
  }

  override onHit(h: HitReceived): void {
    this.flashHit(0xffffff, 8);
    if (h.killed) {
      this.die();
      return;
    }
    if (h.poiseBroken) this.bossBrain.goBroken();
    this.bossBrain.checkPhase();
  }
}
