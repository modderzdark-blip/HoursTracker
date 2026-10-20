import {
  ACESFilmicToneMapping,
  HalfFloatType,
  PCFShadowMap,
  Scene,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
  type Camera,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BLOOM_CONFIG, resolvePixelRatio } from '../data/quality';
import { DEFAULT_GRADE, GradePass, type ColorGrade } from './GradePass';

export interface FrameRenderInfo {
  calls: number;
  triangles: number;
  points: number;
  lines: number;
}

/**
 * Owns the WebGLRenderer, the scene and the optional post-processing chain.
 * Without bloom we render straight to the canvas (tone mapping + sRGB applied by the renderer).
 * With bloom, RenderPass → UnrealBloomPass → OutputPass (tone mapping + sRGB in OutputPass), on
 * a 4× MSAA half-float target.
 */
export class RenderContext {
  readonly renderer: WebGLRenderer;
  private currentScene = new Scene();
  readonly info: FrameRenderInfo = { calls: 0, triangles: 0, points: 0, lines: 0 };
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private gradePass: GradePass | null = null;
  private grade: ColorGrade = DEFAULT_GRADE;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private bloomStrength: number = BLOOM_CONFIG.strength;
  contextLost = false;

  constructor(
    readonly canvas: HTMLCanvasElement,
    /** MSAA on the canvas, and on the post-processing target when post effects are on. */
    private readonly msaa: boolean,
  ) {
    const antialias = msaa;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias,
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = PCFShadowMap;
    // We reset render info once per frame ourselves so shadow + post passes are summed.
    this.renderer.info.autoReset = false;

    canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored, false);
  }

  /** The scene being rendered (each battle and the hub own their own scene). */
  get scene(): Scene {
    return this.currentScene;
  }

  setScene(scene: Scene): void {
    this.currentScene = scene;
    if (this.renderPass !== null) this.renderPass.scene = scene;
  }

  get bloomEnabled(): boolean {
    return this.bloomPass !== null;
  }

  get currentPixelRatio(): number {
    return this.pixelRatio;
  }

  get drawingBufferSize(): [number, number] {
    return [Math.round(this.width * this.pixelRatio), Math.round(this.height * this.pixelRatio)];
  }

  /**
   * @param maxPixelRatio the quality preset's cap on the device pixel ratio
   * @param renderScale resolution scale setting (0.5..1) applied on top of that cap
   */
  setSize(width: number, height: number, maxPixelRatio: number, renderScale = 1): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.pixelRatio = resolvePixelRatio(window.devicePixelRatio, maxPixelRatio, renderScale);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    if (this.composer !== null) {
      this.composer.setPixelRatio(this.pixelRatio);
      this.composer.setSize(this.width, this.height);
    }
  }

  /** Bloom intensity (lowered by "Reduce flashes"); applies now and to a bloom pass made later. */
  setBloomStrength(strength: number): void {
    this.bloomStrength = Math.max(0, strength);
    if (this.bloomPass !== null) this.bloomPass.strength = this.bloomStrength;
  }

  /** Shorthand kept for tools: bloom on/off with grading following it. */
  setBloom(enabled: boolean, camera: Camera): void {
    this.setPost({ bloom: enabled, grade: enabled }, camera);
  }

  /** Colour grade for the current scene (each arena has its own). */
  setGrade(grade: ColorGrade): void {
    this.grade = grade;
    this.gradePass?.setGrade(grade);
  }

  /**
   * Post-processing chain: RenderPass → [bloom] → OutputPass (tone mapping + sRGB) → [grade].
   * With neither effect the scene renders straight to the canvas.
   */
  setPost(post: { readonly bloom: boolean; readonly grade: boolean }, camera: Camera): void {
    if (
      post.bloom === (this.bloomPass !== null) &&
      post.grade === (this.gradePass !== null) &&
      (this.composer !== null) === (post.bloom || post.grade)
    )
      return;
    this.disposeComposer();
    if (!post.bloom && !post.grade) return;
    const target = new WebGLRenderTarget(
      this.width * this.pixelRatio,
      this.height * this.pixelRatio,
      { type: HalfFloatType, samples: this.msaa ? 4 : 0 },
    );
    const composer = new EffectComposer(this.renderer, target);
    composer.setPixelRatio(this.pixelRatio);
    composer.setSize(this.width, this.height);
    this.renderPass = new RenderPass(this.scene, camera);
    composer.addPass(this.renderPass);
    if (post.bloom) {
      const res = new Vector2(
        this.width * BLOOM_CONFIG.resolutionScale,
        this.height * BLOOM_CONFIG.resolutionScale,
      );
      this.bloomPass = new UnrealBloomPass(
        res,
        this.bloomStrength,
        BLOOM_CONFIG.radius,
        BLOOM_CONFIG.threshold,
      );
      composer.addPass(this.bloomPass);
    }
    composer.addPass(new OutputPass());
    if (post.grade) {
      this.gradePass = new GradePass(this.grade);
      composer.addPass(this.gradePass);
    }
    this.composer = composer;
  }

  render(camera: Camera): void {
    if (this.contextLost) return;
    this.renderer.info.reset();
    if (this.composer !== null) {
      if (this.renderPass !== null) this.renderPass.camera = camera;
      this.composer.render();
    } else {
      this.renderer.render(this.scene, camera);
    }
    const r = this.renderer.info.render;
    this.info.calls = r.calls;
    this.info.triangles = r.triangles;
    this.info.points = r.points;
    this.info.lines = r.lines;
  }

  dispose(): void {
    this.disposeComposer();
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost, false);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored, false);
    this.renderer.dispose();
  }

  private disposeComposer(): void {
    if (this.composer === null) return;
    this.bloomPass?.dispose();
    this.gradePass?.dispose();
    this.composer.dispose();
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
    this.composer = null;
    this.renderPass = null;
    this.bloomPass = null;
    this.gradePass = null;
  }

  private readonly onContextLost = (e: Event): void => {
    // preventDefault tells the browser we want the context restored.
    e.preventDefault();
    this.contextLost = true;
    console.error('[render] WebGL context lost');
  };

  private readonly onContextRestored = (): void => {
    this.contextLost = false;
    console.warn('[render] WebGL context restored');
  };
}
