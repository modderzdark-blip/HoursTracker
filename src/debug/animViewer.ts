/**
 * Dev-only animation filmstrip (dev/anim-viewer.html, served by `npm run dev`; not part of the
 * build). Lays out `frames` copies of one character, each advanced to a later moment of the same
 * clip, so a whole action (anticipation → strike → follow-through → recovery) reads in one
 * image. Weapon tips leave their path so far as a line, to check arcs against the slash effects.
 *
 * URL params: hero=<HeroId> | enemy=<EnemyId> | boss=<BossId> | creature=<CreatureId>,
 * clip=<clip name> (creatures: idle|run|roar|death|<motion>:tele|<motion>:strike…),
 * frames=n, from=0..1, to=0..1 (part of the clip shown), dur=seconds (default: the clip's own),
 * yaw=radians (body turn toward the camera), dist=camera distance factor, live=1 (animate),
 * dissolve=a..b (burn-away amount from the first to the last frame).
 */
import {
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Vector3,
} from 'three';
import { AnimationController } from '../anim/AnimationController';
import { enemyAnimSet, heroAnimSet, type AnimSet } from '../anim/animSets';
import type { CharacterAnimator, CharacterRig } from '../anim/characterTypes';
import { CreatureAnimator } from '../anim/creatures/CreatureAnimator';
import { CreatureRig } from '../anim/creatures/CreatureRig';
import { HumanoidRig } from '../anim/HumanoidRig';
import { ARENAS, type ArenaId } from '../data/arenas';
import { BOSSES, type BossId } from '../data/bosses';
import { CREATURES, type CreatureId, type CreatureMotion } from '../data/creatures';
import { ENEMIES, type EnemyDef, type EnemyId } from '../data/enemies';
import { HEROES, type HeroId } from '../data/heroes';
import { QUALITY_PRESETS, type QualityLevel } from '../data/quality';
import { RIGS } from '../data/rigs';
import { Atmosphere } from '../render/Atmosphere';
import { createCharacterEnvironment, setCharacterEnvironment } from '../render/characterEnv';
import { RenderContext } from '../render/RenderContext';

