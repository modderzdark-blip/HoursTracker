import {
  CircleGeometry,
  Color,
  CustomBlending,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  Vector2,
} from 'three';
import type { TimeUniform } from '../render/env/propMaterials';
import {
  FOG_FADE_PARS_FRAGMENT,
  FOG_FADE_PARS_VERTEX,
  FOG_FADE_VERTEX,
  fogUniforms,
} from './fogFade';

/** Pattern of a sigil: two star polygons {n/k}, radial spokes, and an optional flower of circles. */
export interface SigilStyle {
  readonly starA: readonly [number, number];
  readonly starB: readonly [number, number];
  readonly spokes: number;
  readonly flower: boolean;
  /** Seed for the rune glyphs in the outer band. */
  readonly runes: number;
}

const vertexShader = /* glsl */ `
varying vec2 vP;
${FOG_FADE_PARS_VERTEX}
void main() {
  vP = position.xz;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  ${FOG_FADE_VERTEX}
}`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uRadius;
uniform vec3 uColor;
uniform float uDark;
uniform vec2 uStarA;
uniform vec2 uStarB;
uniform float uSpokes;
uniform float uFlower;
uniform float uRunes;
varying vec2 vP;
${FOG_FADE_PARS_FRAGMENT}
float hash(vec2 p) { p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 19.19); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float seg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
float ink(float d, float w) { return 1.0 - smoothstep(w, w + 0.01, d); }
// A rune: a stem plus strokes picked by the cell's hash (cell space -1..1).
float glyph(vec2 q, float id) {
  float d = seg(q, vec2(0.0, -0.8), vec2(0.0, 0.8));
  d = min(d, seg(q, vec2(0.0, 0.8), vec2(fract(id * 7.13) > 0.5 ? 0.6 : -0.6, 0.3)));
  if (fract(id * 13.7) > 0.4) d = min(d, seg(q, vec2(-0.55, -0.1), vec2(0.55, 0.25)));
  if (fract(id * 3.71) > 0.6) d = min(d, abs(length(q - vec2(0.0, -0.45)) - 0.3));
  if (fract(id * 29.3) > 0.5) d = min(d, seg(q, vec2(0.0, -0.2), vec2(0.6, -0.8)));
  return d;
}
float star(vec2 p, vec2 nk, float radius, float rot) {
  float d = 9.0;
  for (int i = 0; i < 12; i++) {
    if (float(i) >= nk.x) break;
    float a0 = rot + float(i) / nk.x * 6.2832;
    float a1 = rot + mod(float(i) + nk.y, nk.x) / nk.x * 6.2832;
    d = min(d, seg(p, vec2(cos(a0), sin(a0)) * radius, vec2(cos(a1), sin(a1)) * radius));
  }
  return d;
}
void main() {
  vec2 p = vP / uRadius;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);
  float w = 0.006;
  float lines = 0.0;
  lines = max(lines, ink(abs(r - 0.965), w * 1.8));
  lines = max(lines, ink(abs(r - 0.925), w));
  lines = max(lines, ink(abs(r - 0.78), w * 1.5));
  lines = max(lines, ink(abs(r - 0.745), w));
  lines = max(lines, ink(abs(r - 0.3), w * 1.2));
  lines = max(lines, ink(abs(r - 0.265), w));
  // Outer rune band, turning slowly.
  float n = 30.0;
  float ar = (a + uTime * 0.02) / 6.2832 * n;
  float cell = mod(floor(ar), n);
  vec2 q = vec2((fract(ar) - 0.5) * 2.4, (r - 0.852) / 0.055);
  if (abs(q.y) < 1.0) lines = max(lines, ink(glyph(q, hash(vec2(cell, uRunes))) * 0.05, w * 0.8));
  // Star polygons counter-rotating inside the band.
  lines = max(lines, ink(star(p, uStarA, 0.745, -uTime * 0.012), w * 1.3));
  if (uStarB.x > 2.5) lines = max(lines, ink(star(p, uStarB, 0.52, uTime * 0.018 + 0.3), w));
  if (uSpokes > 0.5) {
    float sa = fract(a / 6.2832 * uSpokes + 0.5) - 0.5;
    float sd = abs(sa) / uSpokes * 6.2832 * r;
    lines = max(lines, ink(sd, w * 0.8) * step(0.3, r) * step(r, 0.52));
  }
  if (uFlower > 0.5) {
    for (int i = 0; i < 6; i++) {
      float fa = float(i) / 6.0 * 6.2832 + uTime * 0.01;
      lines = max(lines, ink(abs(length(p - vec2(cos(fa), sin(fa)) * 0.26) - 0.26), w));
    }
  }
  // Weathering: worn gaps and grime break the lines up.
  float wear = smoothstep(0.2, 0.5, vnoise(p * 9.0 + 3.1)) * (0.6 + 0.4 * vnoise(p * 30.0));
  lines *= 0.25 + 0.75 * wear;
  // A slow wave of light runs around the circle; the whole sigil breathes.
  float wave = pow(0.5 + 0.5 * cos(a * 2.0 - uTime * 0.7), 6.0);
  float glow = (0.3 + 0.7 * wave) * (0.8 + 0.2 * sin(uTime * 0.9));
  float f = fogFade();
  float disc = (1.0 - smoothstep(0.92, 1.0, r)) * 0.08;
  gl_FragColor = vec4(uColor * lines * glow * f, (lines * uDark + disc) * f);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * The carved sigil at the arena centre: concentric rings, a band of runes and star polygons,
 * engraved (darkened) with a faint glow that runs around it and breathes, weathered by noise.
 * Kept dim and off the telegraph reds so danger zones always read over it. One draw call.
 */
export class GroundSigil {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  constructor(radius: number, color: number, style: SigilStyle, time: TimeUniform) {
    const geo = new CircleGeometry(radius, 64);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0.03, 0);
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        ...fogUniforms(),
        uTime: time,
        uRadius: { value: radius },
        uColor: { value: new Color(color) },
        uDark: { value: 0.55 },
        uStarA: { value: new Vector2(style.starA[0], style.starA[1]) },
        uStarB: { value: new Vector2(style.starB[0], style.starB[1]) },
        uSpokes: { value: style.spokes },
        uFlower: { value: style.flower ? 1 : 0 },
        uRunes: { value: style.runes },
      },
      transparent: true,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      fog: true,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.renderOrder = 1;
    this.mesh.name = 'ground-sigil';
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
