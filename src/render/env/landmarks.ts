import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  ConeGeometry,
  CylinderGeometry,
  LatheGeometry,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mulberry32 } from '../../core/random';
import { erode, groundAo, mergeParts, place, prep, type PropParts } from './props';
import { fbm, ridged } from './shapes';

/**
 * Geometry for the arenas' signature landmarks and their larger pieces: a gatehouse tower and
 * portcullis, a floating obelisk, a distant volcano, the ribs of a colossal beast, glowing
 * mushrooms and cave puddles. Same conventions as props.ts (indexed, position / normal /
 * colour with baked occlusion, metres, standing on y = 0).
 */

function block(w: number, h: number, d: number, ao = 1): BufferGeometry {
  return prep(new RoundedBoxGeometry(w, h, d, 1, Math.min(w, h, d) * 0.06), ao);
}

/**
 * A square gatehouse tower (`w` wide, `h` tall): coursed block shell with a plinth, a string
 * course, arrow slits (dark) and a crenellated crown with corbels.
 */
export function towerGeometry(seed: number, w: number, h: number): BufferGeometry {
  const rand = mulberry32(seed);
  const parts: BufferGeometry[] = [];
  parts.push(place(block(w * 1.12, 1.0, w * 1.12, 0.6), 0, 0.5, 0));
  const courses = Math.round(h / 1.1);
  const ch = (h - 1.0) / courses;
  for (let k = 0; k < courses; k++) {
    const inset = (rand() - 0.5) * 0.06;
    parts.push(
      place(block(w + inset, ch * 0.98, w + inset, 0.8 + rand() * 0.2), 0, 1 + ch * (k + 0.5), 0),
    );
  }
  parts.push(place(block(w * 1.08, 0.35, w * 1.08, 0.75), 0, h * 0.62, 0));
  // Corbelled parapet and merlons.
  parts.push(place(block(w * 1.2, 0.5, w * 1.2, 0.7), 0, h + 0.25, 0));
  const per = 4;
  for (let side = 0; side < 4; side++) {
    for (let k = 0; k < per; k++) {
      const t = (k + 0.5) / per - 0.5;
      const a = (side * Math.PI) / 2;
      const ox = Math.cos(a) * w * 0.55 - Math.sin(a) * t * w * 1.1;
      const oz = Math.sin(a) * w * 0.55 + Math.cos(a) * t * w * 1.1;
      if (rand() < 0.15) continue;
      parts.push(place(block(0.55, 0.8 + rand() * 0.2, 0.55, 0.9), ox, h + 0.9, oz, 0, a, 0));
    }
  }
  const g = mergeParts(parts);
  // Arrow slits: dark vertical bands on the inward face.
  const pos = g.getAttribute('position');
  const col = g.getAttribute('color');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const x = pos.getX(i);
    if (
      pos.getZ(i) > w * 0.45 &&
      Math.abs(x) < 0.12 &&
      ((y > h * 0.35 && y < h * 0.5) || (y > h * 0.72 && y < h * 0.84))
    )
      col.setXYZ(i, 0.08, 0.08, 0.08);
  }
  erode(g, 0.05, 1.5, seed);
  return groundAo(g, 0, 2.5, 0.6);
}

/** A portcullis grid (`w` × `h`, bars 0.12 m, spiked bottom), centred on x, base at y = 0. */
export function portcullisGeometry(w: number, h: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const nv = Math.round(w / 0.55);
  for (let k = 0; k <= nv; k++) {
    const x = -w / 2 + (k / nv) * w;
    const bar = prep(new CylinderGeometry(0.06, 0.06, h, 5, 1), 0.85);
    bar.translate(x, h / 2, 0);
    const spike = prep(new ConeGeometry(0.08, 0.35, 5), 0.9);
    spike.rotateX(Math.PI);
    spike.translate(x, -0.17, 0);
    parts.push(bar, spike);
  }
  const nh = Math.round(h / 0.7);
  for (let k = 0; k <= nh; k++) {
    const bar = prep(new CylinderGeometry(0.05, 0.05, w + 0.1, 5, 1), 0.8);
    bar.rotateZ(Math.PI / 2);
    bar.translate(0, 0.2 + (k / nh) * (h - 0.3), 0.07);
    parts.push(bar);
  }
  return mergeParts(parts);
}

/**
 * An inverted obelisk for the floating spire: an octagonal shaft tapering to a point at the
 * bottom (origin at the tip, `len` long), a broken crown and raised rune bands; plus the glow
 * part (the rune band inlays).
 */
