import {
  Color,
  MeshDepthMaterial,
  type Material,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from 'three';

/** Per-character dissolve state shared by its body, glow and shadow materials. */
export interface DissolveUniforms {
  /** 0 = whole, 1 = gone. */
  readonly uDissolve: { value: number };
  /** Colour of the burning edge (linear, may exceed 1 for bloom). */
  readonly uDissolveEdge: { value: Color };
  /** Rest-pose height of the body (plan units): ash burns upward from the feet. */
  readonly uDissolveHeight: { value: number };
}

export function createDissolveUniforms(height: number): DissolveUniforms {
  return {
    uDissolve: { value: 0 },
    uDissolveEdge: { value: new Color(2.2, 0.7, 0.2) },
    uDissolveHeight: { value: Math.max(0.1, height) },
  };
}

/** Edge colour from a hex tint, boosted so the burning rim blooms. */
export function setDissolveEdge(u: DissolveUniforms, hex: number): void {
  u.uDissolveEdge.value.setHex(hex).multiplyScalar(2.2);
}

const NOISE = /* glsl */ `
uniform float uDissolve;
uniform vec3 uDissolveEdge;
uniform float uDissolveHeight;
varying vec3 vDisPos;
float dsHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.17, 0.43, 0.71));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float dsNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dsHash(i), dsHash(i + vec3(1, 0, 0)), f.x),
                 mix(dsHash(i + vec3(0, 1, 0)), dsHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(dsHash(i + vec3(0, 0, 1)), dsHash(i + vec3(1, 0, 1)), f.x),
                 mix(dsHash(i + vec3(0, 1, 1)), dsHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// 0..1 burn order of a rest-pose point: mostly noise (patches), biased so the feet go first.
float dsField(vec3 p) {
  float n = dsNoise(p * 3.2) * 0.65 + dsNoise(p * 11.0) * 0.35;
  float h = clamp(p.y / uDissolveHeight, 0.0, 1.0);
  return n * 0.72 + h * 0.28;
}
`;

/** Band widths in field units: the glowing rim of the holes, and the charred skin around it. */
const EDGE = '0.045';
const CHAR = '0.16';

/** Discard test; `dsEdge` (0..1) is how close the fragment is to the burning edge. */
const DISCARD = /* glsl */ `
float dsEdge = 0.0;
float dsChar = 0.0;
if (uDissolve > 0.0) {
  float dsF = dsField(vDisPos) * 0.96 + 0.02;
  if (dsF < uDissolve) discard;
  dsEdge = 1.0 - smoothstep(0.0, ${EDGE}, dsF - uDissolve);
  dsChar = 1.0 - smoothstep(0.0, ${CHAR}, dsF - uDissolve);
}
`;

const VERT_DECL = 'varying vec3 vDisPos;';
const VERT_BODY = 'vDisPos = position;';

type Hook = (shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer) => void;

function chain(material: Material, extra: Hook, key: string): void {
  const prev = material.onBeforeCompile.bind(material);
  const prevKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    extra(shader, renderer);
  };
  material.customProgramCacheKey = () => `${prevKey()}|${key}`;
}

function inject(
  shader: WebGLProgramParametersWithUniforms,
  u: DissolveUniforms,
  edgeGlow: boolean,
): void {
  shader.uniforms['uDissolve'] = u.uDissolve;
  shader.uniforms['uDissolveEdge'] = u.uDissolveEdge;
  shader.uniforms['uDissolveHeight'] = u.uDissolveHeight;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BODY}`);
  let frag = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${NOISE}`)
    .replace(
      '#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>\n${DISCARD}`,
    );
  if (edgeGlow) {
    // Hot rim on the edge of every hole: white-hot at the very edge, cooling to ember red.
    frag = frag.replace(
      '#include <emissivemap_fragment>',
      [
        '#include <emissivemap_fragment>',
        'totalEmissiveRadiance += uDissolveEdge * (dsEdge * dsEdge) * (1.0 + 1.5 * dsEdge * dsEdge);',
        'diffuseColor.rgb *= 1.0 - 0.85 * dsChar;',
      ].join('\n'),
    );
  }
  shader.fragmentShader = frag;
}

/**
 * Adds a burn-away dissolve to a character's materials. The shader code is always present and
 * branches on a uniform, so starting a dissolve mid-fight never compiles a new program: every
 * character shares the same variant from the first frame. Returns the depth material to use as
 * the mesh's `customDepthMaterial` so the shadow burns away with the body.
 */
export function applyDissolve(
  body: MeshStandardMaterial,
  glow: MeshBasicMaterial,
  u: DissolveUniforms,
): MeshDepthMaterial {
  chain(body, (sh) => inject(sh, u, true), 'dissolve-v1');
  chain(glow, (sh) => inject(sh, u, false), 'dissolve-v1');
  const depth = new MeshDepthMaterial();
  chain(depth, (sh) => inject(sh, u, false), 'dissolve-depth-v1');
  return depth;
}

/**
 * Drives a dissolve over time: `start()` burns the body away, `materialize()` plays it in
 * reverse (rising from ash). Pure state; the rig copies `amount` into its uniforms.
 */
export class DissolveTimeline {
  amount = 0;
  private from = 0;
  private to = 0;
  private elapsed = 0;
  private duration = 0;

  get active(): boolean {
    return this.duration > 0 && this.elapsed < this.duration;
  }

  /** Burn away over `sec` seconds (0 → 1). */
  start(sec: number): void {
    this.run(this.amount, 1, sec);
  }

  /** Form out of ash over `sec` seconds (1 → 0). */
  materialize(sec: number): void {
    this.run(1, 0, sec);
  }

  private run(from: number, to: number, sec: number): void {
    this.from = from;
    this.to = to;
    this.elapsed = 0;
    this.duration = Math.max(1e-3, sec);
    this.amount = from;
  }

  update(dtSec: number): void {
    if (this.duration <= 0) return;
    this.elapsed = Math.min(this.duration, this.elapsed + Math.max(0, dtSec));
    const k = this.elapsed / this.duration;
    // Burning runs at an even pace (the burn field already spreads it out); forming from ash
    // eases out so the body settles into shape.
    const e = this.to > this.from ? k : 1 - (1 - k) * (1 - k);
    this.amount = this.from + (this.to - this.from) * e;
    if (this.elapsed >= this.duration - 1e-6) {
      this.amount = this.to;
      this.duration = 0;
    }
  }

  reset(): void {
    this.amount = 0;
    this.duration = 0;
    this.elapsed = 0;
  }
}