const params = new URLSearchParams(location.search);
const num = (k: string, d: number): number => {
  const v = params.get(k);
  return v === null ? d : Number(v);
};
const frames = Math.max(1, num('frames', 8));
const from = num('from', 0);
const to = num('to', 1);
const yaw = num('yaw', 0.9);
const distFactor = num('dist', 1);
const clipName = params.get('clip') ?? 'idle';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const quality = (params.get('q') ?? 'medium') as QualityLevel;
const ctx = new RenderContext(canvas, true);
ctx.setSize(window.innerWidth, window.innerHeight, 1);
setCharacterEnvironment(createCharacterEnvironment(ctx.renderer));
const scene = ctx.scene;
const atmosphere = new Atmosphere(ctx, ARENAS[(params.get('arena') ?? 'cinder_court') as ArenaId]);
atmosphere.applyQuality(QUALITY_PRESETS[quality]);
const floor = new Mesh(
  new PlaneGeometry(80, 80),
  new MeshStandardMaterial({ color: 0x2a2526, roughness: 0.9 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

interface Body {
  readonly rig: CharacterRig;
  readonly anim: CharacterAnimator;
}

function enemyDef(): EnemyDef | null {
  const e = params.get('enemy');
  if (e !== null) return ENEMIES[e as EnemyId];
  const b = params.get('boss');
  if (b !== null) return BOSSES[b as BossId];
  return null;
}

const MOTIONS: CreatureMotion[] = [
  'bite',
  'claw',
  'stab',
  'spit',
  'pounce',
  'charge',
  'howl',
  'breath',
  'stomp',
  'tailSwipe',
  'burrow',
  'summon',
];

function makeBody(): Body {
  const heroId = params.get('hero') as HeroId | null;
  const creature = params.get('creature') as CreatureId | null;
  const edef = enemyDef();
  if (creature !== null || edef?.creature !== undefined) {
    const def = CREATURES[creature ?? (edef?.creature as CreatureId)];
    const rig = new CreatureRig(def);
    const motions = new Map<string, CreatureMotion>(MOTIONS.map((m) => [m, m]));
    for (const a of edef?.attacks ?? []) motions.set(a.id, a.motion ?? 'bite');
    return { rig, anim: new CreatureAnimator(rig.plan, rig.bones, motions) };
  }
  let set: AnimSet;
  let rigId: keyof typeof RIGS;
  if (heroId !== null) {
    const hero = HEROES[heroId];
    if (hero.visual.kind !== 'rig') throw new Error('rig heroes only');
    set = heroAnimSet(hero);
    rigId = hero.visual.rig;
  } else if (edef !== null) {
    set = enemyAnimSet(edef);
    rigId = edef.rig;
  } else {
    throw new Error('pass hero=, enemy=, boss= or creature=');
  }
  const rig = new HumanoidRig(RIGS[rigId]);
  return { rig, anim: new AnimationController(rig.root, set.clips, set.additive) };
}

function clipDuration(anim: CharacterAnimator): number {
  const d = params.get('dur');
  if (d !== null) return Number(d);
  const natural = anim.clipDuration(clipName);
  return natural > 0 ? natural : 1.2;
}

const tipMat = new LineBasicMaterial({ color: 0xff5030 });
const tipMatL = new LineBasicMaterial({ color: 0x40c0ff });
const bodies: Body[] = [];
const scale = Math.max(1, params.get('creature') === null ? 1 : 1.4);
let spacing = 1.25;
const tmp = new Vector3();
const loop = params.get('loop') === '1' || clipName === 'idle' || clipName === 'run';
for (let i = 0; i < frames; i++) {
  const body = makeBody();
  bodies.push(body);
  const s = body.rig.def.scale;
  spacing = Math.max(spacing, 1.6 * s * scale * num('gap', 1));
}
const width = spacing * (frames - 1);
bodies.forEach((b, i) => {
  const root = b.rig.root;
  root.position.set(-width / 2 + i * spacing, 0, 0);
  root.rotation.y = yaw;
  scene.add(root);
  const dur = clipDuration(b.anim);
  b.anim.play(clipName, { loop, fade: 0, durationSec: dur, restart: true });
  const k = frames === 1 ? to : from + ((to - from) * i) / (frames - 1);
  // dissolve=a..b: burn-away amount across the strip (checks the death shader).
  const dis = params.get('dissolve')?.split('..').map(Number);
  if (dis !== undefined) b.rig.setDissolve((dis[0] ?? 0) + ((dis[1] ?? 1) - (dis[0] ?? 0)) * k);
  const target = k * dur;
  const step = 1 / 120;
  const path: number[] = [];
  const pathL: number[] = [];
  let t = 0;
  // Advance in small steps so springs (cloth) and events behave as in game.
  for (;;) {
    const h = Math.min(step, target - t);
    b.anim.update(Math.max(h, 1e-5));
    b.rig.updateSecondary(Math.max(h, 1e-5), 0, 0, 0);
    root.updateMatrixWorld(true);
    b.rig.socketWorld('rightTip', tmp);
    path.push(tmp.x, tmp.y, tmp.z);
    b.rig.socketWorld('leftTip', tmp);
    pathL.push(tmp.x, tmp.y, tmp.z);
    t += h;
    if (t >= target - 1e-6) break;
  }
  if (params.get('trail') !== '0') {
    for (const [pts, mat] of [
      [path, tipMat],
      [pathL, tipMatL],
    ] as const) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
      scene.add(new Line(g, mat));
    }
  }
});

let maxH = 0;
for (const b of bodies) maxH = Math.max(maxH, b.rig.height);
const camera = new PerspectiveCamera(
  num('fov', 14),
  window.innerWidth / window.innerHeight,
  0.1,
  300,
);
// Fit the strip horizontally and the tallest body vertically.
const halfH = Math.tan((camera.fov * Math.PI) / 360);
const halfW = halfH * camera.aspect;
const d = Math.max((width + spacing * 1.2) / (2 * halfW), (maxH * 1.5) / (2 * halfH)) * distFactor;
camera.position.set(0, maxH * 0.55 + num('cy', 0.4), d);
camera.lookAt(0, maxH * 0.45, 0);
// Extra key + fill so poses read clearly (the arena lighting is tuned for gameplay distance).
const key = new DirectionalLight(0xfff0e0, 2.2);
key.position.set(-4, 8, 6);
scene.add(key, new HemisphereLight(0xb0b8d0, 0x302828, 1.4));
atmosphere.update(new Vector3(0, 0, 0), 0);
ctx.setBloom(QUALITY_PRESETS[quality].bloom, camera);

function frame(): void {
  ctx.render(camera);
  (window as unknown as { __viewerReady: boolean }).__viewerReady = true;
  (window as unknown as { __bodies: Body[] }).__bodies = bodies;
  if (params.get('live') === '1') {
    for (const b of bodies) {
      b.anim.update(1 / 60);
      b.rig.updateSecondary(1 / 60, 0, 0, 0);
    }
    requestAnimationFrame(frame);
  }
}
frame();
