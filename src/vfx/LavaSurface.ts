import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
} from 'three';
import { fbm } from '../render/env/shapes';
import type { TimeUniform } from '../render/env/propMaterials';

/**
 * A lava pool: a disc with a noisy shoreline at (x, z), slightly below the floor. `aEdge` is 0
 * on the shore and 1 in the middle (crust thickens toward the shore).
 */
export function lavaPoolGeometry(
  x: number,
  z: number,
  radius: number,
  seed: number,
  y = 0.04,
): BufferGeometry {
  const seg = 28;
  const rings = 4;
  const pos: number[] = [x, y, z];
  const edge: number[] = [1];
  for (let r = 1; r <= rings; r++) {
    const t = r / rings;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const k = radius * (1 + fbm(Math.cos(a) * 1.6 + seed, Math.sin(a) * 1.6, seed, 3) * 0.35);
      pos.push(x + Math.cos(a) * k * t, y, z + Math.sin(a) * k * t);
      edge.push(1 - t);
    }
  }
  const index: number[] = [];
  for (let i = 0; i < seg; i++) index.push(0, 1 + ((i + 1) % seg), 1 + i);
  for (let r = 1; r < rings; r++) {
    const a0 = 1 + (r - 1) * seg;
    const b0 = 1 + r * seg;
    for (let i = 0; i < seg; i++) {
      const i1 = (i + 1) % seg;
      index.push(a0 + i, a0 + i1, b0 + i, a0 + i1, b0 + i1, b0 + i);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aEdge', new BufferAttribute(new Float32Array(edge), 1));
  g.setIndex(index);
  return g;
}

/** A lava moat: an annulus from r0 to r1 around the arena centre. */
export function lavaRingGeometry(r0: number, r1: number, seed: number, y = 0.04): BufferGeometry {
  const seg = 160;
  const rows = 4;
  const pos: number[] = [];
  const edge: number[] = [];
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const wob = fbm(Math.cos(a) * 4 + seed, Math.sin(a) * 4, t, 2) * 0.6;
      const r = r0 + (r1 - r0) * t + (j === 0 || j === rows ? wob : 0);
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      edge.push(Math.sin(t * Math.PI));
    }
  }
  const index: number[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < seg; i++) {
      const i1 = (i + 1) % seg;
      const a = j * seg;
      const b = (j + 1) * seg;
      index.push(a + i, b + i, a + i1, a + i1, b + i, b + i1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aEdge', new BufferAttribute(new Float32Array(edge), 1));
  g.setIndex(index);
  return g;
}

/**
 * A lava channel along a polyline of (x, z) points, `width` m across with wobbling banks; `aEdge`
 * is 0 on both banks and 1 down the middle.
 */
export function lavaChannelGeometry(
  points: readonly (readonly [number, number])[],
  width: number,
  seed: number,
  y = 0.04,
): BufferGeometry {
  // Resample the path every ~0.8 m so the banks can wobble.
  const path: [number, number][] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a === undefined || b === undefined) continue;
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.8));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      path.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  const last = points[points.length - 1];
  if (last !== undefined) path.push([last[0], last[1]]);
  const cols = 4;
  const pos: number[] = [];
  const edge: number[] = [];
  path.forEach(([x, z], i) => {
    const p = path[Math.max(0, i - 1)] ?? [x, z];
    const q = path[Math.min(path.length - 1, i + 1)] ?? [x, z];
    const dx = q[0] - p[0];
    const dz = q[1] - p[1];
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    // Narrow at the ends, wobbling along the way.
    const end = Math.min(1, Math.min(i, path.length - 1 - i) / 3 + 0.35);
    for (let c = 0; c <= cols; c++) {
      const t = c / cols - 0.5;
      const wob = 1 + fbm(x * 0.4 + seed + t * 3, z * 0.4, seed, 2) * 0.5;
      const off = t * width * wob * end;
      pos.push(x + nx * off, y, z + nz * off);
      edge.push(1 - Math.abs(t) * 2);
    }
  });
  const index: number[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    for (let c = 0; c < cols; c++) {
      const a = i * (cols + 1) + c;
      const b = a + cols + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aEdge', new BufferAttribute(new Float32Array(edge), 1));
  g.setIndex(index);
  return g;
}

const vertexShader = /* glsl */ `
attribute float aEdge;
varying vec3 vWorld;
varying float vEdge;
#include <fog_pars_vertex>
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vEdge = aEdge;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3 uHot;
uniform vec3 uCrust;
varying vec3 vWorld;
varying float vEdge;
#include <fog_pars_fragment>
float hash(vec2 p) { p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 19.19); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// Cellular crust: distance to the nearest of jittered points (plates with glowing seams).
float cells(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = vec2(hash(n + g), hash(n + g + 17.3));
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return d2 - d1;
}
void main() {
  // Flow circles the arena: the pattern turns slowly about the centre (no seam, unlike polar uv).
  float ra = uTime * 0.008;
  vec2 p = mat2(cos(ra), -sin(ra), sin(ra), cos(ra)) * vWorld.xz * 0.9;
  vec2 warp = vec2(vnoise(p * 0.7 + uTime * 0.05), vnoise(p * 0.7 + 4.3 - uTime * 0.04)) * 0.8;
  float seam = cells(p * 0.9 + warp);
  float seamFine = cells(p * 2.3 - warp * 1.5);
  float crust = smoothstep(0.05, 0.28, seam) * smoothstep(0.02, 0.18, seamFine * 0.9 + 0.05);
  // Thicker, darker crust at the shore; the open middle churns brighter.
  crust = clamp(crust + (1.0 - vEdge) * 0.55, 0.0, 1.0);
  float pulse = 0.8 + 0.2 * sin(uTime * 1.3 + vnoise(p * 0.3) * 6.28);
  float heat = (1.0 - crust) * pulse;
  vec3 col = mix(uCrust * (0.6 + 0.6 * vnoise(p * 3.0)), uHot * (0.6 + 0.8 * heat), heat);
  col += uHot * 0.12 * (1.0 - crust * 0.7);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/**
 * Molten lava (pools and moats merged into one geometry): drifting crust plates with glowing
 * seams that churn and pulse, flowing around the arena. Unlit and bright enough to bloom; one
 * draw call.
 */
export class LavaSurface {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  constructor(geometry: BufferGeometry, hot: number, crust: number, time: TimeUniform) {
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        ...UniformsUtils.clone(UniformsLib.fog),
        uTime: time,
        uHot: { value: new Color(hot).multiplyScalar(3) },
        uCrust: { value: new Color(crust) },
      },
      fog: true,
    });
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.name = 'lava';
    this.mesh.receiveShadow = false;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
