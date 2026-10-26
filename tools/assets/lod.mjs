// Distant-view versions of processed models: public/assets/models/<id>.glb -> <id>_far.glb with
// fewer triangles and smaller textures, for backdrop terrain and cliffs seen across an arena.
//
// Usage: node tools/assets/lod.mjs   (rewrites every model listed in FAR below)

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

/** Model: triangle budget and texture edge (px) of its far version. */
const FAR = {
  mountainside: [3000, 512],
  namaqualand_cliff_01: [2500, 512],
  namaqualand_cliff_02: [3000, 512],
  rock_face_01: [1500, 512],
  rock_face_02: [1500, 512],
};

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
  for (const [id, [budget, texSize]] of Object.entries(FAR)) {
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
    await io.write(join(DIR, `${id}_far.glb`), doc);
    console.log(`${id}: ${before} -> ${after} triangles`);
  }
}

await main();
