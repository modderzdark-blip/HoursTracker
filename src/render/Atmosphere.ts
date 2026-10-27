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
import { ARENA_LOOKS } from '../data/arenaLooks';
import type { ArenaDef, ArenaId } from '../data/arenas';
import { Sky } from './env/Sky';
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
  readonly sky: Sky;
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
  /** Lightning: seconds to the next strike, seconds since the last, strike direction. */
  private nextStrike = 4;
  private sinceStrike = 99;
  /** Strikes only while a cinematic shot plays (BattleMode sets it each frame). */
  lightningOn = true;
  private strikeAngle = 0;
  private strikeSeed = 0;

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
    const look = ARENA_LOOKS[arena.id as ArenaId];
    const s = look.sky;
    this.sky = new Sky({
      zenith: s.zenith,
      horizon: s.horizon,
      moon: s.open ? s.moon : 0x000000,
      moonDir: l.moonDirection,
      stars: s.stars,
      clouds: s.clouds,
      cloudColor: s.cloudColor,
    });
    scene.add(this.sky.mesh);
    ctx.setGrade(look.grade);

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
    // Softer PCF penumbra on Ultra (wider Vogel-disc taps; same tap count).
    this.moon.shadow.radius = preset.shadowRadius;
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
    this.sky.update(dtSec, focus);
    this.updateLightning(dtSec);
    const base = this.arena.lighting.brazierIntensity;
    for (let i = 0; i < this.braziers.length; i++) {
      const light = this.braziers[i];
      if (light === undefined || !light.visible) continue;
      const t = this.time * 9 + (this.flicker[i] ?? 0);
      light.intensity = base * (0.86 + Math.sin(t) * 0.07 + Math.sin(t * 2.3 + 1.7) * 0.07);
    }
  }

  /**
   * Distant lightning in open-sky arenas: a bolt and a glow in the clouds, only while a
   * cinematic shot plays (`lightningOn`); the arena lighting stays steady.
   */
  private updateLightning(dtSec: number): void {
    const bolt = ARENA_LOOKS[this.arena.id as ArenaId].fx.lightning;
    if (bolt === null) return;
    if (!this.lightningOn) {
      // A strike caught at the top of the gameplay view reads as a random screen flicker.
      if (this.sinceStrike < 1) this.sky.setFlash(0, 0, 0.32, -1, bolt.color, this.strikeSeed);
      this.sinceStrike = 1;
      return;
    }
    this.sinceStrike += dtSec;
    this.nextStrike -= dtSec;
    if (this.nextStrike <= 0) {
      this.nextStrike = bolt.every * (0.5 + Math.random());
      this.sinceStrike = 0;
      // Strikes land beyond the north half, where the camera looks.
      this.strikeAngle = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      this.strikeSeed = Math.random() * 100;
    }
    const t = this.sinceStrike;
    const f =
      Math.max(0, 1 - t / 0.12) +
      0.7 * Math.max(0, 1 - Math.abs(t - 0.28) / 0.09) +
      0.3 * Math.max(0, 1 - Math.abs(t - 0.5) / 0.1);
    // Only the sky lights up: brightening the scene lights read as a random screen flicker from
    // the gameplay camera, which rarely sees the sky.
    this.sky.setFlash(
      Math.min(1, f),
      Math.cos(this.strikeAngle),
      0.32,
      Math.sin(this.strikeAngle),
      bolt.color,
      this.strikeSeed,
    );
  }

  dispose(): void {
    this.sky.dispose();
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
