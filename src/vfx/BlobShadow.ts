import { Mesh, MeshBasicMaterial, PlaneGeometry, type Texture, type Vector3 } from 'three';
import { createRadialTexture } from '../render/proceduralTextures';

/**
 * Soft contact shadow under a character ("fake AO"). Always on: it grounds characters on LOW
 * where real shadows are off, and adds contact darkening under real shadows on MEDIUM/HIGH.
 */
export class BlobShadow {
  readonly mesh: Mesh;
  private readonly geometry: PlaneGeometry;
  private readonly material: MeshBasicMaterial;
  private readonly texture: Texture;

  constructor(radius: number) {
    this.texture = createRadialTexture(64, 1, 0.2, 'luminance');
    this.geometry = new PlaneGeometry(radius * 2, radius * 2);
    this.geometry.rotateX(-Math.PI / 2);
    this.material = new MeshBasicMaterial({
      color: 0x000000,
      alphaMap: this.texture,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.renderOrder = 1;
    this.mesh.name = 'blob-shadow';
  }

  setStrength(opacity: number): void {
    this.material.opacity = opacity;
  }

  update(feet: Vector3): void {
    this.mesh.position.set(feet.x, feet.y + 0.02, feet.z);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.mesh.removeFromParent();
  }
}
