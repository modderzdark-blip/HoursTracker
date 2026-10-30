import {
  ACESFilmicToneMapping,
  DepthTexture,
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
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BLOOM_CONFIG, resolvePixelRatio } from '../data/quality';
import {
  AmbientOcclusionPass,
  DepthOfFieldPass,
  DepthTapPass,
  SceneDepth,
} from './CinematicPasses';
import { DEFAULT_GRADE, GradePass, type ColorGrade } from './GradePass';

/** Post chain request. The optional passes default to off (tools only ask for bloom/grade). */
export interface PostRequest {
  readonly bloom: boolean;
  readonly grade: boolean;
  /** Ambient occlusion from the scene depth (Ultra). */
  readonly ao?: boolean;
  /** Depth of field during cinematic shots (High, Ultra). */
  readonly dof?: boolean;
  /** Film tone curve in the grade (Ultra). */
  readonly film?: boolean;
  readonly bloomQuality?: 'standard' | 'fine';
}

export interface FrameRenderInfo {
  calls: number;
  triangles: number;
  points: number;
  lines: number;
}

/**
 * Owns the WebGLRenderer, the scene and the optional post-processing chain.
 * Without bloom we render straight to the canvas (tone mapping + sRGB applied by the renderer).
 * With bloom, RenderPass → [cinematic DoF] → [AO] → UnrealBloomPass → OutputPass (tone mapping +
 * sRGB in OutputPass) → [grade], on a 4× MSAA half-float target. AO and DoF read the scene's own
 * depth texture, so they never render the scene twice.
 */
