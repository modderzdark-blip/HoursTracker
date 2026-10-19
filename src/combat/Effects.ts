import {
  BoxGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';
import type { Actor } from '../actors/Actor';
import type { EventBus } from '../core/EventBus';
import type { GameEvents, TeamName } from '../core/events';
import type { EmitDef, HitSpec, ProjectileDef, ZoneDef } from '../data/combatTypes';
import type { StatusId } from '../data/statusEffects';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { CombatSystem } from './CombatSystem';

/** Damage options captured when an effect is emitted (the owner may act differently later). */
export interface EmitOptions {
  readonly damageMult?: number;
  readonly forceCrit?: boolean;
  readonly counter?: boolean;
  readonly difficultyMod: number;
  readonly extraStatus?: { readonly status: StatusId; readonly chance: number } | null;
}

/** Visual hooks (sparks, ground decals, rings); BattleMode implements them with its VFX. */
export interface EffectVisuals {
  /** Ground telegraph; returns a handle (or -1). */
  showZone(x: number, z: number, radius: number, enemy: boolean): number;
  updateZone(handle: number, progress: number, x: number, z: number): void;
  hideZone(handle: number): void;
  /** Blast feedback for a zone tick / projectile explosion. */
  blast(
    kind: ZoneDef['visual'] | 'explosion' | 'impact',
    x: number,
    z: number,
    radius: number,
    enemy: boolean,
  ): void;
}

const MAX_PROJECTILES = 48;
const MAX_ZONES = 24;
const MAX_HITS = 12;
const PROJECTILE_VISUALS = ['arrow', 'bolt', 'fireball', 'shadow'] as const;

interface Projectile {
  active: boolean;
  owner: Actor | null;
  team: TeamName;
  def: ProjectileDef;
  spec: HitSpec;
  x: number;
  y: number;
  z: number;
  dirX: number;
  dirZ: number;
  travelled: number;
  readonly hits: number[];
  hitCount: number;
  damageMult: number;
  forceCrit: boolean;
  counter: boolean;
  difficultyMod: number;
  extraStatus: { readonly status: StatusId; readonly chance: number } | null;
}

interface Zone {
  active: boolean;
  owner: Actor | null;
  team: TeamName;
  def: ZoneDef;
  spec: HitSpec;
  x: number;
  z: number;
  ageMs: number;
  /** Time of the next tick (ms from spawn); traps start disarmed. */
  nextTickMs: number;
  ticksLeft: number;
  triggered: boolean;
  decal: number;
  damageMult: number;
  forceCrit: boolean;
  difficultyMod: number;
  extraStatus: { readonly status: StatusId; readonly chance: number } | null;
}

const NO_DEF_P: ProjectileDef = {
  visual: 'arrow',
  speed: 0,
  radius: 0,
  rangeM: 0,
  pierce: false,
  homing: 0,
  height: 1,
};
const NO_DEF_Z: ZoneDef = { visual: 'fire', radius: 0, delayMs: 0, ticks: 0, intervalMs: 0 };
const NO_SPEC: HitSpec = {
  damage: 0,
  poise: 0,
  reaction: 'flinch',
  knockback: 0,
  hitStopMs: 0,
  shake: 0,
  shape: { kind: 'circle', radius: 0, forward: 0 },
};

/**
 * Projectiles (arrows, bolts, fireballs, homing shades) and ground zones (rain, traps,
 * shockwaves, meteors, eruptions). Pooled; every hit goes through CombatSystem.applyHit, so
 * damage formula, i-frames, poise, status, numbers and ultimate charge all apply unchanged.
 * Projectiles render as one instanced mesh per look.
 */
export class Effects {
  private readonly projectiles: Projectile[] = [];
  private readonly zones: Zone[] = [];
  private readonly meshes = new Map<ProjectileDef['visual'], InstancedMesh>();
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: MeshBasicMaterial[] = [];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly pos = new Vector3();
  private readonly scl = new Vector3(1, 1, 1);
  private readonly fwd = new Vector3();
  private readonly tmpPoint = { x: 0, z: 0 };

  constructor(
    scene: Scene,
    private readonly combat: CombatSystem,
    private readonly physics: PhysicsWorld,
    private readonly bus: EventBus<GameEvents>,
    private readonly visuals: EffectVisuals,
    /** Living actors a team can hit. */
    private readonly opponents: (team: TeamName) => readonly Actor[],
    private readonly rng: () => number,
  ) {
    for (let i = 0; i < MAX_PROJECTILES; i++) {
      this.projectiles.push({
        active: false,
        owner: null,
        team: 'player',
        def: NO_DEF_P,
        spec: NO_SPEC,
        x: 0,
        y: 0,
        z: 0,
        dirX: 0,
        dirZ: 1,
        travelled: 0,
        hits: new Array<number>(MAX_HITS).fill(0),
        hitCount: 0,
        damageMult: 1,
        forceCrit: false,
        counter: false,
        difficultyMod: 1,
        extraStatus: null,
      });
    }
    for (let i = 0; i < MAX_ZONES; i++) {
      this.zones.push({
        active: false,
        owner: null,
        team: 'player',
        def: NO_DEF_Z,
        spec: NO_SPEC,
        x: 0,
        z: 0,
        ageMs: 0,
        nextTickMs: 0,
        ticksLeft: 0,
        triggered: false,
        decal: -1,
        damageMult: 1,
        forceCrit: false,
        difficultyMod: 1,
        extraStatus: null,
      });
    }
    const looks: Record<ProjectileDef['visual'], { geo: BufferGeometry; color: number }> = {
      arrow: { geo: new BoxGeometry(0.06, 0.06, 0.8), color: 0xf0dcc0 },
      bolt: { geo: new SphereGeometry(0.22, 10, 8), color: 0xb070ff },
      fireball: { geo: new SphereGeometry(0.42, 12, 10), color: 0xff7a2a },
      shadow: { geo: new BoxGeometry(0.08, 0.08, 0.9), color: 0xa080ff },
    };
    for (const v of PROJECTILE_VISUALS) {
      const look = looks[v];
      const mat = new MeshBasicMaterial({ color: look.color, toneMapped: false });
      const mesh = new InstancedMesh(look.geo, mat, MAX_PROJECTILES);
      mesh.count = 0;
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.meshes.set(v, mesh);
      this.geometries.push(look.geo);
      this.materials.push(mat);
    }
  }

  // ------------------------------------------------------------------ emitting

  /**
   * Releases what `emit` describes from `owner`. `lockTarget` (enemy telegraph target) is used
   * for 'target' placement; without it the nearest opponent in front is used.
   */
  emit(
    owner: Actor,
    spec: HitSpec,
    emit: EmitDef,
    opts: EmitOptions,
    lockTarget: { readonly x: number; readonly z: number } | null = null,
  ): void {
    if (emit.kind === 'projectile') {
      let yaw = owner.yaw;
      if (emit.aim === 'target') {
        const t = this.nearestOpponent(owner, emit.projectile.rangeM, 120);
        if (t !== null)
          yaw = Math.atan2(t.currFeet.x - owner.currFeet.x, t.currFeet.z - owner.currFeet.z);
        else if (lockTarget !== null)
          yaw = Math.atan2(lockTarget.x - owner.currFeet.x, lockTarget.z - owner.currFeet.z);
      }
      const n = Math.max(1, emit.count);
      const spread = (emit.spreadDeg * Math.PI) / 180;
      for (let i = 0; i < n; i++) {
        const a = n === 1 ? yaw : yaw - spread / 2 + (spread * i) / (n - 1);
        this.spawnProjectile(owner, spec, emit.projectile, a, opts);
      }
      return;
    }
    const p = this.placement(owner, emit.place, emit.forward, lockTarget);
    const n = Math.max(1, emit.count);
    for (let i = 0; i < n; i++) {
      let x = p.x;
      let z = p.z;
      if (emit.scatter > 0 && (n > 1 || i > 0)) {
        const a = this.rng() * Math.PI * 2;
        const r = Math.sqrt(this.rng()) * emit.scatter;
        x += Math.cos(a) * r;
        z += Math.sin(a) * r;
      }
      this.spawnZone(owner, spec, emit.zone, x, z, opts);
    }
  }

  private placement(
    owner: Actor,
    place: 'self' | 'forward' | 'target',
    forward: number,
    lock: { readonly x: number; readonly z: number } | null,
  ): { x: number; z: number } {
    const o = this.tmpPoint;
    if (place === 'target') {
      if (lock !== null) {
        o.x = lock.x;
        o.z = lock.z;
        return o;
      }
      const t = this.nearestOpponent(owner, 14, 150);
      if (t !== null) {
        o.x = t.currFeet.x;
        o.z = t.currFeet.z;
        return o;
      }
    }
    const f = place === 'self' ? 0 : forward;
    o.x = owner.currFeet.x + Math.sin(owner.yaw) * f;
    o.z = owner.currFeet.z + Math.cos(owner.yaw) * f;
    return o;
  }

  /** Nearest living opponent within range and a cone around the owner's facing. */
  nearestOpponent(owner: Actor, rangeM: number, coneDeg: number): Actor | null {
    const half = (coneDeg * Math.PI) / 360;
    let best: Actor | null = null;
    let bestD = Infinity;
    for (const t of this.opponents(owner.team)) {
      if (!t.alive) continue;
      const dx = t.currFeet.x - owner.currFeet.x;
      const dz = t.currFeet.z - owner.currFeet.z;
      const d = Math.hypot(dx, dz);
      if (d > rangeM || d >= bestD) continue;
      let diff = Math.atan2(dx, dz) - owner.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (Math.abs(diff) > half) continue;
      best = t;
      bestD = d;
    }
    return best;
  }

  private spawnProjectile(
    owner: Actor,
    spec: HitSpec,
    def: ProjectileDef,
    yaw: number,
    opts: EmitOptions,
  ): void {
    const p = this.projectiles.find((x) => !x.active);
    if (p === undefined) return;
    p.active = true;
    p.owner = owner;
    p.team = owner.team;
    p.def = def;
    p.spec = spec;
    p.dirX = Math.sin(yaw);
    p.dirZ = Math.cos(yaw);
    p.x = owner.currFeet.x + p.dirX * (owner.radius + 0.3);
    p.y = owner.currFeet.y + def.height;
    p.z = owner.currFeet.z + p.dirZ * (owner.radius + 0.3);
    p.travelled = 0;
    p.hitCount = 0;
    p.damageMult = opts.damageMult ?? 1;
    p.forceCrit = opts.forceCrit === true;
    p.counter = opts.counter === true;
    p.difficultyMod = opts.difficultyMod;
    p.extraStatus = opts.extraStatus ?? null;
  }

  private spawnZone(
    owner: Actor,
    spec: HitSpec,
    def: ZoneDef,
    x: number,
    z: number,
    opts: EmitOptions,
  ): void {
    const zn = this.zones.find((v) => !v.active);
    if (zn === undefined) return;
    zn.active = true;
    zn.owner = owner;
    zn.team = owner.team;
    zn.def = def;
    zn.spec = spec;
    zn.x = x;
    zn.z = z;
    zn.ageMs = 0;
    zn.nextTickMs = def.delayMs;
    zn.ticksLeft = def.ticks;
    zn.triggered = def.trigger !== 'proximity';
    zn.damageMult = opts.damageMult ?? 1;
    zn.forceCrit = opts.forceCrit === true;
    zn.difficultyMod = opts.difficultyMod;
    zn.extraStatus = opts.extraStatus ?? null;
    zn.decal =
      def.delayMs > 0 || def.trigger === 'proximity' || def.ticks > 1
        ? this.visuals.showZone(x, z, def.radius, owner.team === 'enemy')
        : -1;
    if (def.delayMs <= 0 && zn.triggered) this.tickZone(zn);
  }

  // ------------------------------------------------------------------ simulation

  update(dtSec: number): void {
    const dtMs = dtSec * 1000;
    for (const p of this.projectiles) if (p.active) this.stepProjectile(p, dtSec);
    for (const z of this.zones) {
      if (!z.active) continue;
      z.ageMs += dtMs;
      const d = z.def;
      if (!z.triggered) {
        // Trap: armed after a short delay; fires when an opponent steps in.
        if (z.ageMs >= d.delayMs && this.anyOpponentIn(z)) {
          z.triggered = true;
          z.nextTickMs = z.ageMs;
        } else if (z.ageMs >= (d.lifeMs ?? 8000)) {
          this.endZone(z);
          continue;
        }
        if (z.decal >= 0)
          this.visuals.updateZone(z.decal, 0.25 + 0.15 * Math.sin(z.ageMs / 160), z.x, z.z);
        continue;
      }
      if (z.decal >= 0) {
        const prog = d.delayMs > 0 ? Math.min(1, z.ageMs / d.delayMs) : 1;
        this.visuals.updateZone(z.decal, prog, z.x, z.z);
      }
      while (z.active && z.ticksLeft > 0 && z.ageMs >= z.nextTickMs) {
        this.tickZone(z);
        z.nextTickMs += Math.max(16, d.intervalMs);
      }
    }
  }

  /** Traps only spring on opponents that can be hit (not spawning / dodging). */
  private anyOpponentIn(z: Zone): boolean {
    for (const t of this.opponents(z.team)) {
      if (!t.alive || t.isInvulnerable()) continue;
      if (Math.hypot(t.currFeet.x - z.x, t.currFeet.z - z.z) <= z.def.radius + t.radius)
        return true;
    }
    return false;
  }

  private tickZone(z: Zone): void {
    z.ticksLeft--;
    this.visuals.blast(z.def.visual, z.x, z.z, z.def.radius, z.team === 'enemy');
    this.blastAt(z.owner, z.team, z.spec, z.x, z.z, z.def.radius, z);
    if (z.ticksLeft <= 0) this.endZone(z);
  }

  private endZone(z: Zone): void {
    z.active = false;
    z.owner = null;
    if (z.decal >= 0) this.visuals.hideZone(z.decal);
    z.decal = -1;
  }

  /** Hits every opponent of `team` within `radius` of (x, z). */
  private blastAt(
    owner: Actor | null,
    team: TeamName,
    spec: HitSpec,
    x: number,
    z: number,
    radius: number,
    opts: {
      damageMult: number;
      forceCrit: boolean;
      difficultyMod: number;
      extraStatus: { readonly status: StatusId; readonly chance: number } | null;
    },
  ): void {
    if (owner === null) return;
    let hits = 0;
    for (const t of this.opponents(team)) {
      if (!t.alive) continue;
      const dx = t.currFeet.x - x;
      const dz = t.currFeet.z - z;
      const d = Math.hypot(dx, dz);
      if (d > radius + t.radius) continue;
      const len = d > 1e-3 ? d : 1;
      const dirX = d > 1e-3 ? dx / len : Math.sin(owner.yaw);
      const dirZ = d > 1e-3 ? dz / len : Math.cos(owner.yaw);
      if (
        this.combat.applyHit(owner, t, spec, dirX, dirZ, {
          damageMult: opts.damageMult,
          forceCrit: opts.forceCrit,
          difficultyMod: opts.difficultyMod,
          extraStatus: opts.extraStatus,
        })
      )
        hits++;
    }
    if (hits > 0) {
      if (spec.hitStopMs > 0) this.bus.emit('time:hitStop', { ms: Math.min(60, spec.hitStopMs) });
      if (spec.shake > 0) this.bus.emit('camera:shake', { trauma: spec.shake });
    }
  }

  private stepProjectile(p: Projectile, dtSec: number): void {
    const def = p.def;
    if (def.homing > 0 && p.owner !== null) {
      let best: Actor | null = null;
      let bestD = Infinity;
      for (const t of this.opponents(p.team)) {
        if (!t.alive || this.alreadyHit(p, t.id)) continue;
        const d = Math.hypot(t.currFeet.x - p.x, t.currFeet.z - p.z);
        if (d < bestD && d < 18) {
          bestD = d;
          best = t;
        }
      }
      if (best !== null) {
        const want = Math.atan2(best.currFeet.x - p.x, best.currFeet.z - p.z);
        const cur = Math.atan2(p.dirX, p.dirZ);
        let diff = want - cur;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        const turn = Math.max(-def.homing * dtSec, Math.min(def.homing * dtSec, diff));
        p.dirX = Math.sin(cur + turn);
        p.dirZ = Math.cos(cur + turn);
      }
    }
    const step = def.speed * dtSec;
    // World geometry stops projectiles (walls, pillars).
    const wall = this.physics.castWorldRay(p.x, p.y, p.z, p.dirX, p.dirZ, step + def.radius);
    const moved = Math.min(step, Math.max(0, wall - def.radius));
    p.x += p.dirX * moved;
    p.z += p.dirZ * moved;
    p.travelled += moved;
    for (const t of this.opponents(p.team)) {
      if (!t.alive || this.alreadyHit(p, t.id)) continue;
      const dy = p.y - (t.currFeet.y + t.halfHeight + t.radius);
      if (Math.abs(dy) > t.halfHeight + t.radius + def.radius + 0.6) continue;
      if (Math.hypot(t.currFeet.x - p.x, t.currFeet.z - p.z) > def.radius + t.radius) continue;
      if (p.hitCount < MAX_HITS) p.hits[p.hitCount++] = t.id;
      if (def.explodeRadius !== undefined) {
        this.explode(p);
        return;
      }
      if (p.owner !== null) {
        const ok = this.combat.applyHit(p.owner, t, p.spec, p.dirX, p.dirZ, {
          damageMult: p.damageMult,
          forceCrit: p.forceCrit,
          counter: p.counter,
          difficultyMod: p.difficultyMod,
          extraStatus: p.extraStatus,
        });
        if (ok) {
          this.visuals.blast('impact', p.x, p.z, 0.4, p.team === 'enemy');
          if (p.team === 'player' && p.spec.hitStopMs > 0)
            this.bus.emit('time:hitStop', { ms: Math.min(45, p.spec.hitStopMs) });
          if (p.spec.shake > 0) this.bus.emit('camera:shake', { trauma: p.spec.shake });
        }
      }
      if (!def.pierce) {
        p.active = false;
        p.owner = null;
        return;
      }
    }
    if (moved < step - 1e-4 || p.travelled >= def.rangeM) {
      if (def.explodeRadius !== undefined) this.explode(p);
      else {
        if (moved < step - 1e-4) this.visuals.blast('impact', p.x, p.z, 0.3, p.team === 'enemy');
        p.active = false;
        p.owner = null;
      }
    }
  }

  private explode(p: Projectile): void {
    const r = p.def.explodeRadius ?? 1;
    this.visuals.blast('explosion', p.x, p.z, r, p.team === 'enemy');
    this.blastAt(p.owner, p.team, p.spec, p.x, p.z, r, p);
    p.active = false;
    p.owner = null;
  }

  private alreadyHit(p: Projectile, id: number): boolean {
    for (let i = 0; i < p.hitCount; i++) if (p.hits[i] === id) return true;
    return false;
  }

  // ------------------------------------------------------------------ render / lifecycle

  render(): void {
    for (const v of PROJECTILE_VISUALS) {
      const mesh = this.meshes.get(v);
      if (mesh === undefined) continue;
      let n = 0;
      for (const p of this.projectiles) {
        if (!p.active || p.def.visual !== v) continue;
        this.pos.set(p.x, p.y, p.z);
        this.fwd.set(p.dirX, 0, p.dirZ);
        this.q.setFromUnitVectors(FORWARD, this.fwd);
        this.m.compose(this.pos, this.q, this.scl);
        mesh.setMatrixAt(n++, this.m);
      }
      mesh.count = n;
      mesh.visible = n > 0;
      if (n > 0) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  get activeProjectiles(): number {
    let n = 0;
    for (const p of this.projectiles) if (p.active) n++;
    return n;
  }

  get activeZones(): number {
    let n = 0;
    for (const z of this.zones) if (z.active) n++;
    return n;
  }

  clear(): void {
    for (const p of this.projectiles) {
      p.active = false;
      p.owner = null;
    }
    for (const z of this.zones) if (z.active) this.endZone(z);
    for (const mesh of this.meshes.values()) {
      mesh.count = 0;
      mesh.visible = false;
    }
  }

  /** Make every projectile mesh visible once (shader warm-up). */
  forEachMesh(fn: (mesh: InstancedMesh) => void): void {
    for (const mesh of this.meshes.values()) fn(mesh);
  }

  dispose(): void {
    this.clear();
    for (const mesh of this.meshes.values()) {
      mesh.removeFromParent();
      mesh.dispose();
    }
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

const FORWARD = new Vector3(0, 0, 1);
