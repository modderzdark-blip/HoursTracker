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
import type { TimeUniform } from '../render/env/propMaterials';
import {
  FOG_FADE_PARS_FRAGMENT,
  FOG_FADE_PARS_VERTEX,
  FOG_FADE_VERTEX,
  fogUniforms,
} from './fogFade';

/** A smoke column (kind 0, base at y) or a fog bank (kind 1) of `w` × `h` metres. */
export interface SmokeCard {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
  readonly h: number;
  readonly kind: 0 | 1;
  readonly alpha: number;
}

const vertexShader = /* glsl */ `
attribute vec4 aCard; // x, y, z, seed
attribute vec4 aSize; // w, h, kind, alpha
uniform float uTime;
varying vec2 vUv;
varying vec3 vInfo; // seed, kind, alpha
${FOG_FADE_PARS_VERTEX}
void main() {
  vec3 base = aCard.xyz;
  // Fog banks drift slowly sideways.
  base.x += aSize.z * sin(uTime * 0.05 + aCard.w * 6.0) * 2.0;
  // Upright billboard: turns about Y to face the camera.
  vec2 toCam = normalize(cameraPosition.xz - base.xz + vec2(1e-4));
  vec3 right = vec3(-toCam.y, 0.0, toCam.x);
  vec3 world = base + right * position.x * aSize.x + vec3(0.0, (position.y + 0.5) * aSize.y, 0.0);
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  ${FOG_FADE_VERTEX}
  vUv = position.xy + 0.5;
  vInfo = vec3(aCard.w, aSize.z, aSize.w);
}`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3 uSmoke;
uniform vec3 uGlow;
uniform vec3 uFog;
varying vec2 vUv;
varying vec3 vInfo;
${FOG_FADE_PARS_FRAGMENT}
float hash(vec2 p) { p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 19.19); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  return vnoise(p) * 0.55 + vnoise(p * 2.1 + 3.1) * 0.3 + vnoise(p * 4.3 + 7.7) * 0.15;
}
void main() {
  float seed = vInfo.x;
  vec2 uv = vUv;
  float a;
  vec3 col;
  if (vInfo.y < 0.5) {
    // Smoke column: billows rise and widen; the base glows with the fire below.
    float n = fbm(vec2(uv.x * 2.5 + seed * 9.0, uv.y * 3.0 - uTime * 0.22));
    float n2 = fbm(vec2(uv.x * 5.0 - seed * 4.0, uv.y * 6.0 - uTime * 0.4));
    float width = mix(0.16, 0.48, pow(uv.y, 0.8)) * (0.8 + 0.4 * n);
    float sway = sin(uv.y * 3.0 + uTime * 0.3 + seed * 6.0) * 0.08 * uv.y;
    float body = 1.0 - smoothstep(width * 0.35, width, abs(uv.x - 0.5 - sway));
    body *= smoothstep(0.0, 0.08, uv.y) * (1.0 - smoothstep(0.55, 1.0, uv.y));
    a = body * smoothstep(0.25, 0.7, n * 0.7 + n2 * 0.3) * vInfo.z;
    float hot = 1.0 - smoothstep(0.0, 0.3, uv.y);
    col = mix(uSmoke, uGlow, hot * hot) + uGlow * hot * 0.8;
  } else {
    // Fog bank: a soft drifting band, thickest low down.
    float n = fbm(vec2(uv.x * 3.0 + uTime * 0.03 + seed * 5.0, uv.y * 2.0 - uTime * 0.01));
    float band = smoothstep(0.0, 0.25, uv.y) * (1.0 - smoothstep(0.35, 1.0, uv.y));
    band *= smoothstep(0.0, 0.25, uv.x) * (1.0 - smoothstep(0.75, 1.0, uv.x));
    a = band * smoothstep(0.3, 0.75, n) * vInfo.z;
    col = uFog;
  }
  a *= fogFade();
  if (a < 0.004) discard;
  gl_FragColor = vec4(col * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * Smoke columns rising behind the walls (fire arenas) and fog banks drifting along them: upright
 * camera-facing cards with scrolling noise, all in one instanced draw call.
 */
export class SmokeCards {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  constructor(
    cards: readonly SmokeCard[],
    colors: { readonly smoke: number; readonly glow: number; readonly fog: number },
    time: TimeUniform,
  ) {
    const geo = new InstancedBufferGeometry();
    const quad = new PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    const card = new Float32Array(Math.max(1, cards.length) * 4);
    const size = new Float32Array(Math.max(1, cards.length) * 4);
    cards.forEach((c, i) => {
      card.set([c.x, c.y, c.z, (i * 0.618 + 0.13) % 1], i * 4);
      size.set([c.w, c.h, c.kind, c.alpha], i * 4);
    });
    geo.setAttribute('aCard', new InstancedBufferAttribute(card, 4));
    geo.setAttribute('aSize', new InstancedBufferAttribute(size, 4));
    geo.instanceCount = cards.length;
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        ...fogUniforms(),
        uTime: time,
        uSmoke: { value: new Color(colors.smoke) },
        uGlow: { value: new Color(colors.glow) },
        uFog: { value: new Color(colors.fog) },
      },
      transparent: true,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      fog: true,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.name = 'smoke-cards';
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
