import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  ShaderMaterial,
  Vector3,
  type Scene,
} from 'three';
import type { CharacterRig } from '../anim/characterTypes';
import type { SocketName } from '../anim/HumanoidRig';

const SEGMENTS = 14;

const VERT = /* glsl */ `
attribute float aAlpha;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(uColor * vAlpha, vAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** One ribbon following a blade's base→tip line, sampled from the animated skeleton each frame. */
class Trail {
  readonly mesh: Mesh;
  private readonly geometry = new BufferGeometry();
  private readonly positions: Float32Array;
  private readonly alphas: Float32Array;
  private readonly posAttr: BufferAttribute;
  private readonly alphaAttr: BufferAttribute;
  readonly material: ShaderMaterial;
  private filled = 0;
  private fade = 0;
  rig: CharacterRig | null = null;
  base: SocketName = 'rightBase';
  tip: SocketName = 'rightTip';
  emitting: () => boolean = () => false;
  private readonly a = new Vector3();
  private readonly b = new Vector3();

  constructor(scene: Scene) {
    this.positions = new Float32Array(SEGMENTS * 2 * 3);
    this.alphas = new Float32Array(SEGMENTS * 2);
    this.posAttr = new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage);
    this.alphaAttr = new BufferAttribute(this.alphas, 1).setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('aAlpha', this.alphaAttr);
    const idx: number[] = [];
    for (let i = 0; i < SEGMENTS - 1; i++) {
      const v = i * 2;
      idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
    this.geometry.setIndex(idx);
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uColor: { value: new Color(1, 1, 1) } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 9;
    scene.add(this.mesh);
  }

  get busy(): boolean {
    return this.rig !== null;
  }

  update(dtSec: number): void {
    const rig = this.rig;
    if (rig === null) return;
    const on = this.emitting() && rig.root.visible;
    if (on) {
      this.fade = 1;
      rig.socketWorld(this.base, this.a);
      rig.socketWorld(this.tip, this.b);
      // Shift older samples back by one and write the newest at the front.
      this.positions.copyWithin(6, 0, (SEGMENTS - 1) * 6);
      this.positions[0] = this.a.x;
      this.positions[1] = this.a.y;
      this.positions[2] = this.a.z;
      this.positions[3] = this.b.x;
      this.positions[4] = this.b.y;
      this.positions[5] = this.b.z;
      if (this.filled < SEGMENTS) {
        // Fill untouched samples with the newest one so the ribbon starts collapsed.
        for (let i = this.filled; i < SEGMENTS; i++) this.positions.copyWithin(i * 6, 0, 6);
        this.filled = SEGMENTS;
      }
    } else {
      this.fade = Math.max(0, this.fade - dtSec * 5);
      if (this.fade === 0) {
        this.filled = 0;
        this.mesh.visible = false;
        return;
      }
    }
    for (let i = 0; i < SEGMENTS; i++) {
      const k = (1 - i / (SEGMENTS - 1)) * this.fade * 0.85;
      this.alphas[i * 2] = k * 0.35;
      this.alphas[i * 2 + 1] = k;
    }
    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.mesh.visible = true;
  }

  release(): void {
    this.rig = null;
    this.emitting = () => false;
    this.fade = 0;
    this.filled = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}

/** Pool of weapon trails. Owners attach for their lifetime; trails emit while `emitting()`. */
export class WeaponTrails {
  private readonly trails: Trail[] = [];

  constructor(scene: Scene, poolSize = 10) {
    for (let i = 0; i < poolSize; i++) this.trails.push(new Trail(scene));
  }

  attach(
    rig: CharacterRig,
    side: 'right' | 'left',
    color: number,
    emitting: () => boolean,
  ): boolean {
    const t = this.trails.find((x) => !x.busy);
    if (t === undefined) return false;
    t.rig = rig;
    t.base = side === 'right' ? 'rightBase' : 'leftBase';
    t.tip = side === 'right' ? 'rightTip' : 'leftTip';
    t.emitting = emitting;
    (t.material.uniforms['uColor'] as { value: Color }).value.setHex(color);
    return true;
  }

  detach(rig: CharacterRig): void {
    for (const t of this.trails) if (t.rig === rig) t.release();
  }

  update(dtSec: number): void {
    for (const t of this.trails) t.update(dtSec);
  }

  get visibleCount(): number {
    let n = 0;
    for (const t of this.trails) if (t.mesh.visible) n++;
    return n;
  }

  dispose(): void {
    for (const t of this.trails) t.dispose();
  }
}
