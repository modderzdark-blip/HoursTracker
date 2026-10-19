/**
 * Dev-only character viewer (dev/rig-viewer.html, served by `npm run dev`; not part of the
 * build). Shows rigs side by side under battle-like lighting so character art can be judged
 * up close. URL params: rigs=kael,brann (default: all), anim=idle|run|<pose name>,
 * t=seconds to advance, yaw=radians, cols=n, dist=camera distance factor.
 */
import {
  Mesh,
  MeshNormalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Vector3,
} from 'three';
import { AnimationController } from '../anim/AnimationController';
import { buildHumanoidClips, buildActionClip } from '../anim/clipSets';
import { HumanoidRig } from '../anim/HumanoidRig';
import { POSE_LIBRARY, type PoseName } from '../anim/poses';
import { ARENAS, type ArenaId } from '../data/arenas';
import { QUALITY_PRESETS, type QualityLevel } from '../data/quality';
import { RIGS, type RigId } from '../data/rigs';
import { Atmosphere } from '../render/Atmosphere';
import { RenderContext } from '../render/RenderContext';
import { setCharacterEnvironment, createCharacterEnvironment } from '../render/characterEnv';
import { applyCharacterShading } from '../render/rimLight';

const params = new URLSearchParams(location.search);
const ids = (params.get('rigs')?.split(',') ?? Object.keys(RIGS)) as RigId[];
const animName = params.get('anim') ?? 'idle';
const advance = Number(params.get('t') ?? '0.6');
const yaw = Number(params.get('yaw') ?? '0.5');
const cols = Number(params.get('cols') ?? String(Math.min(ids.length, 6)));
const distFactor = Number(params.get('dist') ?? '1');

const canvas = document.getElementById('c') as HTMLCanvasElement;
const quality = (params.get('q') ?? 'high') as QualityLevel;
const ctx = new RenderContext(canvas, true);
ctx.setSize(window.innerWidth, window.innerHeight, 2);
const renderer = ctx.renderer;
setCharacterEnvironment(createCharacterEnvironment(renderer));
const scene = ctx.scene;
const atmosphere = new Atmosphere(ctx, ARENAS[(params.get('arena') ?? 'cinder_court') as ArenaId]);
atmosphere.applyQuality(QUALITY_PRESETS[quality]);
const floor = new Mesh(
  new PlaneGeometry(60, 60),
  new MeshStandardMaterial({ color: 0x2a2526, roughness: 0.9 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const anims: AnimationController[] = [];
let maxH = 0;
const spacing: number[] = ids.map((id) => 1.6 * Math.max(1, RIGS[id].scale));
const rows = Math.ceil(ids.length / cols);
ids.forEach((id, i) => {
  const def = RIGS[id];
  const rig = new HumanoidRig(def);
  const idle = POSE_LIBRARY['NEUTRAL'];
  const base = buildHumanoidClips(idle);
  const clips = [...base.clips];
  if (animName in POSE_LIBRARY) {
    clips.push(
      buildActionClip(
        {
          id: 'pose',
          startupMs: 200,
          activeMs: 100,
          recoveryMs: 2000,
          windPose: animName as PoseName,
          hitPose: animName as PoseName,
        } as never,
        idle,
      ),
    );
  }
  const anim = new AnimationController(rig.root, clips, base.additive);
  anim.play(animName in POSE_LIBRARY ? 'pose' : animName, { loop: true, fade: 0 });
  anims.push(anim);
  const c = i % cols;
  const r = Math.floor(i / cols);
  const w = spacing.slice(0, cols).reduce((a, b) => a + b, 0);
  let x = -w / 2;
  for (let k = 0; k < c; k++) x += spacing[k] ?? 1.6;
  x += (spacing[c] ?? 1.6) / 2;
  rig.root.position.set(x, 0, -r * 3.2);
  rig.root.rotation.y = yaw;
  rig.mesh.receiveShadow = true;
  const dbg = params.get('debug');
  if (dbg === 'normal') rig.mesh.material = new MeshNormalMaterial();
  if (dbg === 'env') {
    const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 });
    m.envMap = rig.material.envMap;
    rig.mesh.material = m;
  }
  if (dbg === 'shade') {
    const m = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1 });
    applyCharacterShading(m, 0xff8a3d, 3.2, 0.5);
    rig.mesh.material = m;
  }
  if (dbg === 'surfviz') {
    const m = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1 });
    applyCharacterShading(m, 0xff8a3d, 3.2, 0.5);
    const prev = m.onBeforeCompile.bind(m);
    m.onBeforeCompile = (sh, r) => {
      prev(sh, r);
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\ngl_FragColor = vec4(roughnessFactor, metalnessFactor, 0.0, 1.0);',
      );
    };
    m.customProgramCacheKey = () => 'surfviz';
    rig.mesh.material = m;
  }
  if (dbg === 'shade0') {
    const m = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1 });
    applyCharacterShading(m, 0xff8a3d, 3.2, 0);
    rig.mesh.material = m;
  }
  if (dbg === 'm0') {
    rig.material.metalness = 0;
    rig.material.roughness = 0.6;
  }
  if (dbg === 'plain')
    rig.mesh.material = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.6,
      metalness: 0,
    });
  scene.add(rig.root);
  maxH = Math.max(maxH, 1.9 * def.scale);
});

const camera = new PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 200);
const width = spacing.slice(0, cols).reduce((a, b) => a + b, 0);
const d = Math.max(width * 1.25, (maxH + rows * 2) * 1.6) * distFactor;
const fy = Number(params.get('fy') ?? String(maxH * 0.45));
camera.position.set(0, fy + maxH * 0.2 + 0.6 * distFactor, d);
camera.lookAt(0, fy, -(rows - 1) * 1.6);

let t = 0;
const step = 1 / 60;
while (t < advance) {
  for (const a of anims) a.update(step);
  t += step;
}
atmosphere.update(new Vector3(0, 0, 0), 0);
ctx.setBloom(QUALITY_PRESETS[quality].bloom, camera);
function frame(): void {
  ctx.render(camera);
  (window as unknown as { __viewerReady: boolean }).__viewerReady = true;
  if (params.get('live') === '1') {
    for (const a of anims) a.update(1 / 60);
    requestAnimationFrame(frame);
  }
}
frame();
