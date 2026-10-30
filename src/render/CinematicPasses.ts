import {
  ShaderMaterial,
  type Camera,
  type DepthTexture,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * The depth texture of the frame's scene render. The composer ping-pongs between two targets
 * (each with its own depth texture), so the pass right after the RenderPass records which one
 * the scene went into; later passes read it from here.
 */
export class SceneDepth {
  texture: DepthTexture | null = null;
}

/** Zero-cost pass (no draw): records the depth texture of the scene render. */
export class DepthTapPass extends Pass {
  constructor(private readonly depth: SceneDepth) {
    super();
    this.needsSwap = false;
  }

  override render(
    _renderer: WebGLRenderer,
    _writeBuffer: WebGLRenderTarget,
    readBuffer: WebGLRenderTarget,
  ): void {
    this.depth.texture = readBuffer.depthTexture;
  }
}

/** Ambient occlusion tuning (metres; GTAO's world-space radius). */
export const AO_CONFIG = {
  radius: 0.55,
  thickness: 1.2,
  distanceExponent: 1.4,
  distanceFallOff: 0.9,
  scale: 1.15,
  samples: 12,
  /** AO buffers at this fraction of the drawing buffer (upsampled when blended). */
  resolutionScale: 0.5,
  /** 0..1 strength of the darkening. */
  intensity: 0.85,
} as const;

/**
 * GTAO built from the scene's own depth buffer (normals reconstructed from depth) instead of
 * re-rendering the whole scene into a normal buffer: no extra draw calls, a few full-screen
 * passes at half resolution. Ultra only.
 */
export class AmbientOcclusionPass extends GTAOPass {
  private boundDepth: DepthTexture | null = null;

  constructor(
    scene: Scene,
    camera: Camera,
    private readonly depth: SceneDepth,
    initialDepth: DepthTexture,
  ) {
    super(scene, camera, 1, 1);
    // Use the composer's depth (no G-buffer pass); normals are reconstructed from it.
    this.setGBuffer(initialDepth);
    this.boundDepth = initialDepth;
    this.updateGtaoMaterial({
      radius: AO_CONFIG.radius,
      thickness: AO_CONFIG.thickness,
      distanceExponent: AO_CONFIG.distanceExponent,
      distanceFallOff: AO_CONFIG.distanceFallOff,
      scale: AO_CONFIG.scale,
      samples: AO_CONFIG.samples,
      screenSpaceRadius: false,
    });
    this.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2 });
    this.blendIntensity = AO_CONFIG.intensity;
    // The occlusion is multiplied onto the frame in place (see render): no copy of the whole
    // frame into the other buffer first, so no swap.
    this.output = GTAOPass.OUTPUT.Off;
    this.needsSwap = false;
    this.blendQuad = new FullScreenQuad(this.blendMaterial);
  }

  private readonly blendQuad: FullScreenQuad;

  override setSize(width: number, height: number): void {
    const k = AO_CONFIG.resolutionScale;
    super.setSize(Math.max(1, Math.round(width * k)), Math.max(1, Math.round(height * k)));
  }

  override render(
    renderer: WebGLRenderer,
    writeBuffer: WebGLRenderTarget,
    readBuffer: WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ): void {
    const tex = this.depth.texture;
    if (tex !== null && tex !== this.boundDepth) {
      this.boundDepth = tex;
      this.depthTexture = tex;
      const g = this.gtaoMaterial.uniforms['tDepth'];
      const p = this.pdMaterial.uniforms['tDepth'];
      if (g !== undefined) g.value = tex;
      if (p !== undefined) p.value = tex;
    }
    // AO + denoise into the pass's own half-resolution targets…
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    // …then multiplied straight onto the frame (the blend material multiplies the destination).
    const u = this.blendMaterial.uniforms;
    if (u['intensity'] !== undefined) u['intensity'].value = this.blendIntensity;
    if (u['tDiffuse'] !== undefined) u['tDiffuse'].value = this.pdRenderTarget.texture;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(readBuffer);
    this.blendQuad.render(renderer);
    renderer.autoClear = autoClear;
  }

  override dispose(): void {
    super.dispose();
    this.blendQuad.dispose();
  }
}

/** Cinematic depth of field tuning. */
export const DOF_CONFIG = {
  /** Largest blur radius, as a fraction of the screen height. */
  maxBlur: 0.011,
  /** In-focus band half-width as a fraction of the focus distance. */
  focusBand: 0.32,
  /** Near-field blur relative to far-field blur (keeps foreground readable). */
  nearScale: 0.55,
  /** Fade in/out speed of the effect (1/s). */
  fadePerSec: 5,
} as const;

const dofVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const dofFragment = /* glsl */ `
#include <packing>
uniform sampler2D tDiffuse;
uniform highp sampler2D tDepth;
uniform float cameraNear;
uniform float cameraFar;
uniform float focus;
uniform float band;
uniform float maxBlur;
uniform float nearScale;
uniform float aspect;
uniform float amount;
varying vec2 vUv;

float blurAt(vec2 uv) {
  float z = -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar);
  float c = clamp((z - focus) / band, -1.0, 1.0);
  return (c < 0.0 ? -c * nearScale : c) * maxBlur * amount;
}

void main() {
  vec4 base = texture2D(tDiffuse, vUv);
  float r0 = blurAt(vUv);
  if (r0 < 0.0004) {
    gl_FragColor = base;
    return;
  }
  vec3 acc = base.rgb;
  float wsum = 1.0;
  // Golden-angle disc; a sample only counts if its own blur reaches this pixel, so sharp
  // subjects never smear over the blurred background.
  for (int i = 0; i < 16; i++) {
    float fi = float(i) + 0.5;
    float r = sqrt(fi / 16.0) * r0;
    float a = fi * 2.39996;
    vec2 uv = vUv + vec2(cos(a) / aspect, sin(a)) * r;
    float w = clamp(blurAt(uv) / max(r, 1e-4), 0.0, 1.0);
    acc += texture2D(tDiffuse, uv).rgb * w;
    wsum += w;
  }
  gl_FragColor = vec4(acc / wsum, base.a);
}`;

/**
 * Depth of field for cinematic shots: focuses on the shot's subject and blurs what is far in
 * front of or behind it. Reads the scene depth (no extra scene render). Disabled — and skipped
 * by the composer — whenever no shot is playing, so gameplay stays sharp.
 */
export class DepthOfFieldPass extends Pass {
  private readonly material: ShaderMaterial;
  private readonly quad: FullScreenQuad;
  private amountValue = 0;
  private targetAmount = 0;
  private focusDistance = 8;

  constructor(
    public camera: Camera,
    private readonly depth: SceneDepth,
  ) {
    super();
    this.material = new ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 100 },
        focus: { value: 8 },
        band: { value: 2 },
        maxBlur: { value: DOF_CONFIG.maxBlur },
        nearScale: { value: DOF_CONFIG.nearScale },
        aspect: { value: 1 },
        amount: { value: 0 },
      },
      vertexShader: dofVertex,
      fragmentShader: dofFragment,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
    this.enabled = false;
  }

  /** Current strength (0 = off). */
  get amount(): number {
    return this.amountValue;
  }

  /** Focus on a subject `distance` metres away, or null to fade the effect out. */
  setFocus(distance: number | null, dtSec: number): void {
    if (distance !== null) this.focusDistance = Math.max(0.5, distance);
    this.targetAmount = distance === null ? 0 : 1;
    const step = Math.max(0, dtSec) * DOF_CONFIG.fadePerSec;
    const a = this.amountValue;
    this.amountValue =
      a < this.targetAmount
        ? Math.min(this.targetAmount, a + step)
        : Math.max(this.targetAmount, a - step);
    this.enabled = this.amountValue > 0.001;
  }

  override setSize(width: number, height: number): void {
    const u = this.material.uniforms['aspect'];
    if (u !== undefined) u.value = width / Math.max(1, height);
  }

  override render(
    renderer: WebGLRenderer,
    writeBuffer: WebGLRenderTarget,
    readBuffer: WebGLRenderTarget,
  ): void {
    const u = this.material.uniforms;
    const cam = this.camera as PerspectiveCamera;
    set(u, 'tDiffuse', readBuffer.texture);
    set(u, 'tDepth', this.depth.texture);
    set(u, 'cameraNear', cam.near);
    set(u, 'cameraFar', cam.far);
    set(u, 'focus', this.focusDistance);
    set(u, 'band', Math.max(0.6, this.focusDistance * DOF_CONFIG.focusBand));
    set(u, 'amount', this.amountValue);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}

function set(u: ShaderMaterial['uniforms'], key: string, value: unknown): void {
  const slot = u[key];
  if (slot !== undefined) slot.value = value;
}
