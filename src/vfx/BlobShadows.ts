import {
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Scene,
  type Texture,
} from 'three';
import type { Actor } from '../actors/Actor';
import { createRadialTexture } from '../render/proceduralTextures';

/**
 * Soft contact shadows ("fake AO") under every character in ONE instanced draw call. Always on:
 * grounds characters on LOW (no real shadows) and adds contact darkening on MEDIUM/HIGH.
 */
export class BlobShadows {
  private readonly mesh: InstancedMesh;
  private readonly geometry = new PlaneGeometry(2, 2);
  private readonly material: MeshBasicMaterial;
  private readonly texture: Texture;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();

  constructor(
    scene: Scene,
    private readonly capacity = 24,
  ) {
    this.texture = createRadialTexture(64, 1, 0.2, 'luminance');
    this.geometry.rotateX(-Math.PI / 2);
    this.material = new MeshBasicMaterial({
      color: 0x000000,
      alphaMap: this.texture,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }

  setStrength(opacity: number): void {
    this.material.opacity = opacity;
  }

  update(actors: readonly Actor[], count: number): void {
    let n = 0;
    for (let i = 0; i < count && n < this.capacity; i++) {
      const a = actors[i];
      if (a === undefined || !a.inWorld) continue;
      // Shrinks while the actor is in the air (boss leap); gone once a corpse sinks into the floor.
      const air = a.visualLift > 0 ? Math.max(0.45, 1 - a.visualLift * 0.15) : 1;
      const size = a.visualLift < -0.3 ? 0 : a.radius * 1.9 * air;
      this.p.set(a.renderFeet.x, a.renderFeet.y + 0.02, a.renderFeet.z);
      this.s.set(size, 1, size);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(n++, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.mesh.removeFromParent();
  }
}
