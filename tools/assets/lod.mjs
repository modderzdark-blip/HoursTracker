// Lighter versions of processed models: public/assets/models/<id>.glb -> <id>_<lod>.glb with
// fewer triangles and smaller textures: `far` for backdrop terrain and cliffs seen across an
// arena, `mid` for cliff walls lining it (many copies, seen from a few metres).
//
// Usage: node tools/assets/lod.mjs   (rewrites every version listed in LODS below)

import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dequantize,
  meshopt,
  prune,
  simplify,
  textureCompress,
  weld,
} from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

/** Model, version: triangle budget and texture edge (px). */
const LODS = [
  ['mountainside', 'far', 3000, 512],
  ['mountainside', 'mid', 7000, 1024],
  ['namaqualand_cliff_01', 'far', 2500, 512],
  ['namaqualand_cliff_02', 'far', 3000, 512],
  ['namaqualand_cliff_02', 'mid', 6000, 1024],
  ['rock_face_01', 'far', 1500, 512],
  ['rock_face_02', 'far', 1500, 512],
];

const DIR = 'public/assets/models';

function triangles(doc) {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const p of mesh.listPrimitives()) tris += (p.getIndices()?.getCount() ?? 0) / 3;
  return Math.round(tris);
}

async function main() {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });
  for (const [id, lod, budget, texSize] of LODS) {
    const doc = await io.read(join(DIR, `${id}.glb`));
    const before = triangles(doc);
    await doc.transform(
      dequantize(),
      weld(),
      simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, budget / before), error: 0.02 }),
      textureCompress({
        encoder: sharp,
        targetFormat: 'webp',
        resize: [texSize, texSize],
        quality: 80,
      }),
      prune(),
    );
    const after = triangles(doc);
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    await io.write(join(DIR, `${id}_${lod}.glb`), doc);
    console.log(`${id}_${lod}: ${before} -> ${after} triangles`);
  }
}

await main();
