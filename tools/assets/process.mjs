// Turns the raw Poly Haven download (polyhaven-assets.zip, unpacked) into game-ready files:
//
//   public/assets/surfaces/<id>/{albedo,normal,orm}.webp   tileable PBR sets for floors / walls
//   public/assets/models/<id>.glb                          props: simplified to a triangle budget,
//                                                          textures resized and stored as WebP,
//                                                          geometry meshopt-compressed
//
// Usage: node tools/assets/process.mjs <unpacked-dir>
// Budgets are per asset (phones): see MODELS below. Everything is CC0 (polyhaven.com).

import { mkdirSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const SURFACE_SIZE = 1024;

/** Tileable surfaces (floors, walls, cliffs). */
export const SURFACES = [
  'brown_mud_rocks_01',
  'castle_brick_broken_06',
  'castle_wall_varriation',
  'cobblestone_floor_07',
  'cobblestone_square',
  'cracked_red_ground',
  'dark_brick_wall',
  'dry_ground_rocks',
  'forest_ground_04',
  'marble_mosaic_tiles',
  'monastery_stone_floor',
  'mossy_cobblestone',
  'mossy_rock',
  'mud_cracked_dry_03',
  'patterned_slate_tiles',
  'red_mud_stones',
  'rock_boulder_cracked',
  'rock_pitted_mossy',
  'rock_wall_08',
  'rock_wall_13',
  'slate_floor',
  'stone_tiles_02',
  'stone_wall_04',
  'volcanic_rock_tiles',
];

/** Props: triangle budget and texture edge (px). */
export const MODELS = {
  antique_estoc: [1200, 512],
  brass_candleholders: [3000, 512],
  caged_hanging_light: [3000, 512],
  dead_tree_trunk: [6000, 1024],
  dead_tree_trunk_02: [6000, 1024],
  dry_branches_medium_01: [2500, 512],
  gothic_statue: [8000, 1024],
  kite_shield: [1500, 512],
  lantern_chandelier_01: [3000, 512],
  large_castle_door: [4000, 1024],
  large_iron_gate: [6000, 1024],
  marble_bust_01: [3000, 512],
  modular_fort_01: [30000, 1024],
  namaqualand_boulders_01: [4000, 1024],
  pine_roots: [6000, 1024],
  rock_07: [2500, 1024],
  rock_09: [2500, 1024],
  rock_face_01: [5000, 1024],
  rock_face_02: [5000, 1024],
  rock_moss_set_01: [6000, 1024],
  rock_moss_set_02: [6000, 1024],
  root_cluster_01: [6000, 1024],
  stone_01: [3000, 512],
  stone_fire_pit: [2000, 512],
  treasure_chest: [4000, 1024],
  tree_stump_01: [4000, 1024],
  tree_stump_02: [4000, 1024],
  wine_barrel_01: [2500, 512],
  wooden_barrels_01: [6000, 512],
  wooden_candlestick: [800, 512],
  wooden_crate_01: [2500, 512],
  wooden_lantern_01: [2500, 512],
  worn_metal_rack: [2500, 512],
};

function find(dir, re) {
  const f = readdirSync(dir).find((n) => re.test(n));
  return f === undefined ? null : join(dir, f);
}

async function surface(src, id, out) {
  const tex = join(src, id, 'textures');
  const diff = find(tex, /_diff_1k\.jpg$/);
  const nor = find(tex, /_nor_gl_1k\.jpg$/);
  const arm = find(tex, /_arm_1k\.jpg$/);
  const rough = find(tex, /_rough_1k\.jpg$/);
  if (diff === null || nor === null || (arm === null && rough === null))
    throw new Error(`${id}: missing maps`);
  const dst = join(out, 'surfaces', id);
  mkdirSync(dst, { recursive: true });
  const fit = (p) => sharp(p).resize(SURFACE_SIZE, SURFACE_SIZE, { fit: 'fill' });
  await fit(diff).webp({ quality: 82 }).toFile(join(dst, 'albedo.webp'));
  await fit(nor).webp({ quality: 90 }).toFile(join(dst, 'normal.webp'));
  // The arena material reads ORM as R = occlusion, G = roughness, B = glow mask (lava cracks,
  // inlays). Scanned surfaces have no glow, so blue is cleared (their B is metalness, ~0 anyway).
  const n = SURFACE_SIZE * SURFACE_SIZE;
  const rgb = Buffer.alloc(n * 3);
  if (arm !== null) {
    const a = await fit(arm).removeAlpha().raw().toBuffer();
    for (let i = 0; i < n; i++) {
      rgb[i * 3] = a[i * 3];
      rgb[i * 3 + 1] = a[i * 3 + 1];
    }
  } else {
    const g = await fit(rough).greyscale().raw().toBuffer();
    for (let i = 0; i < n; i++) {
      rgb[i * 3] = 255;
      rgb[i * 3 + 1] = g[i];
    }
  }
  await sharp(rgb, { raw: { width: SURFACE_SIZE, height: SURFACE_SIZE, channels: 3 } })
    .webp({ quality: 88 })
    .toFile(join(dst, 'orm.webp'));
  return { id };
}

async function model(io, src, id, out) {
  const [budget, texSize] = MODELS[id];
  const gltf = find(join(src, id), /\.gltf$/);
  const doc = await io.read(gltf);
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const p of mesh.listPrimitives()) tris += (p.getIndices()?.getCount() ?? 0) / 3;
  const ratio = Math.min(1, budget / Math.max(1, tris));
  await MeshoptSimplifier.ready;
  await doc.transform(
    dedup(),
    weld(),
    ...(ratio < 1 ? [simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.05 })] : []),
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [texSize, texSize],
      quality: 84,
    }),
    prune(),
  );
  let after = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const p of mesh.listPrimitives()) after += (p.getIndices()?.getCount() ?? 0) / 3;
  // Quantized, meshopt-compressed geometry (EXT_meshopt_compression; decoded at load).
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  mkdirSync(join(out, 'models'), { recursive: true });
  await io.write(join(out, 'models', `${id}.glb`), doc);
  return { id, tris: Math.round(tris), after: Math.round(after) };
}

async function main() {
  const src = process.argv[2];
  const out = 'public/assets';
  if (src === undefined || !existsSync(src)) throw new Error('usage: process.mjs <unpacked-dir>');
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });
  const report = { surfaces: [], models: [] };
  for (const id of SURFACES) report.surfaces.push(await surface(src, id, out));
  for (const id of Object.keys(MODELS)) {
    const r = await model(io, src, id, out);
    report.models.push(r);
    console.log(`${id}: ${r.tris} -> ${r.after} triangles`);
  }
  writeFileSync('tools/assets/processed.json', JSON.stringify(report, null, 1) + '\n');
}

await main();
