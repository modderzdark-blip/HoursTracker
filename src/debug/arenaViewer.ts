/**
 * Dev-only arena viewer (dev/arena-viewer.html with `npm run dev`; not part of the build).
 * Builds an arena exactly as a battle does (layout, synthesized materials, sky, lights, post)
 * and renders it from a free camera. URL params: arena=cinder_court, q=high|medium|low,
 * cam=x,y,z (camera position), look=x,y,z (target), fov=50, t=seconds of animation,
 * fx=slash,ring,... (effects spawned in a row along x) and fxt=seconds into them,
 * hero=kael (a hero in idle stance at the look target, to judge readability against the floor).
 */
import {
  InstancedMesh,
  Mesh,
  PerspectiveCamera,
  Points,
  Vector3,
  type BufferGeometry,
  type InstancedBufferGeometry,
} from 'three';
import { AnimationController } from '../anim/AnimationController';
import { buildHumanoidClips } from '../anim/clipSets';
import { HumanoidRig } from '../anim/HumanoidRig';
import { POSE_LIBRARY } from '../anim/poses';
import { ARENAS, type ArenaId } from '../data/arenas';
import { RIGS, type RigId } from '../data/rigs';
import { QUALITY_PRESETS, type QualityLevel } from '../data/quality';
import { ArenaBuilder } from '../modes/ArenaBuilder';
import { loadRapier, PhysicsWorld } from '../physics/PhysicsWorld';
import { Atmosphere } from '../render/Atmosphere';
import { RenderContext } from '../render/RenderContext';
import { createCharacterEnvironment, setCharacterEnvironment } from '../render/characterEnv';
import { Fx, type FxShape } from '../vfx/Fx';

const params = new URLSearchParams(location.search);
const arena = ARENAS[(params.get('arena') ?? 'cinder_court') as ArenaId];
const quality = (params.get('q') ?? 'high') as QualityLevel;
const preset = QUALITY_PRESETS[quality];
const vec = (s: string | null, d: [number, number, number]): Vector3 => {
  const p = (s ?? '').split(',').map(Number);
  return new Vector3(p[0] ?? d[0], p[1] ?? d[1], p[2] ?? d[2]);
};

async function main(): Promise<void> {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const ctx = new RenderContext(canvas, preset.antialias);
  ctx.setSize(window.innerWidth, window.innerHeight, preset.maxPixelRatio);
  setCharacterEnvironment(createCharacterEnvironment(ctx.renderer));
  const physics = new PhysicsWorld(await loadRapier());
  const t0 = performance.now();
  const builder = new ArenaBuilder(arena, physics, preset, ctx.renderer);
  const buildMs = performance.now() - t0;
  builder.addTo(ctx.scene);
  const atmosphere = new Atmosphere(ctx, arena);
  atmosphere.applyQuality(preset);
  const camera = new PerspectiveCamera(
    Number(params.get('fov') ?? '50'),
    window.innerWidth / window.innerHeight,
    0.1,
    120,
  );
  camera.position.copy(vec(params.get('cam'), [0, 9, 22]));
  const target = vec(params.get('look'), [0, 1, 0]);
  camera.lookAt(target);
  const heroId = params.get('hero') as RigId | null;
  if (heroId !== null && heroId in RIGS) {
    const rig = new HumanoidRig(RIGS[heroId]);
    rig.root.position.set(target.x, 0, target.z);
    rig.root.rotation.y = 0.5;
    rig.mesh.castShadow = true;
    rig.mesh.receiveShadow = true;
    ctx.scene.add(rig.root);
    const clips = buildHumanoidClips(POSE_LIBRARY['NEUTRAL']);
    const anim = new AnimationController(rig.root, clips.clips, clips.additive);
    anim.play('idle', { loop: true, fade: 0 });
    for (let i = 0; i < 30; i++) anim.update(1 / 30);
  }
  ctx.setPost({ bloom: preset.bloom, grade: preset.grade }, camera);
  const fxList = (params.get('fx') ?? '').split(',').filter((x) => x !== '') as FxShape[];
  if (fxList.length > 0) {
    const fx = new Fx(ctx.scene);
    const color = Number(params.get('fxc') ?? '0xff8a3d');
    fxList.forEach((shape, i) => {
      const x = (i - (fxList.length - 1) / 2) * 4;
      fx.spawn(shape, {
        x,
        y: shape === 'slash' || shape === 'flash' || shape === 'nova' ? 1 : 0,
        z: 0,
        yaw: 0.6,
        tilt: shape === 'slash' && i % 2 === 1 ? Math.PI / 2 : -0.2,
        scale: shape === 'pillar' ? 0.8 : 1.8,
        color,
        life: 1,
      });
    });
    fx.smokeBurst(0, 0.5, 2, 12, 1.5, 0.15);
    const fxt = Number(params.get('fxt') ?? '0.3');
    for (let i = 0; i < Math.round(fxt * 30); i++) fx.update(1 / 30);
  }
  const steps = Math.round(Number(params.get('t') ?? '0.5') * 30);
  for (let i = 0; i < steps; i++) {
    atmosphere.update(new Vector3(0, 0, 0), 1 / 30);
    builder.update(1 / 30);
  }
  ctx.render(camera);
  // Whole-arena totals (independent of what this camera sees): drawn objects and triangles.
  let arenaDraws = 0;
  let arenaTriangles = 0;
  const breakdown: Record<string, number> = {};
  for (const root of builder.objects) {
    root.traverse((o) => {
      if (!o.visible) return;
      if (o instanceof Points) {
        arenaDraws++;
        return;
      }
      if (!(o instanceof Mesh)) return;
      const g = o.geometry as BufferGeometry;
      const verts = g.index?.count ?? g.getAttribute('position').count;
      const instances =
        o instanceof InstancedMesh
          ? o.count
          : 'instanceCount' in g
            ? (g as InstancedBufferGeometry).instanceCount
            : 1;
      arenaDraws++;
      const tris = (verts / 3) * (Number.isFinite(instances) ? instances : 1);
      arenaTriangles += tris;
      breakdown[o.name] = Math.round((breakdown[o.name] ?? 0) + tris);
    });
  }
  const w = window as unknown as { __viewerReady: boolean; __viewerInfo: unknown };
  w.__viewerInfo = {
    buildMs,
    calls: ctx.info.calls,
    triangles: ctx.info.triangles,
    arenaDraws,
    arenaTriangles: Math.round(arenaTriangles),
    breakdown,
  };
  w.__viewerReady = true;
}

void main();