export class RenderContext {
  readonly renderer: WebGLRenderer;
  private currentScene = new Scene();
  readonly info: FrameRenderInfo = { calls: 0, triangles: 0, points: 0, lines: 0 };
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private gradePass: GradePass | null = null;
  private aoPass: AmbientOcclusionPass | null = null;
  private dofPass: DepthOfFieldPass | null = null;
  private readonly sceneDepth = new SceneDepth();
  private post: Required<PostRequest> = {
    bloom: false,
    grade: false,
    ao: false,
    dof: false,
    film: false,
    bloomQuality: 'standard',
  };
  private grade: ColorGrade = DEFAULT_GRADE;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  /** The preset's pixel-ratio cap (decides MSAA vs FXAA on dense screens). */
  private maxPixelRatio = 2;
  /** Antialiasing the current chain was built with. */
  private chainAa: 'msaa' | 'fxaa' | 'none' = 'none';
  private fxaaPass: FXAAPass | null = null;
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
    // Release builds skip the per-shader error query: it makes the browser wait for each shader
    // to finish compiling the moment it is first used (seconds of stalls on phone GPUs).
    this.renderer.debug.checkShaderErrors = import.meta.env.DEV;
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
    if (this.aoPass !== null) this.aoPass.scene = scene;
  }

  get bloomEnabled(): boolean {
    return this.bloomPass !== null;
  }

  get aoEnabled(): boolean {
    return this.aoPass !== null;
  }

  /** True when this chain can blur cinematic shots. */
  get dofAvailable(): boolean {
    return this.dofPass !== null;
  }

  /** 0..1 strength of the cinematic depth of field right now. */
  get dofAmount(): number {
    return this.dofPass?.amount ?? 0;
  }

  /**
   * Cinematic depth of field: focus `distance` metres from the camera while a shot plays, null
   * to fade back to a sharp image. No-op on presets without it.
   */
  setCinematicFocus(distance: number | null, dtSec: number): void {
    this.dofPass?.setFocus(distance, dtSec);
  }

  /**
   * Renders one frame with every post pass on (the cinematic depth of field at zero strength
   * too), so all post shaders compile now rather than at the first cinematic shot.
   */
  renderWarm(camera: Camera): void {
    const dof = this.dofPass;
    const was = dof?.enabled ?? false;
    if (dof !== null) dof.enabled = true;
    this.render(camera);
    if (dof !== null) dof.enabled = was;
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
    this.maxPixelRatio = maxPixelRatio;
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
    if (this.bloomPass !== null) this.bloomPass.strength = this.effectiveBloomStrength();
  }

  /** Shorthand kept for tools: bloom on/off with grading following it. */
  setBloom(enabled: boolean, camera: Camera): void {
    this.setPost({ bloom: enabled, grade: enabled }, camera);
  }

  /** Momentary screen flash / colour fringing (needs the grading pass: Medium and High). */
  setScreenFx(r: number, g: number, b: number, aberration: number): void {
    this.gradePass?.setScreenFx(r, g, b, aberration);
  }

  /** Colour grade for the current scene (each arena has its own). */
  setGrade(grade: ColorGrade): void {
    this.grade = grade;
    this.gradePass?.setGrade(grade);
  }

  private effectiveBloomStrength(): number {
    const fine = this.post.bloomQuality === 'fine';
    return this.bloomStrength * (fine ? BLOOM_CONFIG.fine.strengthMult : 1);
  }

  /**
   * Post-processing chain: RenderPass → [DoF] → [AO] → [bloom] → OutputPass (tone mapping +
   * sRGB) → [grade]. With neither bloom nor grading the scene renders straight to the canvas.
   */
  setPost(request: PostRequest, camera: Camera): void {
    const grade = request.grade;
    const chain = request.bloom || grade;
    const post: Required<PostRequest> = {
      bloom: request.bloom,
      grade,
      // The depth effects need the full-screen chain.
      ao: chain && request.ao === true,
      dof: chain && request.dof === true,
      film: grade && request.film === true,
      bloomQuality: request.bloomQuality ?? 'standard',
    };
    const p = this.post;
    const aa = this.chainAntialias();
    if (
      aa === this.chainAa &&
      post.bloom === p.bloom &&
      post.grade === p.grade &&
      post.ao === p.ao &&
      post.dof === p.dof &&
      post.film === p.film &&
      post.bloomQuality === p.bloomQuality &&
      (this.composer !== null) === chain
    )
      return;
    this.disposeComposer();
    this.post = post;
    this.chainAa = aa;
    if (!chain) return;
    const depthEffects = post.ao || post.dof;
    const target = new WebGLRenderTarget(
      this.width * this.pixelRatio,
      this.height * this.pixelRatio,
      {
        type: HalfFloatType,
        samples: aa === 'msaa' ? 4 : 0,
        // AO / DoF read the scene depth (resolved from MSAA with the colour, as before).
        depthTexture: depthEffects ? new DepthTexture(1, 1) : null,
      },
    );
    const composer = new EffectComposer(this.renderer, target);
    composer.setPixelRatio(this.pixelRatio);
    composer.setSize(this.width, this.height);
    this.renderPass = new RenderPass(this.scene, camera);
    composer.addPass(this.renderPass);
    if (depthEffects) {
      composer.addPass(new DepthTapPass(this.sceneDepth));
      const initial = composer.renderTarget2.depthTexture;
      // DoF must come straight after the scene render. It samples the scene's depth texture,
      // and after AO's swap its write target would be the scene target itself, whose depth that
      // is: a framebuffer feedback loop. ANGLE drops the draw; phone GPUs show a black screen
      // for the whole cinematic shot (Ultra only, where AO runs). AO's own draws into the chain
      // never sample that depth (only its internal half-res passes do), so it can follow.
      if (post.dof) {
        this.dofPass = new DepthOfFieldPass(camera, this.sceneDepth);
        composer.addPass(this.dofPass);
      }
      if (post.ao && initial !== null) {
        this.aoPass = new AmbientOcclusionPass(this.scene, camera, this.sceneDepth, initial);
        composer.addPass(this.aoPass);
      }
    }
    if (post.bloom) {
      const fine = post.bloomQuality === 'fine';
      const tune = fine ? BLOOM_CONFIG.fine : BLOOM_CONFIG;
      const res = new Vector2(
        this.width * tune.resolutionScale,
        this.height * tune.resolutionScale,
      );
      this.bloomPass = new UnrealBloomPass(
        res,
        this.effectiveBloomStrength(),
        tune.radius,
        tune.threshold,
      );
      composer.addPass(this.bloomPass);
    }
    composer.addPass(new OutputPass());
    if (post.grade) {
      this.gradePass = new GradePass(this.grade, post.film ? 0.016 : 0.018, post.film);
      composer.addPass(this.gradePass);
    }
    if (aa === 'fxaa') {
      this.fxaaPass = new FXAAPass();
      composer.addPass(this.fxaaPass);
    }
    this.composer = composer;
  }

  /**
   * Antialiasing for the post chain. 4× MSAA on a half-float target is the most expensive part
   * of the scene pass; on dense phone screens (≥ 1.75 device pixels per CSS pixel) the edges are
   * already fine, so one cheap FXAA pass at the end gives the same look for a fraction of it.
   */
  private chainAntialias(): 'msaa' | 'fxaa' | 'none' {
    if (!this.msaa) return 'none';
    const dpr = Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1;
    return Math.min(dpr, this.maxPixelRatio) >= 1.75 ? 'fxaa' : 'msaa';
  }

  render(camera: Camera): void {
    if (this.contextLost) return;
    this.renderer.info.reset();
    if (this.composer !== null) {
      if (this.renderPass !== null) this.renderPass.camera = camera;
      if (this.aoPass !== null) this.aoPass.camera = camera;
      if (this.dofPass !== null) this.dofPass.camera = camera;
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
    this.post = { ...this.post, bloom: false, grade: false, ao: false, dof: false, film: false };
    if (this.composer === null) return;
    this.bloomPass?.dispose();
    this.fxaaPass?.dispose();
    this.fxaaPass = null;
    this.gradePass?.dispose();
    this.aoPass?.dispose();
    this.dofPass?.dispose();
    this.composer.renderTarget1.depthTexture?.dispose();
    this.composer.renderTarget2.depthTexture?.dispose();
    this.composer.dispose();
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
    this.composer = null;
    this.renderPass = null;
    this.bloomPass = null;
    this.gradePass = null;
    this.aoPass = null;
    this.dofPass = null;
    this.sceneDepth.texture = null;
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
