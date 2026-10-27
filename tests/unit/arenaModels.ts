import { NodeIO, type Material as GltfMaterial } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import { BoxGeometry, MeshStandardMaterial, Vector3 } from 'three';
import type { AssetLibrary, ModelPart } from '../../src/render/env/AssetLibrary';

/**
 * The real scanned models as the game sees them, minus the meshes: one box per glTF mesh node
 * with the node's true bounds and pivot, its material identity and its triangle count. Lets the
 * unit tests place arenas with real footprints (colliders, camera clearance) and count real
 * triangles and draw calls without a GPU.
 */
export interface ModelInfo {
  readonly parts: ModelPart[];
  /** Triangles per node. */
  readonly tris: Map<string, number>;
  readonly total: number;
}

/** Relative to the repository root (where the tests run). */
const DIR = 'public/assets/models/';
const cache = new Map<string, ModelInfo>();
let io: NodeIO | null = null;

async function reader(): Promise<NodeIO> {
  if (io !== null) return io;
  await MeshoptDecoder.ready;
  io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  return io;
}

export async function loadModelInfo(id: string): Promise<ModelInfo> {
  const hit = cache.get(id);
  if (hit !== undefined) return hit;
  const doc = await (await reader()).read(`${DIR}${id}.glb`);
  const mats = new Map<GltfMaterial | null, MeshStandardMaterial>();
  const parts: ModelPart[] = [];
  const tris = new Map<string, number>();
  let total = 0;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (mesh === null) continue;
    let t = 0;
    for (const p of mesh.listPrimitives())
      t += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0) / 3;
    total += t;
    tris.set(node.getName(), t);
    const b = getBounds(node);
    const w = node.getWorldMatrix();
    const offset = new Vector3(w[12], w[13], w[14]);
    const size = b.max.map((v, i) => Math.max(0.001, v - (b.min[i] ?? 0)));
    const geometry = new BoxGeometry(size[0], size[1], size[2]);
    geometry.translate(
      ((b.min[0] ?? 0) + (b.max[0] ?? 0)) / 2 - offset.x,
      ((b.min[1] ?? 0) + (b.max[1] ?? 0)) / 2 - offset.y,
      ((b.min[2] ?? 0) + (b.max[2] ?? 0)) / 2 - offset.z,
    );
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const key = mesh.listPrimitives()[0]?.getMaterial() ?? null;
    let material = mats.get(key);
    if (material === undefined) {
      material = new MeshStandardMaterial();
      mats.set(key, material);
    }
    parts.push({ node: node.getName(), geometry, material, offset });
  }
  const info = { parts, tris, total };
  cache.set(id, info);
  return info;
}

/** A library serving the loaded model infos (load them first). */
export function boxLibrary(): AssetLibrary {
  return {
    model(id: string): readonly ModelPart[] | undefined {
      return cache.get(id)?.parts;
    },
  } as unknown as AssetLibrary;
}

/** Triangles of a whole model or of one node of it. */
export function modelTris(id: string, node?: string): number {
  const info = cache.get(id);
  if (info === undefined) throw new Error(`model ${id} not loaded`);
  return node === undefined ? info.total : (info.tris.get(node) ?? 0);
}
