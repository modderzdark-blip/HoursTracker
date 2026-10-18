import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Points,
  ShaderMaterial,
  type Scene,
  type Texture,
} from 'three';
import { mulberry32 } from '../core/random';
import { createRadialTexture } from '../render/proceduralTextures';

const VERT = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
attribute vec3 aVel;
attribute vec4 aInfo; // x = start time, y = life, z = size, w = gravity scale
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
void main() {
  float age = uTime - aInfo.x;
  float life = aInfo.y;
  if (age < 0.0 || age > life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vAlpha = 0.0;
    return;
  }
  float t = age / life;
  vec3 p = position + aVel * age + vec3(0.0, -9.0 * aInfo.w, 0.0) * age * age * 0.5;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aInfo.z * (1.0 - t * 0.6) * uPixelRatio * (12.0 / max(-mv.z, 0.5));
  vAlpha = 1.0 - t;
  vColor = aColor;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
varying float vAlpha;
varying vec3 vColor;
void main() {
  float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * 2.4 * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Impact sparks / embers / dust bursts. A ring buffer of particles animated entirely in the
 * vertex shader: one draw call for all bursts, no per-particle CPU work after emission.
 */
export class Sparks {
  readonly points: Points;
  private readonly geometry = new BufferGeometry();
  private readonly material: ShaderMaterial;
  private readonly texture: Texture;
  private readonly pos: BufferAttribute;
  private readonly vel: BufferAttribute;
  private readonly info: BufferAttribute;
  private readonly color: BufferAttribute;
  private next = 0;
  private time = 0;
  private dirty = false;
  private readonly rand = mulberry32(7);
  /** Particle budget multiplier from the quality preset (0..1). */
  density = 1;

  constructor(
    scene: Scene,
    private readonly capacity = 640,
  ) {
    this.pos = new BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    this.vel = new BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    this.info = new BufferAttribute(new Float32Array(capacity * 4).fill(-100), 4).setUsage(
      DynamicDrawUsage,
    );
    this.color = new BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', this.pos);
    this.geometry.setAttribute('aVel', this.vel);
    this.geometry.setAttribute('aInfo', this.info);
    this.geometry.setAttribute('aColor', this.color);
    this.texture = createRadialTexture(32, 1, 0.15);
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uMap: { value: this.texture } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 11;
    scene.add(this.points);
  }

  setPixelRatio(pr: number): void {
    (this.material.uniforms['uPixelRatio'] as { value: number }).value = pr;
  }

  /**
   * Emits a burst. dir (x,z) biases the spray direction (0,0 = radial); color is a hex.
   */
  burst(
    x: number,
    y: number,
    z: number,
    count: number,
    color: number,
    speed: number,
    dirX = 0,
    dirZ = 0,
    life = 0.45,
    size = 1.1,
    gravity = 1,
  ): void {
    const n = Math.max(1, Math.round(count * this.density));
    const r = ((color >> 16) & 255) / 255;
    const g = ((color >> 8) & 255) / 255;
    const b = (color & 255) / 255;
    for (let i = 0; i < n; i++) {
      const k = this.next;
      this.next = (this.next + 1) % this.capacity;
      const a = this.rand() * Math.PI * 2;
      const up = this.rand() * 0.9 + 0.2;
      const s = speed * (0.4 + this.rand() * 0.8);
      const vx = Math.cos(a) * s + dirX * speed;
      const vz = Math.sin(a) * s + dirZ * speed;
      this.pos.setXYZ(k, x, y, z);
      this.vel.setXYZ(k, vx, up * speed, vz);
      this.info.setXYZW(
        k,
        this.time,
        life * (0.6 + this.rand() * 0.6),
        size * (0.6 + this.rand() * 0.8),
        gravity,
      );
      this.color.setXYZ(k, r, g, b);
    }
    this.dirty = true;
  }

  update(dtSec: number): void {
    this.time += dtSec;
    (this.material.uniforms['uTime'] as { value: number }).value = this.time;
    if (this.dirty) {
      this.pos.needsUpdate = true;
      this.vel.needsUpdate = true;
      this.info.needsUpdate = true;
      this.color.needsUpdate = true;
      this.dirty = false;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.points.removeFromParent();
  }
}
