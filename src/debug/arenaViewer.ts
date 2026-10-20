/**
 * Dev-only arena viewer (dev/arena-viewer.html with `npm run dev`; not part of the build).
 * Builds an arena exactly as a battle does (layout, synthesized materials, sky, lights, post)
 * and renders it from a free camera. URL params: arena=cinder_court, q=high|medium|low,
 * cam=x,y,z (camera position), look=x,y,z (target), fov=50, t=seconds of animation.
 */
import { PerspectiveCamera, Vector3 } from 'three';
import { ARENAS, type ArenaId } from '../data/arenas';
import { QUALITY_PRESETS, type QualityLevel } from '../data/quality';
import { ArenaBuilder } from '../modes/ArenaBuilder';
import { loadRapier, PhysicsWorld } from '../physics/PhysicsWorld';
import { Atmosphere } from '../render/Atmosphere';
import { RenderContext } from '../render/RenderContext';
import { createCharacterEnvironment, setCharacterEnvironment } from '../render/characterEnv';

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
  camera.lookAt(vec(params.get('look'), [0, 1, 0]));
  ctx.setPost({ bloom: preset.bloom, grade: preset.grade }, camera);
  const steps = Math.round(Number(params.get('t') ?? '0.5') * 30);
  for (let i = 0; i < steps; i++) {
    atmosphere.update(new Vector3(0, 0, 0), 1 / 30);
    builder.update(1 / 30);
  }
  ctx.render(camera);
  const w = window as unknown as { __viewerReady: boolean; __viewerInfo: unknown };
  w.__viewerInfo = { buildMs, calls: ctx.info.calls, triangles: ctx.info.triangles };
  w.__viewerReady = true;
}

void main();
