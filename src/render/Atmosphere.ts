import {
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  type Object3D,
  PMREMGenerator,
  PointLight,
  Vector3,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { ArenaDef } from '../data/arenas';
import type { QualityPreset } from '../data/quality';
import type { RenderContext } from './RenderContext';

/**
 * Lighting rig + atmosphere: moonlight key (the single shadow caster) with a tight frustum that
 * follows the player and snaps to shadow-map texels (no shimmering), ember rim from the rim
 * shader, hemisphere fill, PMREM environment for PBR reflections, exponential fog, and brazier
 * point lights that are switched off on LOW.
 */
export class Atmosphere {
  readonly moon: DirectionalLight;
  readonly hemi: HemisphereLight;
  readonly braziers: PointLight[] = [];
  private readonly envMap: Texture;
  private readonly scene: Scene;
  private readonly lightDir = new Vector3();
  private readonly basisRight = new Vector3();
  private readonly basisUp = new Vector3();
  private readonly snapped = new Vector3();
  private frustumHalf = 10;
  private mapSize = 1024;
  private readonly flicker: number[] = [];
  private time = 0;

  constructor(
    private readonly ctx: RenderContext,
    private readonly arena: ArenaDef,
  ) {
    const scene = ctx.scene;
    this.scene = scene;
    const p = arena.palette;
    const l = arena.lighting;
    scene.background = new Color(p.background);
    scene.fog = new FogExp2(p.fog, p.fogDensity);

    this.envMap = createEnvironment(ctx.renderer);
    scene.environment = this.envMap;
    scene.environmentIntensity = l.environmentIntensity;

    this.hemi = new HemisphereLight(p.hemiSky, p.hemiGround, l.hemiIntensity);
    scene.add(this.hemi);

    this.moon = new DirectionalLight(p.moonlight, l.moonIntensity);
    this.lightDir.set(l.moonDirection[0], l.moonDirection[1], l.moonDirection[2]).normalize();
    this.moon.shadow.bias = -0.0004;
    this.moon.shadow.normalBias = 0.03;
    this.moon.shadow.camera.near = 0.5;
    this.moon.shadow.camera.far = 60;
    scene.add(this.moon);
    scene.add(this.moon.target);

    // Light-space basis used for texel snapping.
    const worldUp = Math.abs(this.lightDir.y) > 0.99 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
    this.basisRight.crossVectors(worldUp, this.lightDir).normalize();
    this.basisUp.crossVectors(this.lightDir, this.basisRight).normalize();

    for (const b of arena.braziers) {
      const light = new PointLight(p.ember, l.brazierIntensity, l.brazierRange, 2);
      light.position.set(b.x, 1.6, b.z);
      scene.add(light);
      this.braziers.push(light);
      this.flicker.push(Math.random() * 100);
    }
  }

  applyQuality(preset: QualityPreset): void {
    const renderer = this.ctx.renderer;
    const shadowsChanged = renderer.shadowMap.enabled !== preset.shadows;
    renderer.shadowMap.enabled = preset.shadows;
    this.moon.castShadow = preset.shadows;
    if (this.mapSize !== preset.shadowMapSize || shadowsChanged) {
      this.mapSize = preset.shadowMapSize;
      this.moon.shadow.mapSize.set(this.mapSize, this.mapSize);
      // Force the shadow map to be re-created at the new size.
      this.moon.shadow.map?.dispose();
      this.moon.shadow.map = null;
    }
    this.frustumHalf = preset.shadowFrustumHalfSize;
    const cam = this.moon.shadow.camera;
    cam.left = -this.frustumHalf;
    cam.right = this.frustumHalf;
    cam.top = this.frustumHalf;
    cam.bottom = -this.frustumHalf;
    cam.updateProjectionMatrix();
    for (const b of this.braziers) b.visible = preset.pointLights;
    if (shadowsChanged) markMaterialsDirty(this.scene);
  }

  /** Centre the shadow frustum on the focus point, snapped to whole shadow texels. */
  update(focus: Vector3, dtSec: number): void {
    const texel = (this.frustumHalf * 2) / this.mapSize;
    const u = focus.dot(this.basisRight);
    const v = focus.dot(this.basisUp);
    const du = Math.round(u / texel) * texel - u;
    const dv = Math.round(v / texel) * texel - v;
    this.snapped.copy(focus).addScaledVector(this.basisRight, du).addScaledVector(this.basisUp, dv);
    this.moon.target.position.copy(this.snapped);
    this.moon.position.copy(this.snapped).addScaledVector(this.lightDir, 30);

    this.time += dtSec;
    const base = this.arena.lighting.brazierIntensity;
    for (let i = 0; i < this.braziers.length; i++) {
      const light = this.braziers[i];
      if (light === undefined || !light.visible) continue;
      const t = this.time * 9 + (this.flicker[i] ?? 0);
      light.intensity = base * (0.86 + Math.sin(t) * 0.07 + Math.sin(t * 2.3 + 1.7) * 0.07);
    }
  }

  dispose(): void {
    this.envMap.dispose();
    this.moon.shadow.map?.dispose();
    this.moon.dispose();
    this.hemi.dispose();
    for (const b of this.braziers) b.dispose();
  }
}

function createEnvironment(renderer: WebGLRenderer): Texture {
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const texture = pmrem.fromScene(room, 0.04).texture;
  room.dispose();
  pmrem.dispose();
  return texture;
}

function markMaterialsDirty(root: Object3D): void {
  root.traverse((obj) => {
    const material = (obj as Object3D & { material?: unknown }).material;
    if (material === undefined || material === null) return;
    const list = Array.isArray(material) ? material : [material];
    for (const m of list) {
      if (typeof m === 'object' && m !== null && 'needsUpdate' in m) {
        (m as { needsUpdate: boolean }).needsUpdate = true;
      }
    }
  });
}
