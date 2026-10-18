import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  Vector3,
  type Texture,
} from 'three';
import { mulberry32 } from '../core/random';
import { createRadialTexture } from '../render/proceduralTextures';

const VERTEX = /* glsl */ `
uniform float uTime;
uniform float uSize;
uniform float uHeight;
uniform float uRadius;
uniform float uPixelRatio;
uniform vec3 uCenter;
attribute vec4 aSeed;
varying float vAlpha;
varying float vKind;

void main() {
  float kind = step(0.62, aSeed.w);
  float speed = mix(0.12, 0.55, aSeed.z) * mix(0.35, 1.0, kind);
  float y = mod(aSeed.w * uHeight * 7.0 + uTime * speed, uHeight);
  // Wrap the field around the focus point so it always surrounds the player.
  vec2 rel = mod(position.xz - uCenter.xz + uRadius, 2.0 * uRadius) - uRadius;
  vec3 world = vec3(
    uCenter.x + rel.x + sin(uTime * 0.7 + aSeed.w * 20.0) * 0.4,
    y,
    uCenter.z + rel.y + cos(uTime * 0.5 + aSeed.z * 13.0) * 0.4
  );
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  float life = y / uHeight;
  float edge = 1.0 - smoothstep(uRadius * 0.7, uRadius, length(rel));
  vAlpha = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.65, 1.0, life)) * edge;
  vKind = kind;
  float flicker = 0.75 + 0.25 * sin(uTime * (6.0 + aSeed.z * 9.0) + aSeed.w * 40.0);
  gl_PointSize = uSize * mix(0.6, 1.4, aSeed.z) * mix(1.0, 1.5, kind) * mix(1.0, flicker, kind)
    * uPixelRatio * (10.0 / max(-mv.z, 0.5));
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uEmber;
uniform vec3 uDust;
varying float vAlpha;
varying float vKind;

void main() {
  float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
  if (a < 0.01) discard;
  vec3 color = mix(uDust * 0.35, uEmber * 2.6, vKind);
  gl_FragColor = vec4(color * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Drifting embers (bright, bloom-catching) and dust motes as one GPU-animated Points draw call.
 * All motion happens in the vertex shader, so the CPU cost per frame is two uniform writes.
 * Particle count follows the quality preset via the draw range (no reallocation).
 */
export class EmberField {
  readonly points: Points;
  private readonly geometry: BufferGeometry;
  private readonly material: ShaderMaterial;
  private readonly texture: Texture;
  private time = 0;

  constructor(
    readonly maxCount: number,
    emberColor: number,
    radius = 14,
    height = 7,
  ) {
    const rand = mulberry32(99);
    const positions = new Float32Array(maxCount * 3);
    const seeds = new Float32Array(maxCount * 4);
    for (let i = 0; i < maxCount; i++) {
      positions[i * 3] = (rand() * 2 - 1) * radius;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = (rand() * 2 - 1) * radius;
      seeds[i * 4] = rand();
      seeds[i * 4 + 1] = rand();
      seeds[i * 4 + 2] = rand();
      seeds[i * 4 + 3] = rand();
    }
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(positions, 3));
    this.geometry.setAttribute('aSeed', new BufferAttribute(seeds, 4));
    this.texture = createRadialTexture(32, 1, 0.1);
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: 0.9 },
        uHeight: { value: height },
        uRadius: { value: radius },
        uPixelRatio: { value: 1 },
        uCenter: { value: new Vector3() },
        uMap: { value: this.texture },
        uEmber: { value: new Color(emberColor) },
        uDust: { value: new Color(0xc8b8a8) },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.setCount(maxCount);
  }

  setCount(count: number): void {
    this.geometry.setDrawRange(0, Math.min(Math.max(0, Math.floor(count)), this.maxCount));
  }

  get activeCount(): number {
    return this.geometry.drawRange.count;
  }

  setPixelRatio(pr: number): void {
    (this.material.uniforms['uPixelRatio'] as { value: number }).value = pr;
  }

  update(dtSec: number, focus: Vector3): void {
    // Wrap time to keep float precision in the shader over long sessions.
    this.time = (this.time + dtSec) % 3600;
    (this.material.uniforms['uTime'] as { value: number }).value = this.time;
    (this.material.uniforms['uCenter'] as { value: Vector3 }).value.copy(focus);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.points.removeFromParent();
  }
}
