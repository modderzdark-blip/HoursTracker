import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  NormalBlending,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  type Scene,
} from 'three';
import { mulberry32 } from '../core/random';

import type { FxShape } from '../data/combatTypes';

export type { FxShape };

export interface FxSpawn {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Facing (radians, 0 = +Z), for slashes and cracks. */
  readonly yaw?: number;
  /** Roll of a slash around its facing: 0 = horizontal sweep, ±π/2 = vertical chop. */
  readonly tilt?: number;
  /** Size in metres (radius for rings / pillars / flashes, reach for slashes). */
  readonly scale: number;
  readonly color: number;
  /** Seconds. */
  readonly life: number;
  /** Mirror a slash (sweeps right → left). */
  readonly mirror?: boolean;
}

const COMMON_VERT = /* glsl */ `
attribute vec4 iA; // x y z yaw
attribute vec4 iB; // scale start life tilt
attribute vec4 iC; // r g b mirror
uniform float uTime;
varying vec2 vUv;
varying float vT;
varying vec3 vColor;
varying float vMirror;
varying vec3 vLocal;
mat3 rotY(float a) { float c = cos(a); float s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotZ(float a) { float c = cos(a); float s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
`;

/** Vertex programs per shape (all write gl_Position from the instance data). */
const VERT: Record<FxShape, string> = {
  ring: /* glsl */ `${COMMON_VERT}
void main() {
  vUv = uv; vColor = iC.rgb; vMirror = iC.w;
  vT = (uTime - iB.y) / iB.z;
  vec3 p = vec3(position.x, 0.0, -position.y) * iB.x;
  gl_Position = projectionMatrix * viewMatrix * vec4(iA.xyz + vec3(0.0, 0.04, 0.0) + p, 1.0);
}`,
  cracks: /* glsl */ `${COMMON_VERT}
void main() {
  vUv = uv; vColor = iC.rgb; vMirror = iC.w;
  vT = (uTime - iB.y) / iB.z;
  vec3 p = rotY(iA.w) * vec3(position.x, 0.0, -position.y) * iB.x;
  gl_Position = projectionMatrix * viewMatrix * vec4(iA.xyz + vec3(0.0, 0.03, 0.0) + p, 1.0);
}`,
  scorch: /* glsl */ `${COMMON_VERT}
void main() {
  vUv = uv; vColor = iC.rgb; vMirror = iC.w;
  vT = (uTime - iB.y) / iB.z;
  vLocal = vec3(iA.x, iA.z, iA.w);
  vec3 p = rotY(iA.w) * vec3(position.x, 0.0, -position.y) * iB.x;
  gl_Position = projectionMatrix * viewMatrix * vec4(iA.x + p.x, 0.025, iA.z + p.z, 1.0);
}`,
  nova: /* glsl */ `${COMMON_VERT}
varying vec3 vView;
void main() {
  vUv = uv; vColor = iC.rgb; vMirror = iC.w;
  vT = (uTime - iB.y) / iB.z;
  float grow = 0.2 + 0.8 * (1.0 - pow(1.0 - clamp(vT, 0.0, 1.0), 3.0));
  vLocal = position;
  vec3 world = iA.xyz + position * iB.x * grow;
  vView = normalize(cameraPosition - world);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`,
  slash: /* glsl */ `${COMMON_VERT}
attribute vec2 aArc; // x = along the arc 0..1, y = inner → outer 0..1
varying vec2 vArc;
void main() {
  vUv = uv; vColor = iC.rgb; vMirror = iC.w; vArc = aArc;
  vT = (uTime - iB.y) / iB.z;
  vec3 local = vec3(position.x * (iC.w > 0.5 ? -1.0 : 1.0), 0.0, position.y);
  vec3 p = rotY(iA.w) * (rotZ(iB.w) * local) * iB.x;
  gl_Position = projectionMatrix * viewMatrix * vec4(iA.xyz + p, 1.0);
}`,
  pillar: /* glsl */ `${COMMON_VERT}
void main() {
  vUv = uv; vColor = iC.rgb; vMirror = iC.w;
  vT = (uTime - iB.y) / iB.z;
  float w = mix(0.35, 1.0, smoothstep(0.0, 0.25, vT)) * (1.0 - 0.6 * smoothstep(0.6, 1.0, vT));
  vec3 p = vec3(position.x * iB.x * w, position.y * iB.x * 6.0, position.z * iB.x * w);
  gl_Position = projectionMatrix * viewMatrix * vec4(iA.xyz + p, 1.0);
}`,
  flash: /* glsl */ `${COMMON_VERT}
void main() {
  vUv = uv; vColor = iC.rgb; vMirror = iC.w;
  vT = (uTime - iB.y) / iB.z;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float s = iB.x * (0.5 + 1.2 * clamp(vT, 0.0, 1.0));
  vec3 p = iA.xyz + (right * position.x + up * position.y) * s;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`,
};

