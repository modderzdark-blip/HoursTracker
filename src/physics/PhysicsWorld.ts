import RAPIER from '@dimforge/rapier3d-compat';
import { PHYSICS_CONFIG } from '../data/config';
import { WORLD_GROUPS, WORLD_QUERY_GROUPS } from './groups';

export type Rapier = typeof RAPIER;

let rapierReady: Promise<Rapier> | null = null;

/** Initialises the Rapier WASM module once (the compat build embeds the WASM, no fetch needed). */
export function loadRapier(): Promise<Rapier> {
  rapierReady ??= RAPIER.init().then(() => RAPIER);
  return rapierReady;
}

export interface QuatLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

/**
 * Thin wrapper over a Rapier world: static level colliders, kinematic characters, fixed stepping.
 * Gameplay hit detection (M2+) uses sensor colliders / shape casts on this same world.
 */
export class PhysicsWorld {
  readonly world: RAPIER.World;

  constructor(readonly rapier: Rapier) {
    this.world = new rapier.World({ x: 0, y: PHYSICS_CONFIG.gravity, z: 0 });
  }

  addStaticCuboid(
    x: number,
    y: number,
    z: number,
    hx: number,
    hy: number,
    hz: number,
    rotation?: QuatLike,
  ): RAPIER.Collider {
    const desc = this.rapier.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(x, y, z)
      .setCollisionGroups(WORLD_GROUPS);
    if (rotation !== undefined) desc.setRotation(rotation);
    return this.world.createCollider(desc);
  }

  addStaticCylinder(
    x: number,
    y: number,
    z: number,
    halfHeight: number,
    radius: number,
  ): RAPIER.Collider {
    const desc = this.rapier.ColliderDesc.cylinder(halfHeight, radius)
      .setTranslation(x, y, z)
      .setCollisionGroups(WORLD_GROUPS);
    return this.world.createCollider(desc);
  }

  addStaticBall(x: number, y: number, z: number, radius: number): RAPIER.Collider {
    return this.world.createCollider(
      this.rapier.ColliderDesc.ball(radius)
        .setTranslation(x, y, z)
        .setCollisionGroups(WORLD_GROUPS),
    );
  }

  private rayObj: RAPIER.Ray | null = null;

  /**
   * Distance to the first level-geometry hit along a horizontal ray, or `maxDist` if clear.
   * Reuses one Ray object (no allocation per call apart from Rapier's internal result).
   */
  castWorldRay(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dz: number,
    maxDist: number,
  ): number {
    this.rayObj ??= new this.rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    const r = this.rayObj;
    r.origin.x = ox;
    r.origin.y = oy;
    r.origin.z = oz;
    r.dir.x = dx;
    r.dir.y = 0;
    r.dir.z = dz;
    const hit = this.world.castRay(r, maxDist, true, undefined, WORLD_QUERY_GROUPS);
    return hit === null ? maxDist : hit.timeOfImpact;
  }

  step(dtSec: number): void {
    this.world.timestep = dtSec;
    this.world.step();
  }

  get colliderCount(): number {
    return this.world.colliders.len();
  }

  dispose(): void {
    this.world.free();
  }
}
