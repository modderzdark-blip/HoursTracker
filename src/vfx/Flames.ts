import {
  AdditiveBlending,
  Color,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';

const vertexShader = /* glsl */ `
attribute vec4 aFlame; // xyz position, w size
attribute float aSeed;
varying vec2 vUv;
varying float vSeed;
void main() {
  vUv = uv;
  vSeed = aSeed;
  // Camera-facing billboard, base anchored at the flame position.
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 p = aFlame.xyz + right * position.x * aFlame.w * 0.95 + up * (position.y + 0.5) * aFlame.w * 1.7;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
varying float vSeed;
float hash(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float t = uTime + vSeed * 17.0;
  float y = vUv.y;
  // Turbulence rising through the flame; stronger toward the tip.
  float n = vnoise(vec2(p.x * 2.5 + vSeed * 9.0, y * 3.5 - t * 3.2)) * 0.6 +
            vnoise(vec2(p.x * 5.0 - vSeed * 4.0, y * 7.0 - t * 5.5)) * 0.4;
  float sway = sin(t * 2.3 + y * 3.0) * 0.12 * y;
  float width = mix(0.7, 0.06, pow(y, 0.7)) * (0.75 + n * 0.55);
  float d = abs(p.x - sway - (n - 0.5) * 0.35 * y) / max(width, 0.02);
  float body = 1.0 - smoothstep(0.55, 1.0, d);
  body *= smoothstep(0.0, 0.08, y) * (1.0 - smoothstep(0.55 + n * 0.35, 1.0, y));
  float core = (1.0 - smoothstep(0.0, 0.5, d)) * (1.0 - smoothstep(0.1, 0.55, y));
  vec3 c = mix(uColor * vec3(1.0, 0.45, 0.2), uColor, body);
  c = mix(c, vec3(1.0, 0.92, 0.7), core * 0.85);
  float a = body * (0.65 + 0.35 * n);
  gl_FragColor = vec4(c * a * 1.6, a);
}`;

/**
 * Animated fire for braziers and torches: camera-facing quads (one draw call for every flame)
 * shaded with rising noise turbulence, a hot core and additive glow. Two crossed layers per
 * flame at different phases give it volume.
 */
export class Flames {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private time = 0;

  constructor(spots: readonly { x: number; y: number; z: number; size: number }[], color: number) {
    const geo = new InstancedBufferGeometry();
    const quad = new PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    const layers = 2;
    const n = spots.length * layers;
    const flame = new Float32Array(n * 4);
    const seed = new Float32Array(n);
    spots.forEach((s, i) => {
      for (let l = 0; l < layers; l++) {
        const k = i * layers + l;
        flame[k * 4] = s.x;
        flame[k * 4 + 1] = s.y;
        flame[k * 4 + 2] = s.z;
        flame[k * 4 + 3] = s.size * (l === 0 ? 1 : 0.75);
        seed[k] = i * 0.37 + l * 0.61;
      }
    });
    geo.setAttribute('aFlame', new InstancedBufferAttribute(flame, 4));
    geo.setAttribute('aSeed', new InstancedBufferAttribute(seed, 1));
    geo.instanceCount = n;
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { uTime: { value: 0 }, uColor: { value: new Color(color) } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.name = 'flames';
  }

  update(dtSec: number): void {
    this.time = (this.time + dtSec) % 1000;
    const u = this.material.uniforms['uTime'];
    if (u !== undefined) u.value = this.time;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