const COMMON_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vT;
varying vec3 vColor;
varying float vMirror;
varying vec3 vLocal;
float fxHash(vec2 p) { p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
float fxNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fxHash(i), fxHash(i + vec2(1.0, 0.0)), f.x), mix(fxHash(i + vec2(0.0, 1.0)), fxHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

const FRAG: Record<FxShape, string> = {
  // Expanding shockwave: a bright, slightly broken band with a faint inner wash.
  ring: /* glsl */ `${COMMON_FRAG}
void main() {
  if (vT < 0.0 || vT > 1.0) discard;
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float R = 0.12 + 0.88 * (1.0 - pow(1.0 - vT, 3.0));
  float w = mix(0.16, 0.04, vT);
  float band = 1.0 - smoothstep(0.0, w, abs(r - R));
  float a = atan(p.y, p.x);
  band *= 0.65 + 0.35 * fxNoise(vec2(a * 6.0, vT * 4.0));
  float inner = (1.0 - smoothstep(0.0, R, r)) * 0.18;
  float alpha = (band + inner) * (1.0 - vT) * step(r, 1.0);
  gl_FragColor = vec4(vColor * alpha * 2.0, alpha);
}`,
  // Glowing ground fissures that cool from white-hot to the effect colour.
  cracks: /* glsl */ `${COMMON_FRAG}
void main() {
  if (vT < 0.0 || vT > 1.0) discard;
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float a = atan(p.y, p.x);
  // Radial fissures with a jagged wander.
  float rays = abs(sin(a * 5.0 + fxNoise(vec2(r * 6.0, a * 2.0)) * 2.5));
  float crack = 1.0 - smoothstep(0.0, 0.2 + r * 0.1, rays);
  crack *= 1.0 - smoothstep(0.55, 1.0, r);
  float ring = (1.0 - smoothstep(0.0, 0.05, abs(r - 0.45 - fxNoise(vec2(a * 3.0, 1.0)) * 0.1))) * 0.6;
  float heat = 1.0 - vT;
  float alpha = max(crack, ring * (1.0 - r)) * heat * heat;
  vec3 c = mix(vColor, vec3(1.0, 0.95, 0.85), heat * heat * 0.6);
  gl_FragColor = vec4(c * alpha * 3.0, alpha);
}`,
  // Burnt ground left by explosions: a charred, ragged blotch whose embers cool first.
  scorch: /* glsl */ `${COMMON_FRAG}
void main() {
  if (vT < 0.0 || vT > 1.0) discard;
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  vec2 q = p * 2.2 + vLocal.xy * 0.37;
  float n = fxNoise(q) * 0.6 + fxNoise(q * 2.3 + 5.1) * 0.4;
  float edge = 0.62 + n * 0.32;
  float soot = 1.0 - smoothstep(edge - 0.25, edge, r);
  // Splatter streaks radiating out.
  float a = atan(p.y, p.x);
  float rays = pow(fxNoise(vec2(a * 4.0 + vLocal.z, 3.0)), 3.0) * (1.0 - smoothstep(0.5, 1.0, r));
  soot = max(soot, rays * 0.7);
  float fade = smoothstep(0.0, 0.03, vT) * (1.0 - smoothstep(0.55, 1.0, vT));
  // Embers: hot specks inside the burn, gone in the first fifth of its life.
  float heat = 1.0 - smoothstep(0.0, 0.22, vT);
  float specks = smoothstep(0.74, 0.97, fxNoise(q * 7.5 + uTime * 0.6)) * soot * heat * (1.0 - smoothstep(0.2, 0.7, r));
  float alpha = clamp(soot * 0.92 * fade + specks, 0.0, 1.0);
  vec3 c = mix(vec3(0.02, 0.015, 0.012), vColor * 2.5 + vec3(0.4, 0.2, 0.05), specks / max(alpha, 1e-3));
  gl_FragColor = vec4(c, alpha);
}`,
  // Sphere of energy that blooms out and dissolves (explosions, novas).
  nova: /* glsl */ `${COMMON_FRAG}
varying vec3 vView;
void main() {
  if (vT < 0.0 || vT > 1.0) discard;
  vec3 n = normalize(vLocal);
  // Fresnel shell: bright at the silhouette, thin in the middle, with crackling energy.
  float fres = pow(1.0 - abs(dot(n, vView)), 2.2);
  float energy = fxNoise(n.xz * 4.0 + n.y * 3.0 + uTime * 3.0);
  float alpha = (fres * 1.2 + energy * 0.25) * (1.0 - vT) * (1.0 - vT);
  vec3 c = mix(vColor, vec3(1.0, 0.95, 0.85), fres * (1.0 - vT) * 0.5);
  gl_FragColor = vec4(c * alpha * 1.8, alpha);
}`,
  // Crescent of light swept along its arc: hot leading edge, streaked tail.
  slash: /* glsl */ `${COMMON_FRAG}
varying vec2 vArc;
void main() {
  if (vT < 0.0 || vT > 1.0) discard;
  float head = clamp(vT * 2.4, 0.0, 1.0);
  float d = head - vArc.x;
  if (d < 0.0) discard;
  // Crescent blade: thickest behind the leading edge, tapering to a point at both ends.
  float s = d / 0.85;
  if (s > 1.0) discard;
  float thick = pow(sin(3.14159 * clamp(1.0 - s, 0.0, 1.0)), 0.55) * 0.8 + 0.04;
  float inner = 1.0 - vArc.y;
  float body = 1.0 - smoothstep(thick * 0.55, thick, inner);
  float core = 1.0 - smoothstep(0.0, thick * 0.28, inner);
  float streak = 0.7 + 0.3 * fxNoise(vec2(vArc.x * 40.0, vArc.y * 6.0 + vT * 8.0));
  float fade = 1.0 - smoothstep(0.5, 1.0, vT);
  float alpha = (body * 0.5 + core * 0.95) * streak * fade;
  vec3 c = mix(vColor, vec3(1.0, 0.97, 0.9), core * 0.75);
  gl_FragColor = vec4(c * alpha * 2.2, alpha);
}`,
  // Column of light with streaks rising through it.
  pillar: /* glsl */ `${COMMON_FRAG}
void main() {
  if (vT < 0.0 || vT > 1.0) discard;
  float y = vUv.y;
  float streak = fxNoise(vec2(vUv.x * 18.0, y * 3.0 - uTime * 4.0));
  float body = (1.0 - smoothstep(0.35, 1.0, y)) * (0.55 + 0.45 * streak);
  float base = 1.0 - smoothstep(0.0, 0.08, y);
  float alpha = (body + base * 0.6) * (1.0 - smoothstep(0.55, 1.0, vT)) * smoothstep(0.0, 0.08, vT);
  gl_FragColor = vec4(mix(vColor, vec3(1.0), base * 0.5) * alpha * 1.8, alpha * 0.85);
}`,
  // Soft bright flash (impacts, muzzle, teleports).
  flash: /* glsl */ `${COMMON_FRAG}
void main() {
  if (vT < 0.0 || vT > 1.0) discard;
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float core = 1.0 - smoothstep(0.0, 0.35, r);
  float glow = pow(max(0.0, 1.0 - r), 2.0);
  float a = atan(p.y, p.x);
  float spikes = pow(abs(cos(a * 3.0)), 24.0) * (1.0 - smoothstep(0.0, 1.0, r)) * 0.8;
  float alpha = (core + glow * 0.6 + spikes) * (1.0 - vT) * (1.0 - vT);
  gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.7) * alpha * 2.0, alpha);
}`,
};

/** Crescent: a partial annulus with arc / radius coordinates baked in. */
function slashGeometry(): BufferGeometry {
  const seg = 28;
  const span = 2.7;
  const pos: number[] = [];
  const arc: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const a = -span / 2 + t * span;
    for (const [r, k] of [
      [0.3, 0],
      [1, 1],
    ] as const) {
      // Facing +Z: the arc sweeps from the attacker's right to its left.
      pos.push(-Math.sin(a) * r, Math.cos(a) * r, 0);
      arc.push(t, k);
      uv.push(t, k);
    }
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aArc', new BufferAttribute(new Float32Array(arc), 2));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(index);
  return g;
}

function shapeGeometry(shape: FxShape): BufferGeometry {
  switch (shape) {
    case 'slash':
      return slashGeometry();
    case 'pillar': {
      const g = new CylinderGeometry(1, 1, 1, 24, 1, true);
      g.translate(0, 0.5, 0);
      return g;
    }
    case 'nova':
      return new IcosahedronGeometry(1, 2);
    default:
      return new PlaneGeometry(2, 2);
  }
}

interface Pool {
  readonly mesh: InstancedMesh;
  readonly a: InstancedBufferAttribute;
  readonly b: InstancedBufferAttribute;
  readonly c: InstancedBufferAttribute;
  next: number;
}

const SMOKE_VERT = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
attribute vec3 aVel;
attribute vec4 aInfo; // start, life, size, shade
varying float vAlpha;
varying float vShade;
void main() {
  float age = uTime - aInfo.x;
  if (age < 0.0 || age > aInfo.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vAlpha = 0.0; return; }
  float t = age / aInfo.y;
  vec3 p = position + aVel * (age - 0.35 * age * age / aInfo.y);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aInfo.z * (0.6 + 1.4 * t) * uPixelRatio * (40.0 / max(-mv.z, 0.5));
  vAlpha = (1.0 - t) * smoothstep(0.0, 0.12, t);
  vShade = aInfo.w;
}`;

const SMOKE_FRAG = /* glsl */ `
varying float vAlpha;
varying float vShade;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  float a = (1.0 - smoothstep(0.2, 1.0, r)) * vAlpha * 0.55;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(vShade), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * Battle effects library: expanding shockwaves, glowing slash arcs, light pillars, flashes,
 * burning ground fissures, energy novas, scorch marks and drifting smoke. Each shape is one instanced draw
 * call driven entirely by the GPU from (start time, life): spawning writes one instance, there
 * is no per-frame CPU work per effect.
 */
export class Fx {
  private readonly pools = new Map<FxShape, Pool>();
  private readonly materials: ShaderMaterial[] = [];
  private time = 0;
  private readonly color = new Color();
  private readonly identity = new Matrix4();
  // Smoke (normal blending: it darkens).
  private readonly smoke: Points;
  private readonly smokeMat: ShaderMaterial;
  private readonly sPos: BufferAttribute;
  private readonly sVel: BufferAttribute;
  private readonly sInfo: BufferAttribute;
  private sNext = 0;
  private sDirty = false;
  private readonly rand = mulberry32(31);
  /** Quality scale for smoke particle counts (0..1+). */
  density = 1;

  constructor(
    scene: Scene,
    capacity = 24,
    private readonly smokeCapacity = 220,
  ) {
    const shapes: FxShape[] = ['scorch', 'ring', 'cracks', 'slash', 'pillar', 'flash', 'nova'];
    for (const shape of shapes) {
      const geo = shapeGeometry(shape);
      const a = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(
        DynamicDrawUsage,
      );
      const b = new InstancedBufferAttribute(new Float32Array(capacity * 4).fill(-100), 4).setUsage(
        DynamicDrawUsage,
      );
      const c = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(
        DynamicDrawUsage,
      );
      geo.setAttribute('iA', a);
      geo.setAttribute('iB', b);
      geo.setAttribute('iC', c);
      const mat = new ShaderMaterial({
        vertexShader: VERT[shape],
        fragmentShader: FRAG[shape],
        uniforms: { uTime: { value: 0 } },
        transparent: true,
        depthWrite: false,
        // Scorch marks darken the ground; everything else is light.
        blending: shape === 'scorch' ? NormalBlending : AdditiveBlending,
        side: 2,
      });
      this.materials.push(mat);
      const mesh = new InstancedMesh(geo, mat, capacity);
      for (let i = 0; i < capacity; i++) mesh.setMatrixAt(i, this.identity);
      mesh.frustumCulled = false;
      mesh.renderOrder = shape === 'scorch' ? 1 : 6;
      mesh.name = `fx-${shape}`;
      scene.add(mesh);
      this.pools.set(shape, { mesh, a, b, c, next: 0 });
    }
    const geo = new BufferGeometry();
    this.sPos = new BufferAttribute(new Float32Array(smokeCapacity * 3), 3).setUsage(
      DynamicDrawUsage,
    );
    this.sVel = new BufferAttribute(new Float32Array(smokeCapacity * 3), 3).setUsage(
      DynamicDrawUsage,
    );
    this.sInfo = new BufferAttribute(new Float32Array(smokeCapacity * 4).fill(-100), 4).setUsage(
      DynamicDrawUsage,
    );
    geo.setAttribute('position', this.sPos);
    geo.setAttribute('aVel', this.sVel);
    geo.setAttribute('aInfo', this.sInfo);
    this.smokeMat = new ShaderMaterial({
      vertexShader: SMOKE_VERT,
      fragmentShader: SMOKE_FRAG,
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
    });
    this.smoke = new Points(geo, this.smokeMat);
    this.smoke.frustumCulled = false;
    this.smoke.renderOrder = 3;
    this.smoke.name = 'fx-smoke';
    scene.add(this.smoke);
  }

  setPixelRatio(pr: number): void {
    const u = this.smokeMat.uniforms['uPixelRatio'];
    if (u !== undefined) u.value = pr;
  }

  spawn(shape: FxShape, s: FxSpawn): void {
    const pool = this.pools.get(shape);
    if (pool === undefined) return;
    const i = pool.next;
    pool.next = (i + 1) % pool.mesh.count;
    this.color.setHex(s.color);
    pool.a.setXYZW(i, s.x, s.y, s.z, s.yaw ?? 0);
    pool.b.setXYZW(i, s.scale, this.time, Math.max(0.05, s.life), s.tilt ?? 0);
    pool.c.setXYZW(i, this.color.r, this.color.g, this.color.b, s.mirror === true ? 1 : 0);
    pool.a.needsUpdate = true;
    pool.b.needsUpdate = true;
    pool.c.needsUpdate = true;
  }

  /** Puffs of smoke / dust rising from a point (shade 0 = black soot, 1 = pale dust). */
  smokeBurst(x: number, y: number, z: number, count: number, spread: number, shade: number): void {
    const n = Math.max(1, Math.round(count * this.density));
    for (let k = 0; k < n; k++) {
      const i = this.sNext;
      this.sNext = (i + 1) % this.smokeCapacity;
      const a = this.rand() * Math.PI * 2;
      const r = this.rand() * spread * 0.5;
      this.sPos.setXYZ(i, x + Math.cos(a) * r, y, z + Math.sin(a) * r);
      this.sVel.setXYZ(
        i,
        Math.cos(a) * spread * (0.4 + this.rand()),
        0.6 + this.rand() * 1.4,
        Math.sin(a) * spread * (0.4 + this.rand()),
      );
      this.sInfo.setXYZW(
        i,
        this.time + this.rand() * 0.08,
        0.9 + this.rand() * 0.9,
        0.5 + this.rand() * 0.7 * Math.max(0.6, spread),
        shade * (0.6 + this.rand() * 0.4),
      );
    }
    this.sDirty = true;
  }

  update(dtSec: number): void {
    this.time += dtSec;
    for (const m of this.materials) {
      const u = m.uniforms['uTime'];
      if (u !== undefined) u.value = this.time;
    }
    const u = this.smokeMat.uniforms['uTime'];
    if (u !== undefined) u.value = this.time;
    if (this.sDirty) {
      this.sPos.needsUpdate = true;
      this.sVel.needsUpdate = true;
      this.sInfo.needsUpdate = true;
      this.sDirty = false;
    }
  }

  clear(): void {
    for (const p of this.pools.values()) {
      for (let i = 0; i < p.mesh.count; i++) p.b.setY(i, -100);
      p.b.needsUpdate = true;
    }
    for (let i = 0; i < this.smokeCapacity; i++) this.sInfo.setX(i, -100);
    this.sInfo.needsUpdate = true;
  }

  dispose(): void {
    for (const p of this.pools.values()) {
      p.mesh.removeFromParent();
      p.mesh.geometry.dispose();
    }
    for (const m of this.materials) m.dispose();
    this.smoke.removeFromParent();
    this.smoke.geometry.dispose();
    this.smokeMat.dispose();
  }
}
