import {
  CylinderGeometry,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PointLight,
  Scene,
  Color,
  TorusGeometry,
  Vector3,
  type AnimationClip,
  type BufferGeometry,
  type Material,
  type WebGLRenderer,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { AnimationController } from '../anim/AnimationController';
import { buildActionClip, buildCustomActionClip, buildHumanoidClips } from '../anim/clipSets';
import { HumanoidRig } from '../anim/HumanoidRig';
import { POSE_LIBRARY } from '../anim/poses';
import type { HeroDef } from '../data/heroes';
import { RIGS } from '../data/rigs';
import { EmberField } from '../vfx/EmberField';
import { Flames } from '../vfx/Flames';
import { GroundFog } from '../vfx/GroundFog';
import type { ColorGrade } from '../render/GradePass';
import { Sky } from '../render/env/Sky';
import { cliffRingGeometry, columnGeometry, rockGeometry } from '../render/env/shapes';
import { TextureSynth, type MaterialMaps } from '../render/env/TextureSynth';
import { createTriplanarMaterial } from '../render/env/triplanar';

const FLOURISH_EVERY_SEC = 7;

/**
 * The hub backdrop: the selected hero idling on a carved stone dais in a moonlit ruined shrine
 * (columns, braziers with live fire, mist, cliffs, sky), with a slow camera drift. Owns its
 * scene and camera; materials are synthesized once.
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
  private readonly focus = new Vector3(0, 1.05, 0);
  private readonly sky: Sky;
  private readonly flames: Flames;
  private readonly mist: GroundFog;
  private readonly maps: MaterialMaps[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  readonly grade: ColorGrade = {
    shadowTint: 0x080a18,
    highlightTint: 0x1a0c00,
    saturation: 1.1,
    contrast: 1.08,
    vignette: 0.5,
  };

  constructor(renderer: WebGLRenderer) {
    const s = this.scene;
    s.background = new Color(0x07060a);
    s.fog = new FogExp2(0x120c10, 0.045);
    s.add(new HemisphereLight(0x5a4a70, 0x1a0c08, 0.9));
    const key = new DirectionalLight(0xffd2a0, 2.6);
    key.position.set(-3, 5, 4);
    s.add(key);
    const rim = new DirectionalLight(0x8090ff, 1.6);
    rim.position.set(3, 3, -4);
    s.add(rim);
    this.fire = new PointLight(0xff7a2a, 12, 7);
    this.fire.position.set(0, 0.4, 1.2);
    s.add(this.fire);

    const synth = new TextureSynth(renderer);
    const floorMaps = synth.build(
      { material: 'flagstone', colors: [0x5a514a, 0x1e1612, 0x120e0b], seed: 3, normalStrength: 6 },
      512,
      4,
    );
    const stoneMaps = synth.build(
      { material: 'rock', colors: [0x7a706a, 0x2a2624, 0x1c1816], seed: 107, normalStrength: 2.5 },
      512,
      4,
    );
    const rockMaps = synth.build(
      { material: 'rock', colors: [0x6a6260, 0x3a4a30, 0x111111], seed: 11, normalStrength: 6 },
      512,
      4,
    );
    synth.dispose();
    this.maps.push(floorMaps, stoneMaps, rockMaps);
    const floorMat = this.mat(createTriplanarMaterial(floorMaps, { scale: 0.3, flat: true }));
    const stoneMat = this.mat(createTriplanarMaterial(stoneMaps, { scale: 0.6, macro: 0.2 }));
    const rockMat = this.mat(createTriplanarMaterial(rockMaps, { scale: 0.3, macro: 0.3 }));

    // Dais: a stepped round platform of dressed stone.
    const daisGeo = this.geo(
      mergeGeometries(
        [
          new CylinderGeometry(1.6, 1.7, 0.2, 48).translate(0, -0.1, 0),
          new CylinderGeometry(2.3, 2.4, 0.2, 48).translate(0, -0.3, 0),
        ].map((g) => {
          g.deleteAttribute('uv');
          return g;
        }),
        false,
      ) ?? new CylinderGeometry(1.6, 1.85, 0.35, 40),
    );
    this.dais = new Mesh(daisGeo, stoneMat);
    s.add(this.dais);
    // Ember inlay around the top of the dais.
    this.ring = new Mesh(
      new TorusGeometry(1.5, 0.022, 6, 72),
      new MeshBasicMaterial({ color: new Color(0xff7a2a).multiplyScalar(1.6) }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.005;
    s.add(this.ring);
    const floor = new Mesh(this.geo(new CylinderGeometry(30, 30, 0.1, 64)), floorMat);
    floor.position.y = -0.45;
    s.add(floor);
    // Ruined colonnade behind the hero, cliffs and a few boulders further out.
    const cols = [
      { x: -3.2, z: -3.4, h: 6.5, broken: false },
      { x: 0.4, z: -4.6, h: 4.2, broken: true },
      { x: 3.6, z: -3.2, h: 6.5, broken: false },
      { x: -5.6, z: 0.2, h: 2.6, broken: true },
    ];
    const colGeo = this.geo(
      mergeGeometries(
        cols.map((c, i) => columnGeometry(51 + i, c.broken, c.h, 0.55).translate(c.x, -0.45, c.z)),
        false,
      ) ?? new CylinderGeometry(0.5, 0.5, 5, 12),
    );
    s.add(new Mesh(colGeo, stoneMat));
    const rocks = this.geo(rockGeometry(3, 3));
    for (const [x, z, k] of [
      [-6.5, -5, 1.6],
      [6.8, -5.5, 2],
      [7.5, 1.5, 1.2],
    ] as const) {
      const r = new Mesh(rocks, rockMat);
      r.position.set(x, -0.2, z);
      r.scale.set(k * 1.2, k, k);
      s.add(r);
    }
    s.add(new Mesh(this.geo(cliffRingGeometry(16, 14, 5, 96, 12)), rockMat).translateY(-0.5));
    this.sky = new Sky({
      zenith: 0x080c1c,
      horizon: 0x3a3048,
      moon: 0xb8c8ff,
      moonDir: [-0.6, 0.5, -0.8],
      stars: 1,
      clouds: 0.45,
      cloudColor: 0x4a4458,
    });
    s.add(this.sky.mesh);
    // Braziers either side of the dais.
    const iron = this.mat(new MeshBasicMaterial({ color: 0x0c0a0a }));
    const stand = this.geo(new CylinderGeometry(0.06, 0.12, 1.1, 8).translate(0, 0.1, 0));
    const bowl = this.geo(
      new CylinderGeometry(0.36, 0.14, 0.26, 12, 1, true).translate(0, 0.72, 0),
    );
    const spots: { x: number; y: number; z: number; size: number }[] = [];
    for (const x of [-2.6, 2.6]) {
      const st = new Mesh(stand, iron);
      st.position.set(x, -0.45, -1.4);
      const bw = new Mesh(bowl, iron);
      bw.position.copy(st.position);
      s.add(st, bw);
      spots.push({ x, y: 0.3, z: -1.4, size: 0.6 });
    }
    this.flames = new Flames(spots, 0xff7a2a);
    s.add(this.flames.mesh);
    this.mist = new GroundFog(9, 0x2a2232, 0.3);
    for (const m of this.mist.meshes) {
      m.position.y -= 0.42;
      s.add(m);
    }
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
    this.camera.position.set(Math.sin(a) * 4.5, 1.85, Math.cos(a) * 4.5);
    this.camera.lookAt(this.focus);
    this.fire.intensity = 11 + Math.sin(this.time * 9) * 0.8 + Math.sin(this.time * 21) * 0.6;
    this.embers.update(dtSec, this.focus);
    this.sky.update(dtSec, this.camera.position);
    this.flames.update(dtSec);
    this.mist.update(dtSec);
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
    this.ring.geometry.dispose();
    (this.ring.material as MeshBasicMaterial).dispose();
    this.embers.dispose();
    this.sky.dispose();
    this.flames.dispose();
    this.mist.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const m of this.maps) m.dispose();
  }

  private geo<T extends BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private mat<T extends Material>(m: T): T {
    this.materials.push(m);
    return m;
  }
}
