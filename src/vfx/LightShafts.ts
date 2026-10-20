import {
  AdditiveBlending,
  BufferAttribute,
  Color,
  CylinderGeometry,
  DoubleSide,
  Mesh,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const vertexShader = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
varying float vH;
varying float vSeed;
attribute float seed;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vH = uv.y;
  vSeed = seed;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform float uStrength;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vH;
varying float vSeed;
float hash(vec2 p) { p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 19.19); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec3 toCam = cameraPosition - vWorld;
  vec3 v = normalize(toCam);
  // Beams right in front of the lens would wash out the fight: fade them near the camera.
  float near = smoothstep(3.5, 9.0, length(toCam));
  // Soft edges: brightest where the beam faces the camera, fading at its silhouette.
  float facing = abs(dot(normalize(vNormal), v));
  float body = pow(facing, 2.2);
  // Fade in above the floor, fade out high up; strongest in the lower third (dust catches light).
  float h = smoothstep(0.0, 0.035, vH) * (1.0 - smoothstep(0.45, 1.0, vH));
  // Slow drifting dust and streaks along the beam.
  float t = uTime + vSeed * 13.0;
  float dust = vnoise(vec2(vWorld.x * 1.3 + vWorld.z * 0.7, vWorld.y * 0.9 - t * 0.25)) * 0.6 +
               vnoise(vec2(vWorld.x * 3.1 - vWorld.z * 2.3, vWorld.y * 2.2 + t * 0.4)) * 0.4;
  float pulse = 0.75 + 0.25 * sin(uTime * 0.35 + vSeed * 6.28);
  float a = body * h * (0.55 + 0.75 * dust) * pulse * near * uStrength;
  gl_FragColor = vec4(uColor * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * Moonlight shafts: tall soft beams slanting down from the sky along the moon direction, with
 * dust drifting through them. All beams are one merged mesh (one draw call), additive and not
 * writing depth.
 */
export class LightShafts {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private time = 0;

  constructor(
    floorRadius: number,
    lightDir: readonly [number, number, number],
    color: number,
    strength: number,
    count: number,
    rand: () => number,
    keepOut: readonly (readonly [number, number, number])[] = [],
  ) {
    const dir = new Vector3(lightDir[0], lightDir[1], lightDir[2]).normalize();
    const up = new Vector3(0, 1, 0);
    const q = new Quaternion().setFromUnitVectors(up, dir);
    const parts: BufferGeometry[] = [];
    let tries = 0;
    while (parts.length < count && tries++ < count * 20) {
      const ang = rand() * Math.PI * 2;
      const r = floorRadius * (0.3 + 0.55 * Math.sqrt(rand()));
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      if (keepOut.some(([kx, kz, kr]) => Math.hypot(x - kx, z - kz) < kr)) continue;
      const radius = 0.9 + rand() * 1.1;
      const length = 16 + rand() * 6;
      const g = new CylinderGeometry(radius * 1.25, radius, length, 14, 1, true);
      // Base at the floor point, extending up toward the moon.
      g.translate(0, length / 2, 0);
      g.applyQuaternion(q);
      g.translate(x, 0, z);
      const n = g.getAttribute('position').count;
      g.setAttribute('seed', new BufferAttribute(new Float32Array(n).fill(rand()), 1));
      parts.push(g);
    }
    const merged = parts.length > 0 ? mergeGeometries(parts) : new CylinderGeometry(0, 0, 0);
    for (const p of parts) p.dispose();
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new Color(color) },
        uStrength: { value: strength },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    this.mesh = new Mesh(merged, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.name = 'light-shafts';
  }

  update(dtSec: number): void {
    this.time += dtSec;
    const u = this.material.uniforms.uTime;
    if (u !== undefined) u.value = this.time;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
