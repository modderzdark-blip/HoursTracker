import {
  Color,
  CustomBlending,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import { mulberry32 } from '../core/random';
import type { TimeUniform } from '../render/env/propMaterials';
import {
  FOG_FADE_PARS_FRAGMENT,
  FOG_FADE_PARS_VERTEX,
  FOG_FADE_VERTEX,
  fogUniforms,
} from './fogFade';

/** How a mote moves and blends. */
export const MOTE_KINDS = {
  /** Rising, flickering sparks (additive). */
  embers: 0,
  /** Falling, tumbling grey flakes (alpha-blended). */
  ash: 1,
  /** Slowly floating glowing spores (additive). */
  spores: 2,
  /** Wandering, blinking lights near the ground (additive). */
  fireflies: 3,
  /** Sparks spiralling upward (additive). */
  arcane: 4,
} as const;

export type MoteKind = keyof typeof MOTE_KINDS;

/** A share of the motes: kind, colour and fraction of the total. */
export interface MoteLayer {
  readonly kind: MoteKind;
  readonly color: number;
  readonly share: number;
}

const vertexShader = /* glsl */ `
attribute vec4 aSeed;
attribute vec4 aMote; // rgb, kind
uniform float uTime;
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
varying float vAdd;
${FOG_FADE_PARS_VERTEX}
const float R = 15.0;
const float H = 9.0;
void main() {
  float kind = aMote.w;
  float t = uTime;
  // The field wraps around a point ahead of the camera, so motes always fill the view.
  vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  vec2 center = cameraPosition.xz + normalize(fwd.xz + vec2(1e-4)) * 9.0;
  vec2 base = (aSeed.xy * 2.0 - 1.0) * R;
  vec2 drift = vec2(0.0);
  float y = 0.0;
  float life = 0.5;
  float size = 0.06;
  float flicker = 1.0;
  vec2 c = position.xy;
  if (kind < 0.5) {
    float speed = mix(0.6, 1.5, aSeed.z);
    y = mod(aSeed.w * H + t * speed, H);
    life = y / H;
    drift = vec2(sin(t * 0.9 + aSeed.w * 30.0), cos(t * 0.7 + aSeed.z * 20.0)) * 0.6 + vec2(t * 0.25, 0.0);
    flicker = 0.55 + 0.45 * sin(t * (8.0 + aSeed.z * 9.0) + aSeed.w * 40.0);
    size = 0.045;
    c.y *= 2.2;
  } else if (kind < 1.5) {
    float speed = mix(0.35, 0.8, aSeed.z);
    y = H - mod(aSeed.w * H + t * speed, H);
    life = y / H;
    drift = vec2(sin(t * 0.6 + aSeed.w * 20.0) * 1.2 + t * 0.45, cos(t * 0.5 + aSeed.z * 10.0) * 0.8);
    float r = t * (1.5 + aSeed.z * 2.0) + aSeed.w * 30.0;
    c = mat2(cos(r), -sin(r), sin(r), cos(r)) * (c * vec2(1.0, 0.35 + 0.65 * abs(sin(t * 1.3 + aSeed.z * 20.0))));
    size = 0.075;
  } else if (kind < 2.5) {
    y = 0.4 + aSeed.w * 4.5 + sin(t * 0.4 + aSeed.z * 40.0) * 0.6;
    drift = vec2(sin(t * 0.21 + aSeed.z * 9.0), cos(t * 0.17 + aSeed.w * 7.0)) * 1.6;
    flicker = 0.7 + 0.3 * sin(t * 1.7 + aSeed.w * 23.0);
    size = 0.05;
  } else if (kind < 3.5) {
    y = 0.5 + aSeed.w * 2.4 + sin(t * 1.3 + aSeed.z * 30.0) * 0.35;
    drift = vec2(
      sin(t * 0.5 + aSeed.z * 13.0) + sin(t * 1.1 + aSeed.w * 5.0) * 0.4,
      cos(t * 0.43 + aSeed.w * 11.0) + cos(t * 0.9 + aSeed.z * 3.0) * 0.4
    ) * 1.7;
    flicker = smoothstep(0.2, 1.0, sin(t * (1.4 + aSeed.z * 1.8) + aSeed.w * 50.0));
    size = 0.065;
  } else {
    float speed = mix(0.35, 0.8, aSeed.z);
    y = mod(aSeed.w * H + t * speed, H);
    life = y / H;
    float a = t * 1.3 + aSeed.w * 40.0;
    drift = vec2(cos(a), sin(a)) * (0.3 + aSeed.z * 0.5);
    flicker = 0.6 + 0.4 * sin(t * 5.0 + aSeed.w * 17.0);
    size = 0.05;
  }
  vec2 rel = mod(base + drift - center + R, 2.0 * R) - R;
  vec3 world = vec3(center.x + rel.x, y, center.y + rel.y);
  float edge = 1.0 - smoothstep(R * 0.7, R, length(rel));
  float fade = smoothstep(0.0, 0.1, life) * (1.0 - smoothstep(0.75, 1.0, life));
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  size *= mix(0.6, 1.4, aSeed.z);
  vec4 mvPosition = viewMatrix * vec4(world + (right * c.x + up * c.y) * size, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  ${FOG_FADE_VERTEX}
  vUv = position.xy;
  vColor = aMote.rgb;
  vAlpha = edge * fade * flicker;
  vAdd = step(1.5, kind) + step(kind, 0.5);
}`;

const fragmentShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
varying float vAdd;
${FOG_FADE_PARS_FRAGMENT}
void main() {
  float d = length(vUv) * 2.0;
  float a = (1.0 - smoothstep(0.2, 1.0, d)) * vAlpha * fogFade();
  if (a < 0.004) discard;
  // Premultiplied: glowing kinds add light (alpha 0), ash covers what is behind it.
  vec3 rgb = vColor * a * mix(1.0, 2.6, vAdd);
  gl_FragColor = vec4(rgb, a * 0.85 * (1.0 - vAdd));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * Arena-wide motes — rising embers, falling ash, drifting spores, fireflies, arcane sparks —
 * as one instanced draw call animated entirely in the vertex shader (the CPU only advances the
 * shared time). The field follows the camera's view, so a fixed, pooled count always fills it.
 */
export class AmbientMotes {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  constructor(count: number, layers: readonly MoteLayer[], time: TimeUniform, seed = 7) {
    const rand = mulberry32(seed);
    const geo = new InstancedBufferGeometry();
    const quad = new PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    const seeds = new Float32Array(Math.max(1, count) * 4);
    const motes = new Float32Array(Math.max(1, count) * 4);
    const total = layers.reduce((s, l) => s + l.share, 0) || 1;
    const c = new Color();
    let li = 0;
    let acc = (layers[0]?.share ?? 1) / total;
    for (let i = 0; i < count; i++) {
      while (i / count >= acc && li < layers.length - 1) {
        li++;
        acc += (layers[li]?.share ?? 0) / total;
      }
      const layer = layers[li];
      seeds.set([rand(), rand(), rand(), rand()], i * 4);
      c.setHex(layer?.color ?? 0xffffff);
      motes.set([c.r, c.g, c.b, MOTE_KINDS[layer?.kind ?? 'embers']], i * 4);
    }
    geo.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 4));
    geo.setAttribute('aMote', new InstancedBufferAttribute(motes, 4));
    geo.instanceCount = count;
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { ...fogUniforms(), uTime: time },
      transparent: true,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      fog: true,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    this.mesh.name = 'ambient-motes';
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
