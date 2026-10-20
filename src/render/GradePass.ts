import { Color, ShaderMaterial, Vector2, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

/** Colour grade of a scene (per arena; display-referred, applied after tone mapping). */
export interface ColorGrade {
  /** Added to dark tones (cool shadows). */
  readonly shadowTint: number;
  /** Added to bright tones (warm highlights). */
  readonly highlightTint: number;
  /** 1 = unchanged. */
  readonly saturation: number;
  /** 1 = unchanged; pivots at mid grey. */
  readonly contrast: number;
  /** 0..1 darkening toward the corners. */
  readonly vignette: number;
}

export const DEFAULT_GRADE: ColorGrade = {
  shadowTint: 0x060a14,
  highlightTint: 0x140a00,
  saturation: 1.08,
  contrast: 1.06,
  vignette: 0.42,
};

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const fragmentShader = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec3 uShadowTint;
uniform vec3 uHighTint;
uniform float uSat;
uniform float uContrast;
uniform float uVignette;
uniform float uGrain;
uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uFlash;
uniform float uAberr;
varying vec2 vUv;

float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

void main() {
  vec4 src = texture2D(tDiffuse, vUv);
  vec3 c = src.rgb;
  if (uAberr > 0.0001) {
    // Colour fringing toward the edges (big hits, ultimates).
    vec2 dir = (vUv - 0.5) * uAberr;
    c.r = texture2D(tDiffuse, vUv + dir).r;
    c.b = texture2D(tDiffuse, vUv - dir).b;
  }
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  c = (c - 0.5) * uContrast + 0.5;
  c += uShadowTint * (1.0 - smoothstep(0.0, 0.45, l));
  c += uHighTint * smoothstep(0.45, 1.0, l);
  // Vignette, wider than tall so the sides darken more on landscape phones.
  vec2 d = (vUv - 0.5) * vec2(1.0, uResolution.y / max(uResolution.x, 1.0) * 1.6);
  c *= 1.0 - uVignette * smoothstep(0.25, 0.75, length(d));
  // Fine film grain hides banding in the dark fog gradients.
  c += (hash(vUv * uResolution + fract(uTime) * 61.0) - 0.5) * uGrain;
  c += uFlash;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), src.a);
}`;

/**
 * Final grading pass: saturation, contrast, split toning (cool shadows / warm highlights),
 * vignette and film grain. Runs on display-referred colour, after the OutputPass.
 */
export class GradePass extends Pass {
  private readonly material: ShaderMaterial;
  private readonly quad: FullScreenQuad;
  private time = 0;

  constructor(grade: ColorGrade = DEFAULT_GRADE, grain = 0.018) {
    super();
    this.material = new ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uShadowTint: { value: new Color() },
        uHighTint: { value: new Color() },
        uSat: { value: 1 },
        uContrast: { value: 1 },
        uVignette: { value: 0 },
        uGrain: { value: grain },
        uTime: { value: 0 },
        uResolution: { value: new Vector2(1, 1) },
        uFlash: { value: new Color(0, 0, 0) },
        uAberr: { value: 0 },
      },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
    this.setGrade(grade);
  }

  setGrade(g: ColorGrade): void {
    const u = this.material.uniforms;
    (u['uShadowTint']?.value as Color).setHex(g.shadowTint);
    (u['uHighTint']?.value as Color).setHex(g.highlightTint);
    if (u['uSat'] !== undefined) u['uSat'].value = g.saturation;
    if (u['uContrast'] !== undefined) u['uContrast'].value = g.contrast;
    if (u['uVignette'] !== undefined) u['uVignette'].value = g.vignette;
  }

  /** Momentary screen flash (added colour) and colour fringing; 0 = off. */
  setScreenFx(r: number, g: number, b: number, aberration: number): void {
    (this.material.uniforms['uFlash']?.value as Color).setRGB(r, g, b);
    const a = this.material.uniforms['uAberr'];
    if (a !== undefined) a.value = aberration;
  }

  setGrain(amount: number): void {
    const u = this.material.uniforms['uGrain'];
    if (u !== undefined) u.value = Math.max(0, amount);
  }

  override setSize(width: number, height: number): void {
    (this.material.uniforms['uResolution']?.value as Vector2).set(width, height);
  }

  override render(
    renderer: WebGLRenderer,
    writeBuffer: WebGLRenderTarget,
    readBuffer: WebGLRenderTarget,
  ): void {
    const u = this.material.uniforms;
    if (u['tDiffuse'] !== undefined) u['tDiffuse'].value = readBuffer.texture;
    this.time = (this.time + 0.016) % 1000;
    if (u['uTime'] !== undefined) u['uTime'].value = this.time;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}