export function floatingSpireGeometry(seed: number, len: number, radius: number): PropParts {
  const pts: Vector2[] = [];
  const prof: [number, number][] = [
    [0, 0],
    [0.25, 0.08],
    [0.55, 0.3],
    [0.8, 0.62],
    [1.0, 0.9],
    [1.05, 0.93],
    [0.95, 0.97],
    [0.6, 1.0],
  ];
  for (const [r, t] of prof) pts.push(new Vector2(r * radius, t * len));
  const shaft = prep(new LatheGeometry(pts, 8));
  const pos = shaft.getAttribute('position');
  const col = shaft.getAttribute('color');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = y / len;
    // Jagged broken crown and pitted faces.
    const n = ridged(pos.getX(i) * 0.8 + seed, y * 0.4, pos.getZ(i) * 0.8, 3);
    const top = t > 0.95 ? n * radius * 0.5 : 0;
    pos.setY(i, y - top);
    const ao = 0.55 + 0.45 * Math.min(1, t * 1.4) * (0.75 + n * 0.3);
    col.setXYZ(i, ao, ao, ao);
  }
  shaft.computeVertexNormals();
  const parts: BufferGeometry[] = [shaft];
  const glow: BufferGeometry[] = [];
  for (const t of [0.3, 0.5, 0.7]) {
    const r = radius * (0.25 + t * 0.8) * 1.02;
    const band = prep(new CylinderGeometry(r * 1.08, r * 1.02, len * 0.035, 8, 1, true), 0.8);
    band.translate(0, t * len, 0);
    parts.push(band);
    const ring = prep(new TorusGeometry(r * 1.1, 0.05, 4, 16), 1);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, t * len, 0);
    glow.push(ring);
  }
  return { parts: { stone: mergeParts(parts), glow: mergeParts(glow) } };
}

/**
 * A distant volcano: a ridged cone with a broken crater rim (`radius` at the base, `height`
 * tall) and glowing lava streams running down from the crater (glow part).
 */
export function volcanoGeometry(seed: number, radius: number, height: number): PropParts {
  const cone = prep(new CylinderGeometry(radius * 0.16, radius, height, 48, 10, true));
  cone.translate(0, height / 2, 0);
  const pos = cone.getAttribute('position');
  const col = cone.getAttribute('color');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const t = y / height;
    const gully = ridged(Math.cos(a) * 3 + seed, Math.sin(a) * 3, t * 2, 4);
    const k = 1 + (gully - 0.5) * 0.18 + fbm(x * 0.05, y * 0.05, z * 0.05, 3) * 0.1;
    const rim = t > 0.97 ? fbm(Math.cos(a) * 2 + seed, Math.sin(a) * 2, 0, 2) * height * 0.06 : 0;
    pos.setXYZ(i, x * k, y + rim, z * k);
    const ao = 0.4 + 0.6 * (0.5 + gully * 0.5);
    col.setXYZ(i, ao, ao, ao);
  }
  cone.computeVertexNormals();
  const rand = mulberry32(seed);
  const streams: BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + (rand() - 0.5) * 1.6;
    const pts: Vector3[] = [];
    for (let j = 0; j <= 6; j++) {
      const t = 0.98 - j * 0.13 - rand() * 0.03;
      const r = radius * (0.16 + (1 - t) * 0.84) * 1.01;
      const aa = a + Math.sin(j * 1.3 + k) * 0.06;
      pts.push(new Vector3(Math.cos(aa) * r, t * height, Math.sin(aa) * r));
    }
    streams.push(prep(new TubeGeometry(new CatmullRomCurve3(pts), 24, radius * 0.012, 4, false)));
  }
  const crater = prep(new SphereGeometry(radius * 0.15, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2));
  crater.scale(1, 0.25, 1);
  crater.translate(0, height * 0.97, 0);
  streams.push(crater);
  return { parts: { rock: cone, glow: mergeParts(streams) } };
}

/**
 * The bleached remains of a colossal beast: a curved spine of vertebrae with `pairs` pairs of
 * ribs arching up to about `height` metres, laid along +X from the origin.
 */
export function colossusRibsGeometry(seed: number, pairs: number, height: number): BufferGeometry {
  const rand = mulberry32(seed);
  const parts: BufferGeometry[] = [];
  const len = pairs * 1.6;
  for (let k = 0; k <= pairs * 2; k++) {
    const x = (k / (pairs * 2)) * len;
    const y = 0.4 + Math.sin((k / (pairs * 2)) * Math.PI) * 0.6;
    const v = prep(new CylinderGeometry(0.42, 0.45, 0.6, 8, 1), 0.85);
    v.rotateZ(Math.PI / 2);
    v.translate(x, y, 0);
    parts.push(v);
    parts.push(place(prep(new ConeGeometry(0.18, 1.2, 5), 0.8), x, y + 0.8, 0));
  }
  for (let k = 0; k < pairs; k++) {
    const x = 0.8 + k * 1.6;
    const h = height * (0.65 + Math.sin(((k + 0.5) / pairs) * Math.PI) * 0.35);
    const reach = h * 0.55;
    for (const sz of [-1, 1]) {
      const lean = (rand() - 0.5) * 0.4;
      const path = new CatmullRomCurve3([
        new Vector3(x, 0.9, sz * 0.4),
        new Vector3(x + lean, h * 0.75, sz * reach * 0.55),
        new Vector3(x + lean * 1.5, h, sz * reach * 0.95),
        new Vector3(x + lean * 2, h * 0.7, sz * reach * 1.25),
        new Vector3(x + lean * 2.2, rand() < 0.3 ? h * 0.35 : -0.3, sz * reach * 1.35),
      ]);
      parts.push(prep(new TubeGeometry(path, 16, 0.16 + rand() * 0.05, 6, false), 0.9));
    }
  }
  const g = mergeParts(parts);
  erode(g, 0.08, 0.6, seed);
  return groundAo(g, 0, 1.5, 0.55);
}

