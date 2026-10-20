import {
  Color,
  LinearMipmapLinearFilter,
  LinearFilter,
  Mesh,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { SYNTH_FRAGMENT, SYNTH_MATERIAL, SYNTH_VERTEX, type SynthMaterialId } from './synthShaders';

export interface SynthSpec {
  readonly material: SynthMaterialId;
  /** Main tone, secondary (moss / soot / ash), accent (grout / mortar / crack). Linear-ish hex. */
  readonly colors: readonly [number, number, number];
  readonly seed: number;
  readonly normalStrength: number;
}

/** A synthesized PBR set: sRGB albedo, tangent-space normal, ORM (R occlusion, G roughness). */
export interface MaterialMaps {
  readonly albedo: Texture;
  readonly normal: Texture;
  readonly orm: Texture;
  dispose(): void;
}

const PASSES = { albedo: 0, normal: 1, orm: 2 } as const;

/**
 * Renders tileable PBR maps on the GPU from the material programs in synthShaders.ts. Each map
 * is one full-screen pass into a mip-mapped render target (the albedo target stores sRGB, so dark
 * stone keeps its gradations), done once when an arena loads.
 */
export class TextureSynth {
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: ShaderMaterial;
  private readonly quad: Mesh;

  constructor(private readonly renderer: WebGLRenderer) {
    this.material = new ShaderMaterial({
      vertexShader: SYNTH_VERTEX,
      fragmentShader: SYNTH_FRAGMENT,
      uniforms: {
        uMat: { value: 0 },
        uPass: { value: 0 },
        uSeed: { value: 0 },
        uSize: { value: 512 },
        uNormalStrength: { value: 1 },
        uColorA: { value: new Color() },
        uColorB: { value: new Color() },
        uColorC: { value: new Color() },
        uEncode: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** Renders one material at `size`² and returns its three maps. */
  build(spec: SynthSpec, size: number, anisotropy: number): MaterialMaps {
    const maps = {
      albedo: this.pass(spec, size, PASSES.albedo, true, anisotropy),
      normal: this.pass(spec, size, PASSES.normal, false, anisotropy),
      orm: this.pass(spec, size, PASSES.orm, false, anisotropy),
    };
    return {
      albedo: maps.albedo.texture,
      normal: maps.normal.texture,
      orm: maps.orm.texture,
      dispose: () => {
        maps.albedo.dispose();
        maps.normal.dispose();
        maps.orm.dispose();
      },
    };
  }

  /**
   * Renders one map into a plain 8-bit target with sRGB-encoded albedo and reads the pixels back
   * (offline baking to image files).
   */
  bakePixels(spec: SynthSpec, size: number, pass: keyof typeof PASSES): Uint8Array {
    const rt = new WebGLRenderTarget(size, size, { depthBuffer: false });
    this.setUniforms(spec, size, PASSES[pass], 1);
    this.draw(rt);
    const out = new Uint8Array(size * size * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, size, size, out);
    rt.dispose();
    return out;
  }

  dispose(): void {
    this.material.dispose();
    this.quad.geometry.dispose();
  }

  private pass(
    spec: SynthSpec,
    size: number,
    pass: number,
    srgb: boolean,
    anisotropy: number,
  ): WebGLRenderTarget {
    const rt = new WebGLRenderTarget(size, size, {
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
      wrapS: RepeatWrapping,
      wrapT: RepeatWrapping,
      colorSpace: srgb ? SRGBColorSpace : NoColorSpace,
      anisotropy,
    });
    this.setUniforms(spec, size, pass, 0);
    this.draw(rt);
    return rt;
  }

  private setUniforms(spec: SynthSpec, size: number, pass: number, encode: number): void {
    const u = this.material.uniforms;
    const set = (name: string, value: unknown): void => {
      const slot = u[name];
      if (slot !== undefined) slot.value = value;
    };
    set('uMat', SYNTH_MATERIAL[spec.material]);
    set('uPass', pass);
    set('uSeed', spec.seed);
    set('uSize', size);
    set('uNormalStrength', spec.normalStrength);
    set('uEncode', encode);
    // Colours are authored as display hex; the shader works in linear light.
    (u['uColorA']?.value as Color).setHex(spec.colors[0]);
    (u['uColorB']?.value as Color).setHex(spec.colors[1]);
    (u['uColorC']?.value as Color).setHex(spec.colors[2]);
  }

  private draw(rt: WebGLRenderTarget): void {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevAutoClear = r.autoClear;
    const prevShadow = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.autoClear = true;
    r.setRenderTarget(rt);
    r.render(this.scene, this.camera);
    r.setRenderTarget(prevTarget);
    r.autoClear = prevAutoClear;
    r.shadowMap.autoUpdate = prevShadow;
  }
}
