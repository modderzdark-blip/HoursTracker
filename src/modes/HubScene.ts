import {
  CylinderGeometry,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PointLight,
  Scene,
  Color,
  TorusGeometry,
  Vector3,
  type AnimationClip,
} from 'three';
import { AnimationController } from '../anim/AnimationController';
import { buildActionClip, buildCustomActionClip, buildHumanoidClips } from '../anim/clipSets';
import { HumanoidRig } from '../anim/HumanoidRig';
import { POSE_LIBRARY } from '../anim/poses';
import type { HeroDef } from '../data/heroes';
import { RIGS } from '../data/rigs';
import { EmberField } from '../vfx/EmberField';

const FLOURISH_EVERY_SEC = 7;

/**
 * The hub backdrop: the selected hero idling on an ember-lit dais, with a slow camera drift.
 * Small and cheap (a handful of draw calls); owns its scene and camera.
 */
export class HubScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(38, 1, 0.1, 80);
  private rig: HumanoidRig | null = null;
  private anim: AnimationController | null = null;
  private flourishes: string[] = [];
  private flourishIndex = 0;
  private timer = 0;
  private time = 0;
  private heroId = '';
  private readonly embers: EmberField;
  private readonly dais: Mesh;
  private readonly ring: Mesh;
  private readonly fire: PointLight;
  private readonly focus = new Vector3(0, 1, 0);

  constructor() {
    const s = this.scene;
    s.background = new Color(0x07060a);
    s.fog = new FogExp2(0x120c10, 0.06);
    s.add(new HemisphereLight(0x5a4a70, 0x1a0c08, 0.9));
    const key = new DirectionalLight(0xffd2a0, 2.2);
    key.position.set(-3, 5, 4);
    s.add(key);
    const rim = new DirectionalLight(0x8090ff, 1.6);
    rim.position.set(3, 3, -4);
    s.add(rim);
    this.fire = new PointLight(0xff7a2a, 12, 7);
    this.fire.position.set(0, 0.4, 1.2);
    s.add(this.fire);

    this.dais = new Mesh(
      new CylinderGeometry(1.6, 1.85, 0.35, 40),
      new MeshStandardMaterial({ color: 0x2c2628, roughness: 0.85, metalness: 0.05 }),
    );
    this.dais.position.y = -0.175;
    s.add(this.dais);
    this.ring = new Mesh(
      new TorusGeometry(1.62, 0.025, 6, 64),
      new MeshBasicMaterial({ color: 0xff7a2a }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.01;
    s.add(this.ring);
    this.embers = new EmberField(90, 0xff7a2a, 4);
    s.add(this.embers.points);
  }

  /** Shows `hero` on the dais (rebuilds the rig only when the hero changes). */
  setHero(hero: HeroDef): void {
    if (hero.id === this.heroId) return;
    this.heroId = hero.id;
    this.disposeRig();
    if (hero.visual.kind !== 'rig') return;
    const rig = new HumanoidRig(RIGS[hero.visual.rig]);
    const idle = POSE_LIBRARY[hero.idlePose];
    const base = buildHumanoidClips(idle);
    const clips: AnimationClip[] = [...base.clips];
    this.flourishes = [];
    for (const a of [hero.combo[0], hero.combo[1], hero.skills[1]]) {
      if (a === undefined) continue;
      const clip =
        a.clip !== undefined ? buildCustomActionClip(a.clip, a, idle) : buildActionClip(a, idle);
      clips.push(clip);
      this.flourishes.push(clip.name);
    }
    this.anim = new AnimationController(rig.root, clips, base.additive);
    this.anim.play('idle', { loop: true, fade: 0 });
    rig.root.rotation.y = 0.35;
    this.scene.add(rig.root);
    this.rig = rig;
    this.timer = FLOURISH_EVERY_SEC * 0.5;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    // Keep the hero on the left third so the menu on the right never covers it.
    this.camera.setViewOffset(1000 * aspect, 1000, 1000 * aspect * 0.17, 0, 1000 * aspect, 1000);
    this.camera.updateProjectionMatrix();
  }

  update(dtSec: number): void {
    this.time += dtSec;
    const a = Math.sin(this.time * 0.12) * 0.25;
    this.camera.position.set(Math.sin(a) * 5.4, 2.1, Math.cos(a) * 5.4);
    this.camera.lookAt(this.focus);
    this.fire.intensity = 11 + Math.sin(this.time * 9) * 0.8 + Math.sin(this.time * 21) * 0.6;
    this.embers.update(dtSec, this.focus);
    const anim = this.anim;
    if (anim === null) return;
    this.timer -= dtSec;
    if (this.timer <= 0 && this.flourishes.length > 0) {
      this.timer = FLOURISH_EVERY_SEC;
      const name = this.flourishes[this.flourishIndex++ % this.flourishes.length] ?? 'idle';
      anim.play(name, { durationSec: 0.9, fade: 0.12, restart: true });
    }
    if (anim.playing !== 'idle' && this.timer < FLOURISH_EVERY_SEC - 1.1) {
      anim.play('idle', { loop: true, fade: 0.3 });
    }
    anim.update(dtSec);
    this.rig?.updateSecondary(dtSec, 0, 0, 0);
  }

  private disposeRig(): void {
    this.anim?.dispose();
    this.rig?.dispose();
    this.anim = null;
    this.rig = null;
  }

  dispose(): void {
    this.disposeRig();
    this.dais.geometry.dispose();
    (this.dais.material as MeshStandardMaterial).dispose();
    this.ring.geometry.dispose();
    (this.ring.material as MeshBasicMaterial).dispose();
    this.embers.dispose();
  }
}