/**
 * A clump of cave mushrooms: pale stems (bone material) under glowing gilled caps (glow part).
 */
export function mushroomClusterGeometry(seed: number, count: number): PropParts {
  const rand = mulberry32(seed);
  const stems: BufferGeometry[] = [];
  const caps: BufferGeometry[] = [];
  for (let k = 0; k < count; k++) {
    const a = rand() * Math.PI * 2;
    const d = k === 0 ? 0 : 0.1 + rand() * 0.35;
    const h = 0.12 + rand() * (k === 0 ? 0.5 : 0.3);
    const r = 0.05 + h * 0.35;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const lean = (rand() - 0.5) * 0.3;
    const stem = prep(new CylinderGeometry(r * 0.25, r * 0.35, h, 6, 2), 0.9);
    stem.translate(0, h / 2, 0);
    stem.rotateZ(lean);
    stem.translate(x, 0, z);
    stems.push(stem);
    const cap = prep(new SphereGeometry(r, 9, 4, 0, Math.PI * 2, 0, Math.PI / 2), 1);
    cap.scale(1, 0.55, 1);
    cap.translate(0, h, 0);
    cap.rotateZ(lean);
    cap.translate(x, 0, z);
    caps.push(cap);
  }
  return { parts: { bone: groundAo(mergeParts(stems), 0, 0.2, 0.5), glow: mergeParts(caps) } };
}

/**
 * Puddles: flat discs with noisy shores (normals up), merged for the wet cave floor. `spots` are
 * (x, z, radius).
 */
export function puddleGeometry(
  spots: readonly (readonly [number, number, number])[],
): BufferGeometry {
  const parts: BufferGeometry[] = [];
  spots.forEach(([x, z, r], s) => {
    const seg = 20;
    const pos: number[] = [x, 0.025, z];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const k = r * (1 + fbm(Math.cos(a) * 1.5 + s * 3.1, Math.sin(a) * 1.5, s, 3) * 0.45);
      pos.push(x + Math.cos(a) * k, 0.025, z + Math.sin(a) * k);
    }
    const index: number[] = [];
    for (let i = 0; i < seg; i++) index.push(0, 1 + ((i + 1) % seg), 1 + i);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    const n = pos.length / 3;
    const nor = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) nor[i * 3 + 1] = 1;
    g.setAttribute('normal', new BufferAttribute(nor, 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    g.setIndex(index);
    parts.push(g);
  });
  return mergeParts(parts);
}

/** A tall stone pylon (anchor for giant chains): stacked blocks with a brazier bowl on top. */
export function pylonGeometry(seed: number, h: number): PropParts {
  const rand = mulberry32(seed);
  const parts: BufferGeometry[] = [place(block(2.4, 0.8, 2.4, 0.6), 0, 0.4, 0)];
  const n = Math.round(h / 1.3);
  for (let k = 0; k < n; k++) {
    const w = 1.7 - k * 0.04 + (rand() - 0.5) * 0.1;
    parts.push(
      place(
        block(w, 1.25, w, 0.85),
        0,
        0.8 + (k + 0.5) * ((h - 0.8) / n),
        0,
        0,
        (rand() - 0.5) * 0.1,
        0,
      ),
    );
  }
  parts.push(place(block(2.0, 0.4, 2.0, 0.8), 0, h + 0.2, 0));
  const g = mergeParts(parts);
  erode(g, 0.04, 1.2, seed);
  const bowl = prep(new CylinderGeometry(0.8, 0.45, 0.5, 10, 1, true), 0.8);
  bowl.translate(0, h + 0.65, 0);
  const coal = prep(new CylinderGeometry(0.7, 0.7, 0.05, 10, 1), 1);
  coal.translate(0, h + 0.75, 0);
  return {
    parts: { stone: groundAo(g, 0, 2, 0.6), iron: bowl, glow: coal },
    flames: [[0, h + 0.8, 0, 1.6]],
  };
}
