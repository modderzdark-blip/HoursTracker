import { Enemy, type EnemyDeps, type EnemyScale } from '../actors/Enemy';
import type { CombatSystem } from '../combat/CombatSystem';
import { ENEMIES, type EnemyId } from '../data/enemies';

/**
 * Pooled enemies. Instances (rig, materials, physics body, clips) are created up front per type
 * and recycled: no allocation of characters during combat.
 */
export class EnemyRoster {
  private readonly pools = new Map<EnemyId, Enemy[]>();
  /** Active enemies (contiguous; order changes on release). */
  readonly active: Enemy[] = [];

  constructor(
    private readonly deps: EnemyDeps,
    private readonly combat: CombatSystem,
  ) {}

  prewarm(id: EnemyId, count: number): void {
    const pool = this.pool(id);
    while (pool.length < count) pool.push(this.create(id));
  }

  private pool(id: EnemyId): Enemy[] {
    let p = this.pools.get(id);
    if (p === undefined) {
      p = [];
      this.pools.set(id, p);
    }
    return p;
  }

  private create(id: EnemyId): Enemy {
    const e = new Enemy(ENEMIES[id], this.deps);
    this.combat.register(e);
    return e;
  }

  spawn(id: EnemyId, x: number, z: number, yaw: number, scale: EnemyScale): Enemy {
    const pool = this.pool(id);
    let e = pool.find((c) => !c.inWorld);
    if (e === undefined) {
      e = this.create(id);
      pool.push(e);
      console.warn(`[roster] pool for ${id} grew to ${pool.length}`);
    }
    e.activate(x, z, yaw, scale);
    this.active.push(e);
    return e;
  }

  /** Living enemies (dying ones excluded). */
  aliveCount(): number {
    let n = 0;
    for (const e of this.active) if (!e.health.dead) n++;
    return n;
  }

  /** Returns finished corpses to the pool. */
  collectDead(): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      if (e !== undefined && e.readyForRelease) {
        e.brain.reset();
        e.removeFromWorld();
        const last = this.active.pop();
        if (last !== undefined && i < this.active.length) this.active[i] = last;
      }
    }
  }

  clear(): void {
    for (const e of this.active) {
      e.brain.reset();
      e.removeFromWorld();
    }
    this.active.length = 0;
  }

  get pooledCount(): number {
    let n = 0;
    for (const p of this.pools.values()) n += p.length;
    return n;
  }

  dispose(): void {
    for (const p of this.pools.values()) {
      for (const e of p) {
        this.combat.unregister(e);
        e.dispose();
      }
    }
    this.pools.clear();
    this.active.length = 0;
  }
}
