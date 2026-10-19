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
import { BLOOM_CONFIG } from '../data/quality';

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
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  contextLost = false;

  constructor(
    readonly canvas: HTMLCanvasElement,
    antialias: boolean,
  ) {
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
    return this.composer !== null;
  }

  get currentPixelRatio(): number {
    return this.pixelRatio;
  }

  get drawingBufferSize(): [number, number] {
    return [Math.round(this.width * this.pixelRatio), Math.round(this.height * this.pixelRatio)];
  }

  setSize(width: number, height: number, maxPixelRatio: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    if (this.composer !== null) {
      this.composer.setPixelRatio(this.pixelRatio);
      this.composer.setSize(this.width, this.height);
    }
  }

  setBloom(enabled: boolean, camera: Camera): void {
    if (enabled === this.bloomEnabled) return;
    if (!enabled) {
      this.disposeComposer();
      return;
    }
    const isWebGL2 = this.renderer.capabilities.isWebGL2;
    const target = new WebGLRenderTarget(
      this.width * this.pixelRatio,
      this.height * this.pixelRatio,
      { type: HalfFloatType, samples: isWebGL2 ? 4 : 0 },
    );
    const composer = new EffectComposer(this.renderer, target);
    composer.setPixelRatio(this.pixelRatio);
    composer.setSize(this.width, this.height);
    this.renderPass = new RenderPass(this.scene, camera);
    const res = new Vector2(
      this.width * BLOOM_CONFIG.resolutionScale,
      this.height * BLOOM_CONFIG.resolutionScale,
    );
    this.bloomPass = new UnrealBloomPass(
      res,
      BLOOM_CONFIG.strength,
      BLOOM_CONFIG.radius,
      BLOOM_CONFIG.threshold,
    );
    composer.addPass(this.renderPass);
    composer.addPass(this.bloomPass);
    composer.addPass(new OutputPass());
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
    this.composer.dispose();
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
    this.composer = null;
    this.renderPass = null;
    this.bloomPass = null;
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
