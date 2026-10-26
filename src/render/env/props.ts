import {
  BoxGeometry,
  BufferAttribute,
  CatmullRomCurve3,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  IcosahedronGeometry,
  LatheGeometry,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  Shape,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mulberry32 } from '../../core/random';
import { fbm } from './shapes';

/**
 * Sculpted set-dressing props, built from primitives at arena load: bones and skulls, broken
 * statues, gargoyles, sarcophagi, arches, barricades, weapon racks, cages, chains, candles,
 * banners, dead trees, roots and crystals. Like the shapes in shapes.ts every geometry is indexed,
 * carries only position / normal / colour, and holds baked occlusion in its vertex colours, so
 * props of one material merge into a single draw call (ArenaBuilder tints them per material).
 * Sizes are in metres with the prop standing on y = 0.
 */

/** Materials a prop part is drawn with (one merged mesh per material in an arena). */
export type PropMaterial = 'stone' | 'rock' | 'iron' | 'wood' | 'bone' | 'glow' | 'crystal';

/** A prop split by material, plus flame anchors (x, y, z, size) in the prop's space. */
export interface PropParts {
  readonly parts: Partial<Record<PropMaterial, BufferGeometry>>;
  readonly flames?: readonly (readonly [number, number, number, number])[];
}

const m4 = new Matrix4();
const e4 = new Euler();
const q4 = new Quaternion();
const v3 = new Vector3();
const s3 = new Vector3();

/** Strips UVs etc., indexes the geometry and paints a flat occlusion value. */
export function prep(g: BufferGeometry, ao = 1): BufferGeometry {
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  }
  let out = g;
  if (g.index === null) {
    out = mergeVertices(g);
    g.dispose();
  }
  const n = out.getAttribute('position').count;
  out.setAttribute('color', new BufferAttribute(new Float32Array(n * 3).fill(ao), 3));
  return out;
}

/** Positions a prepared part: translation, Euler rotation (XYZ) and scale. */
export function place(
  g: BufferGeometry,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = sx,
  sz = sx,
): BufferGeometry {
  q4.setFromEuler(e4.set(rx, ry, rz));
  m4.compose(v3.set(x, y, z), q4, s3.set(sx, sy, sz));
  g.applyMatrix4(m4);
  return g;
}

/** Merges prepared parts into one geometry (inputs are disposed). */
export function mergeParts(parts: readonly BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts as BufferGeometry[], false);
  for (const p of parts) p.dispose();
  if (merged === null) throw new Error('prop merge failed');
  return merged;
}

/**
 * Weathering: displaces vertices by a smooth 3D noise field (not along normals, so duplicated
 * vertices on hard edges move together and no cracks open), darkens the dents.
 */
export function erode(g: BufferGeometry, amp: number, freq: number, seed: number): BufferGeometry {
  const pos = g.getAttribute('position');
  const col = g.getAttribute('color');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) * freq + seed;
    const y = pos.getY(i) * freq;
    const z = pos.getZ(i) * freq - seed;
    const nx = fbm(x, y, z, 2);
    const ny = fbm(x + 31.7, y, z, 2);
    const nz = fbm(x, y + 17.3, z, 2);
    pos.setXYZ(i, pos.getX(i) + nx * amp, pos.getY(i) + ny * amp, pos.getZ(i) + nz * amp);
    const dent = 1 - Math.max(0, -nx - ny) * 0.5;
    col.setXYZ(i, col.getX(i) * dent, col.getY(i) * dent, col.getZ(i) * dent);
  }
  g.computeVertexNormals();
  return g;
}

/** Darkens toward the ground: occlusion `lo` at y0 rising to 1 at y1. */
export function groundAo(g: BufferGeometry, y0: number, y1: number, lo: number): BufferGeometry {
  const pos = g.getAttribute('position');
  const col = g.getAttribute('color');
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (pos.getY(i) - y0) / (y1 - y0)));
    const k = lo + (1 - lo) * t * t * (3 - 2 * t);
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
  return g;
}

/** A cylinder between two points (radii at a and b). */
export function strut(
  a: Vector3,
  b: Vector3,
  ra: number,
  rb: number,
  radial = 6,
  ao = 1,
  rows = 1,
): BufferGeometry {
  const len = a.distanceTo(b);
  const g = prep(new CylinderGeometry(rb, ra, len, radial, rows, false), ao);
  g.translate(0, len / 2, 0);
  const dir = v3.copy(b).sub(a).normalize();
  q4.setFromUnitVectors(s3.set(0, 1, 0), dir);
  m4.compose(a, q4, s3.set(1, 1, 1));
  g.applyMatrix4(m4);
  return g;
}

function sphere(r: number, w: number, h: number, ao = 1): BufferGeometry {
  return prep(new SphereGeometry(r, w, h), ao);
}

function rbox(w: number, h: number, d: number, r: number, ao = 1, seg = 1): BufferGeometry {
  return prep(new RoundedBoxGeometry(w, h, d, seg, r), ao);
}

// ------------------------------------------------------------------ bones

/**
 * A femur about 0.46 m long along X: a shaft that pinches in the middle and flares toward the
 * ends, a ball head on an angled neck with the trochanter bump, and two knuckled condyles.
 */
export function femurGeometry(): BufferGeometry {
  const pts: Vector2[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const r = 0.015 + 0.013 * Math.pow(Math.abs(t - 0.5) * 2, 2.6);
    pts.push(new Vector2(r, t * 0.36 - 0.18));
  }
  const shaft = prep(new LatheGeometry(pts, 8), 0.95);
  shaft.rotateZ(-Math.PI / 2);
  const parts = [
    shaft,
    strut(new Vector3(0.17, 0, 0), new Vector3(0.205, 0.03, 0), 0.017, 0.014, 6, 0.9),
    place(sphere(0.026, 8, 6), 0.215, 0.038, 0),
    place(sphere(0.02, 6, 5, 0.85), 0.175, -0.008, 0, 0, 0, 0, 1.2, 0.9, 1),
    place(sphere(0.024, 8, 6), -0.2, -0.004, 0.017, 0, 0, 0, 1.15, 0.95, 1),
    place(sphere(0.024, 8, 6), -0.2, -0.004, -0.017, 0, 0, 0, 1.15, 0.95, 1),
  ];
  const g = mergeParts(parts);
  g.computeVertexNormals();
  return g;
}

/** A long arm / shin bone (simpler knuckles), about 0.34 m along X. */
export function longBoneGeometry(): BufferGeometry {
  const pts: Vector2[] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    pts.push(new Vector2(0.011 + 0.009 * Math.pow(Math.abs(t - 0.5) * 2, 2.4), t * 0.3 - 0.15));
  }
  const shaft = prep(new LatheGeometry(pts, 6), 0.95);
  shaft.rotateZ(-Math.PI / 2);
  const g = mergeParts([
    shaft,
    place(sphere(0.02, 6, 5), 0.16, 0, 0, 0, 0, 0, 1, 0.8, 1.2),
    place(sphere(0.018, 6, 5), -0.16, 0, 0.008, 0, 0, 0, 1, 0.85, 1.1),
    place(sphere(0.015, 6, 5), -0.158, 0, -0.012),
  ]);
  g.computeVertexNormals();
  return g;
}

/**
 * A human skull, front toward +Z, about 0.22 m long: a long, narrow cranium with brow ridge,
 * cheekbones and temple hollows, deep eye sockets and a nasal cavity (dark baked occlusion),
 * upper teeth and a separate U-shaped jaw with its own teeth. `detail` 2 for piles, 3 up close.
 */
export function skullGeometry(detail = 3): BufferGeometry {
  const head = prep(new IcosahedronGeometry(0.1, detail));
  const pos = head.getAttribute('position');
  const col = head.getAttribute('color');
  const p = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    let x = p.x * 0.8;
    let y = p.y * 0.9;
    let z = p.z * 1.12;
    let ao = 1;
    // Flat base; the lower face (maxilla) narrower than the braincase.
    if (y < -0.03) {
      x *= 0.8 + 0.2 * Math.max(0, 1 + (y + 0.03) * 12);
      if (z < 0) z *= 0.88;
      y = Math.max(y, -0.072);
    }
    // Brow ridge over the sockets.
    if (z > 0.07 && y > 0 && y < 0.035) z += (0.035 - Math.abs(y - 0.018)) * 0.35;
    // Temple hollows.
    for (const sx of [-1, 1]) {
      const dt = Math.hypot(x - sx * 0.075, y + 0.005, z - 0.03);
      if (dt < 0.035) x -= sx * (0.035 - dt) * 0.35;
      // Cheekbones.
      const dc = Math.hypot(x - sx * 0.058, y + 0.03, z - 0.06);
      if (dc < 0.03) x += sx * (0.03 - dc) * 0.5;
    }
    // Eye sockets: pushed deep and dark.
    for (const sx of [-1, 1]) {
      const d = Math.hypot(x - sx * 0.034, y + 0.004, z - 0.1);
      if (d < 0.03) {
        const k = 1 - d / 0.03;
        z -= k * 0.045;
        ao = Math.min(ao, 0.12 + (1 - k) * 0.5);
      }
    }
    // Nasal cavity: an inverted triangle under the sockets.
    const ny = (y + 0.036) / 0.024;
    if (z > 0.06 && ny > -1 && ny < 1 && Math.abs(x) < 0.012 * (1 - ny) + 0.002) {
      z -= 0.022 * (1 - Math.abs(ny));
      ao = Math.min(ao, 0.15);
    }
    // Underside and the back of the jaw line are darker.
    ao *= 0.55 + 0.45 * Math.min(1, (y + 0.075) * 9);
    pos.setXYZ(i, x, y, z);
    col.setXYZ(i, ao, ao, ao);
  }
  head.computeVertexNormals();
  const parts: BufferGeometry[] = [head];
  // Upper teeth on an arc under the maxilla.
  for (let k = 0; k < 8; k++) {
    const a = (k / 7 - 0.5) * 2.0;
    parts.push(
      place(
        prep(new BoxGeometry(0.011, 0.016, 0.01), 0.9),
        Math.sin(a) * 0.032,
        -0.078,
        0.062 + Math.cos(a) * 0.026,
        0,
        a,
        0,
      ),
    );
  }
  // Jaw: a U-shaped bar with rising rami at the back.
  const jawPath = new CatmullRomCurve3([
    new Vector3(-0.05, -0.045, -0.005),
    new Vector3(-0.05, -0.085, 0.01),
    new Vector3(-0.036, -0.1, 0.06),
    new Vector3(0, -0.106, 0.088),
    new Vector3(0.036, -0.1, 0.06),
    new Vector3(0.05, -0.085, 0.01),
    new Vector3(0.05, -0.045, -0.005),
  ]);
  const jaw = prep(new TubeGeometry(jawPath, 18, 0.0105, 5, false), 0.75);
  jaw.scale(1, 1.25, 1);
  jaw.translate(0, 0.022, 0);
  parts.push(jaw);
  for (let k = 0; k < 6; k++) {
    const a = (k / 5 - 0.5) * 1.8;
    parts.push(
      place(
        prep(new BoxGeometry(0.01, 0.013, 0.009), 0.85),
        Math.sin(a) * 0.03,
        -0.092,
        0.06 + Math.cos(a) * 0.022,
        0,
        a,
        0,
      ),
    );
  }
  const g = mergeParts(parts);
  g.computeVertexNormals();
  return g;
}

/**
 * A rib cage standing as in a torso (spine at the back, -Z): a slightly curved spine of
 * vertebrae with spinous processes, seven pairs of ribs curving forward (the lower ones shorter)
 * and a sternum. About 0.5 m tall; lay it on its side or bury it for remains.
 */
export function ribcageGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let k = 0; k < 11; k++) {
    const y = 0.03 + k * 0.042;
    const z = -0.09 - Math.sin((k / 10) * Math.PI) * 0.02;
    parts.push(place(prep(new CylinderGeometry(0.02, 0.022, 0.03, 5), 0.8), 0, y, z));
    parts.push(place(rbox(0.01, 0.022, 0.04, 0.004, 0.75), 0, y - 0.006, z - 0.035, -0.5, 0, 0));
  }
  for (let k = 0; k < 7; k++) {
    const y = 0.42 - k * 0.048;
    const w = 0.1 + Math.sin(((k + 1.5) / 8) * Math.PI) * 0.06;
    const reach = k < 5 ? 1 : 0.7;
    for (const sx of [-1, 1]) {
      const path = new CatmullRomCurve3([
        new Vector3(sx * 0.018, y, -0.09),
        new Vector3(sx * w * 0.6, y - 0.008, -0.11),
        new Vector3(sx * w, y - 0.035, -0.04),
        new Vector3(sx * w * 0.9, y - 0.065, 0.04 * reach),
        new Vector3(sx * w * (k < 5 ? 0.35 : 0.7), y - 0.085 * reach, 0.1 * reach),
      ]);
      parts.push(prep(new TubeGeometry(path, 7, 0.0075, 3, false), 0.9));
    }
  }
  parts.push(place(rbox(0.035, 0.2, 0.014, 0.006, 0.85), 0, 0.31, 0.105, 0.12, 0, 0));
  const g = mergeParts(parts);
  g.computeVertexNormals();
  return groundAo(g, 0, 0.25, 0.6);
}

// ------------------------------------------------------------------ statues

/** A stepped plinth (0.62 m) under a statue. */
function plinth(width: number): BufferGeometry[] {
  return [
    place(rbox(width, 0.4, width, 0.04, 0.7), 0, 0.2, 0),
    place(rbox(width * 0.86, 0.22, width * 0.86, 0.03, 0.85), 0, 0.51, 0),
  ];
}

export type StatueDamage = 'none' | 'head' | 'arm' | 'top';

/**
 * A knight in plate on a plinth (about 2.7 m): sabatons, greaves, an armoured skirt, a broad
 * chest, pauldrons, a closed helm with a visor slit and crest, a cape, and both hands on a
 * greatsword planted point-down. `damage` removes the head, the sword arm or everything above
 * the waist (a jagged break), as on a ruin. Weathered by noise; front toward +Z.
 */
export function knightStatueGeometry(seed: number, damage: StatueDamage = 'none'): BufferGeometry {
  const parts: BufferGeometry[] = plinth(1.05);
  const top = damage !== 'top';
  for (const sx of [-1, 1]) {
    parts.push(place(rbox(0.16, 0.1, 0.28, 0.03, 0.75), sx * 0.13, 0.67, 0.03));
    parts.push(
      strut(new Vector3(sx * 0.13, 0.7, 0), new Vector3(sx * 0.13, 1.3, 0), 0.085, 0.11, 8),
    );
    parts.push(place(sphere(0.085, 8, 6, 0.85), sx * 0.13, 1.02, 0.03, 0, 0, 0, 1, 0.8, 1));
  }
  const skirt = prep(
    new LatheGeometry(
      [
        new Vector2(0.31, 0),
        new Vector2(0.29, 0.1),
        new Vector2(0.24, 0.3),
        new Vector2(0.2, 0.34),
      ],
      12,
    ),
    0.85,
  );
  skirt.translate(0, 1.22, 0);
  parts.push(skirt);
  if (top) {
    const torso = prep(
      new LatheGeometry(
        [
          new Vector2(0.2, 0),
          new Vector2(0.24, 0.12),
          new Vector2(0.27, 0.3),
          new Vector2(0.25, 0.44),
          new Vector2(0.16, 0.52),
          new Vector2(0.07, 0.56),
        ],
        12,
      ),
    );
    torso.scale(1, 1, 0.72);
    torso.translate(0, 1.52, 0);
    parts.push(torso);
    for (const sx of [-1, 1]) {
      if (damage === 'arm' && sx === 1) continue;
      const shoulder = new Vector3(sx * 0.27, 1.95, 0);
      const elbow = new Vector3(sx * 0.27, 1.68, 0.14);
      const hand = new Vector3(sx * 0.05, 1.6, 0.31);
      parts.push(place(sphere(0.14, 9, 6), sx * 0.27, 1.98, 0, 0, 0, sx * 0.25, 1, 0.75, 1.05));
      parts.push(strut(shoulder, elbow, 0.075, 0.065, 7));
      parts.push(strut(elbow, hand, 0.065, 0.055, 7));
      parts.push(place(sphere(0.055, 7, 5), hand.x, hand.y, hand.z));
    }
    // Greatsword planted point-down, hands on the pommel.
    parts.push(place(rbox(0.075, 0.95, 0.018, 0.006, 0.9), 0, 1.07, 0.33));
    parts.push(place(rbox(0.36, 0.04, 0.05, 0.01), 0, 1.56, 0.33));
    parts.push(strut(new Vector3(0, 1.58, 0.33), new Vector3(0, 1.7, 0.33), 0.022, 0.02, 6));
    parts.push(place(sphere(0.035, 7, 5), 0, 1.72, 0.33));
    // Cape hanging from the shoulders behind.
    const cape = prep(
      new CylinderGeometry(0.27, 0.42, 1.25, 12, 6, true, Math.PI * 0.62, Math.PI * 0.76),
    );
    cape.translate(0, 1.38, -0.04);
    parts.push(cape);
    if (damage !== 'head') {
      const helm = prep(new CylinderGeometry(0.11, 0.12, 0.2, 10, 2));
      helm.translate(0, 2.2, 0.01);
      const hp = helm.getAttribute('position');
      const hc = helm.getAttribute('color');
      for (let i = 0; i < hp.count; i++) {
        // Visor slit: a dark band across the face.
        if (hp.getZ(i) > 0.05 && Math.abs(hp.getY(i) - 2.22) < 0.03) hc.setXYZ(i, 0.12, 0.12, 0.12);
      }
      parts.push(helm);
      parts.push(place(sphere(0.115, 10, 5), 0, 2.3, 0.01, 0, 0, 0, 1, 0.7, 1));
      parts.push(place(rbox(0.03, 0.08, 0.24, 0.012), 0, 2.38, -0.01));
      parts.push(place(rbox(0.2, 0.02, 0.05, 0.008, 0.2), 0, 2.22, 0.115));
    }
  } else {
    // Snapped at the waist: a jagged stump.
    const stump = prep(new IcosahedronGeometry(0.25, 1), 0.8);
    stump.scale(1, 0.5, 0.75);
    stump.translate(0, 1.58, 0);
    parts.push(stump);
  }
  const g = mergeParts(parts);
  erode(g, 0.012, 7, seed);
  return groundAo(g, 0.6, 1.3, 0.7);
}

/** A feathered wing outline (root at the origin, spreading +X and up). */
function wingShape(span: number, height: number, broken: boolean): Shape {
  const s = new Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(span * 0.3, height * 0.75, span * 0.85, height);
  if (broken) {
    s.lineTo(span * 0.62, height * 0.55);
    s.lineTo(span * 0.5, height * 0.6);
  } else {
    s.quadraticCurveTo(span * 1.05, height * 0.9, span, height * 0.75);
  }
  // Scalloped trailing edge: primary feathers.
  const feathers = broken ? 3 : 6;
  const startX = broken ? span * 0.5 : span;
  const startY = broken ? height * 0.6 : height * 0.75;
  for (let i = 1; i <= feathers; i++) {
    const t = i / feathers;
    const x = startX * (1 - t) + span * 0.06 * t;
    const y = startY * (1 - t) - height * 0.25 * Math.sin(t * Math.PI) - height * 0.05 * t;
    const mx = (x + startX * (1 - (i - 1) / feathers) + span * 0.06 * ((i - 1) / feathers)) / 2;
    s.quadraticCurveTo(mx + span * 0.04, y - height * 0.08, x, y);
  }
  s.lineTo(0, 0);
  return s;
}

/**
 * A robed angel at prayer on a plinth (about 2.9 m with wings): a folded robe, hooded head,
 * joined hands and two tall feathered wings swept back. `broken` snaps one wing.
 */
export function angelStatueGeometry(seed: number, broken = false): BufferGeometry {
  const parts: BufferGeometry[] = plinth(1.0);
  const robePts: Vector2[] = [];
  const prof = [
    [0.34, 0],
    [0.3, 0.2],
    [0.24, 0.6],
    [0.2, 0.85],
    [0.23, 1.05],
    [0.24, 1.18],
    [0.16, 1.3],
    [0.08, 1.34],
  ] as const;
  for (const [r, y] of prof) robePts.push(new Vector2(r, y));
  const robe = prep(new LatheGeometry(robePts, 20));
  const rp = robe.getAttribute('position');
  const rc = robe.getAttribute('color');
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i);
    const y = rp.getY(i);
    const z = rp.getZ(i);
    const a = Math.atan2(z, x);
    // Vertical folds, strongest at the hem.
    const fold = Math.cos(a * 9 + Math.sin(a * 3) * 0.6) * 0.022 * Math.max(0, 1 - y / 0.9);
    const k = 1 + fold / Math.max(0.05, Math.hypot(x, z));
    rp.setXYZ(i, x * k, y, z * k * 0.85);
    const ao = 0.75 + fold * 10;
    rc.setXYZ(i, ao, ao, ao);
  }
  robe.translate(0, 0.62, 0);
  parts.push(robe);
  parts.push(place(sphere(0.1, 10, 7), 0, 2.06, 0.02, 0, 0, 0, 0.9, 1.05, 1));
  const hood = prep(new SphereGeometry(0.13, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.62), 0.8);
  hood.translate(0, 2.06, -0.02);
  parts.push(hood);
  for (const sx of [-1, 1]) {
    const shoulder = new Vector3(sx * 0.2, 1.84, 0);
    const elbow = new Vector3(sx * 0.17, 1.58, 0.1);
    const hands = new Vector3(sx * 0.02, 1.7, 0.2);
    parts.push(strut(shoulder, elbow, 0.07, 0.06, 7));
    parts.push(strut(elbow, hands, 0.06, 0.045, 7));
  }
  parts.push(place(rbox(0.06, 0.13, 0.05, 0.02), 0, 1.74, 0.21, 0.3, 0, 0));
  for (const sx of [-1, 1]) {
    const snapped = broken && sx === 1;
    const wing = prep(
      new ExtrudeGeometry(wingShape(0.9, 1.45, snapped), {
        depth: 0.05,
        bevelEnabled: true,
        bevelThickness: 0.015,
        bevelSize: 0.015,
        bevelSegments: 1,
        curveSegments: 6,
      }),
    );
    wing.translate(0, 0, -0.025);
    if (sx < 0) wing.rotateY(Math.PI);
    // Swept back from the shoulder blades.
    wing.rotateY(sx * 0.55);
    wing.translate(sx * 0.12, 1.55, -0.16);
    parts.push(wing);
  }
  const g = mergeParts(parts);
  erode(g, 0.01, 7, seed);
  return groundAo(g, 0.6, 1.2, 0.7);
}

/**
 * A crouching gargoyle on a corbel block (about 1.1 m): hunched body, horned head with a snout,
 * forelegs gripping the block, haunches, folded wings and a curled tail. Eyes are a separate
 * glow part (embers in the sockets).
 */
export function gargoyleGeometry(seed: number): PropParts {
  const parts: BufferGeometry[] = [place(rbox(0.6, 0.3, 0.62, 0.04, 0.75), 0, 0.15, 0)];
  const body = prep(new IcosahedronGeometry(0.24, 2));
  body.scale(0.8, 1, 1.05);
  body.rotateX(0.5);
  body.translate(0, 0.58, -0.02);
  parts.push(body);
  parts.push(place(sphere(0.13, 9, 7), 0, 0.86, 0.17, 0, 0, 0, 1, 0.9, 1.1));
  parts.push(place(prep(new ConeGeometry(0.07, 0.16, 7), 0.9), 0, 0.82, 0.31, Math.PI / 2, 0, 0));
  for (const sx of [-1, 1]) {
    const horn = new CatmullRomCurve3([
      new Vector3(sx * 0.07, 0.94, 0.15),
      new Vector3(sx * 0.13, 1.04, 0.08),
      new Vector3(sx * 0.16, 1.08, -0.04),
      new Vector3(sx * 0.14, 1.04, -0.12),
    ]);
    const hornGeo = prep(new TubeGeometry(horn, 8, 0.022, 5, false), 0.85);
    parts.push(hornGeo);
    parts.push(
      strut(new Vector3(sx * 0.12, 0.62, 0.12), new Vector3(sx * 0.14, 0.31, 0.24), 0.05, 0.04, 6),
    );
    parts.push(place(sphere(0.05, 6, 5, 0.8), sx * 0.14, 0.32, 0.26, 0, 0, 0, 1.2, 0.5, 1.3));
    parts.push(place(sphere(0.12, 8, 6, 0.85), sx * 0.16, 0.42, -0.1, 0, 0, 0, 0.8, 1, 1.2));
    const wing = prep(
      new ExtrudeGeometry(wingShape(0.42, 0.55, false), {
        depth: 0.025,
        bevelEnabled: false,
        curveSegments: 4,
      }),
      0.85,
    );
    if (sx < 0) wing.rotateY(Math.PI);
    wing.rotateY(sx * 1.2);
    wing.rotateZ(sx * 0.25);
    wing.translate(sx * 0.1, 0.66, -0.12);
    parts.push(wing);
  }
  const tail = new CatmullRomCurve3([
    new Vector3(0, 0.42, -0.22),
    new Vector3(0.12, 0.32, -0.3),
    new Vector3(0.26, 0.31, -0.18),
    new Vector3(0.28, 0.31, 0.05),
  ]);
  parts.push(prep(new TubeGeometry(tail, 10, 0.03, 5, false), 0.8));
  const g = mergeParts(parts);
  erode(g, 0.01, 8, seed);
  const eyes = mergeParts([
    place(sphere(0.018, 6, 4), -0.05, 0.9, 0.27),
    place(sphere(0.018, 6, 4), 0.05, 0.9, 0.27),
  ]);
  return { parts: { stone: groundAo(g, 0.3, 0.6, 0.75), glow: eyes } };
}

/**
 * A stone sarcophagus (2.1 × 0.95 m): moulded base and rim, a carved panel band, and a heavy
 * lid with a knight's effigy pushed askew.
 */
export function sarcophagusGeometry(seed: number): BufferGeometry {
  const rand = mulberry32(seed);
  const parts: BufferGeometry[] = [
    place(rbox(1.0, 0.14, 2.12, 0.03, 0.65), 0, 0.07, 0),
    place(rbox(0.9, 0.62, 2.0, 0.05, 0.85), 0, 0.45, 0),
    place(rbox(0.96, 0.07, 2.06, 0.02, 0.9), 0, 0.72, 0),
  ];
  // Carved panels: raised frames along both long sides.
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      parts.push(place(rbox(0.04, 0.34, 0.5, 0.012, 0.8), sx * 0.46, 0.42, -0.62 + k * 0.62));
    }
  }
  const lid = [
    rbox(1.02, 0.15, 2.14, 0.04),
    place(
      prep(new CylinderGeometry(0.15, 0.17, 1.3, 10, 1), 0.95),
      0,
      0.12,
      -0.05,
      Math.PI / 2,
      0,
      0,
      1,
      1,
      0.55,
    ),
    place(sphere(0.12, 9, 6), 0, 0.14, 0.72, 0, 0, 0, 1, 0.75, 1),
    place(rbox(0.07, 0.04, 0.42, 0.01), 0, 0.2, 0.15),
  ];
  const lidGeo = mergeParts(lid);
  place(lidGeo, 0.18 + rand() * 0.1, 0.83, 0.12, 0, 0.12 + rand() * 0.12, 0.03);
  parts.push(lidGeo);
  const g = mergeParts(parts);
  erode(g, 0.01, 6, seed);
  return groundAo(g, 0, 0.5, 0.65);
}

/**
 * A ruined arch (4 m span): two piers of stacked blocks and a ring of wedge voussoirs with a
 * keystone. `broken` drops half the ring and the top of one pier, with fallen blocks below.
 */
export function archGeometry(seed: number, broken: boolean): BufferGeometry {
  const rand = mulberry32(seed);
  const parts: BufferGeometry[] = [];
  const span = 1.7;
  for (const sx of [-1, 1]) {
    const courses = broken && sx === 1 ? 2 : 4;
    for (let k = 0; k < courses; k++) {
      const w = 0.78 + rand() * 0.06;
      parts.push(
        place(
          rbox(w, 0.58, 0.8, 0.04, 0.85),
          sx * span,
          0.3 + k * 0.6,
          0,
          0,
          (rand() - 0.5) * 0.06,
          0,
        ),
      );
    }
    parts.push(place(rbox(0.95, 0.18, 0.95, 0.03, 0.9), sx * span, 2.48, 0));
  }
  const n = 9;
  for (let k = 0; k < n; k++) {
    if (broken && k > 4) continue;
    const a = Math.PI - (k + 0.5) * (Math.PI / n);
    const r = span;
    const key = k === Math.floor(n / 2);
    const g = rbox(0.72, key ? 0.62 : 0.56, 0.78, 0.035, 0.9);
    place(g, Math.cos(a) * r, 2.57 + Math.sin(a) * r, 0, 0, 0, a - Math.PI / 2);
    parts.push(g);
  }
  if (broken) {
    for (let k = 0; k < 3; k++) {
      parts.push(
        place(
          rbox(0.7, 0.5, 0.75, 0.04, 0.75),
          span * 0.6 + rand() * 1.4,
          0.22,
          (rand() - 0.5) * 1.6,
          rand() * 0.5,
          rand() * 3,
          rand() * 0.6,
        ),
      );
    }
  }
  const g = mergeParts(parts);
  erode(g, 0.015, 5, seed);
  return groundAo(g, 0, 1.2, 0.65);
}

// ------------------------------------------------------------------ wood & iron

/** Paints wood grain into a part's occlusion (streaks along local Y before placement). */
function grain(g: BufferGeometry, seed: number): BufferGeometry {
  const pos = g.getAttribute('position');
  const col = g.getAttribute('color');
  for (let i = 0; i < pos.count; i++) {
    const n = fbm(pos.getX(i) * 18 + seed, pos.getY(i) * 2, pos.getZ(i) * 18, 2);
    const k = 0.78 + n * 0.35;
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
  return g;
}

/** A sharpened stake along +Y from the origin (both ends pointed). */
function stake(len: number, r: number, seed: number): BufferGeometry {
  const body = grain(prep(new CylinderGeometry(r, r * 1.1, len * 0.8, 6, 3)), seed);
  const tipA = prep(new ConeGeometry(r, len * 0.12, 6), 0.9);
  const tipB = prep(new ConeGeometry(r * 1.1, len * 0.08, 6), 0.7);
  tipA.translate(0, len * 0.46, 0);
  tipB.rotateX(Math.PI);
  tipB.translate(0, -len * 0.44, 0);
  return mergeParts([body, tipA, tipB]);
}

/**
 * A spiked barricade (cheval de frise, 2.4 m long): a log run through with crossed sharpened
 * stakes, bound with iron bands.
 */
export function barricadeGeometry(seed: number): PropParts {
  const rand = mulberry32(seed);
  const wood: BufferGeometry[] = [];
  const iron: BufferGeometry[] = [];
  const log = grain(prep(new CylinderGeometry(0.13, 0.13, 2.4, 8, 4)), seed);
  log.rotateZ(Math.PI / 2);
  log.translate(0, 0.62, 0);
  wood.push(log);
  for (let k = 0; k < 5; k++) {
    const x = -0.95 + k * 0.475;
    for (const sgn of [-1, 1]) {
      const s = stake(1.7 + rand() * 0.25, 0.045, seed + k * 3);
      s.rotateX(sgn * (Math.PI / 4 + (rand() - 0.5) * 0.15));
      s.translate(x + sgn * 0.05, 0.62, 0);
      wood.push(s);
    }
    if (k % 2 === 0) {
      const band = prep(new TorusGeometry(0.14, 0.018, 4, 10), 0.8);
      band.rotateY(Math.PI / 2);
      band.translate(x + 0.2, 0.62, 0);
      iron.push(band);
    }
  }
  return {
    parts: {
      wood: groundAo(mergeParts(wood), 0, 0.5, 0.6),
      iron: mergeParts(iron),
    },
  };
}

/** A sword lying along +Y from the pommel at the origin (blade, guard, grip). */
function swordParts(len: number): { wood: BufferGeometry; iron: BufferGeometry } {
  const grip = prep(new CylinderGeometry(0.016, 0.016, 0.16, 6), 0.7);
  grip.translate(0, 0.1, 0);
  const iron = mergeParts([
    place(sphere(0.026, 6, 5), 0, 0.01, 0),
    place(rbox(0.2, 0.025, 0.035, 0.008), 0, 0.19, 0),
    place(rbox(0.05, len, 0.01, 0.004), 0, 0.2 + len / 2, 0),
    place(prep(new ConeGeometry(0.025, 0.08, 4)), 0, 0.24 + len, 0, 0, Math.PI / 4, 0, 1, 1, 0.2),
  ]);
  return { wood: grip, iron };
}

/**
 * A weapon rack (1.6 m wide): a timber frame with spears, swords and an axe leaning in it and a
 * round shield propped against its foot.
 */
export function weaponRackGeometry(seed: number): PropParts {
  const rand = mulberry32(seed);
  const wood: BufferGeometry[] = [];
  const iron: BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    wood.push(grain(place(rbox(0.09, 1.45, 0.09, 0.015), sx * 0.75, 0.72, 0), seed + sx));
    wood.push(grain(place(rbox(0.12, 0.08, 0.5, 0.015, 0.7), sx * 0.75, 0.04, 0), seed));
  }
  wood.push(grain(place(rbox(1.6, 0.08, 0.08, 0.015), 0, 1.2, -0.05), seed + 5));
  wood.push(grain(place(rbox(1.6, 0.07, 0.07, 0.015), 0, 0.3, 0.08), seed + 6));
  for (let k = 0; k < 2; k++) {
    const x = -0.45 + k * 0.25;
    const lean = -0.12 + rand() * 0.05;
    const haft = grain(prep(new CylinderGeometry(0.02, 0.022, 2.1, 6, 2), 0.9), seed + k);
    haft.translate(0, 1.05, 0);
    haft.rotateX(lean);
    haft.translate(x, 0, 0.12);
    wood.push(haft);
    const tip = prep(new ConeGeometry(0.035, 0.22, 4));
    tip.translate(0, 2.2, 0);
    tip.rotateX(lean);
    tip.translate(x, 0, 0.12);
    iron.push(tip);
  }
  for (let k = 0; k < 2; k++) {
    const s = swordParts(0.85);
    for (const g of [s.wood, s.iron]) {
      g.rotateX(Math.PI);
      g.translate(0, 1.32, 0);
      g.rotateX(-0.1);
      g.translate(0.15 + k * 0.22, 0, 0.1);
    }
    wood.push(s.wood);
    iron.push(s.iron);
  }
  const axeHaft = grain(prep(new CylinderGeometry(0.022, 0.025, 1.1, 6, 2), 0.9), seed + 9);
  axeHaft.translate(0, 0.55, 0);
  const blade = new Shape();
  blade.moveTo(0, -0.06);
  blade.quadraticCurveTo(0.18, -0.16, 0.22, -0.02);
  blade.quadraticCurveTo(0.24, 0.1, 0.2, 0.18);
  blade.quadraticCurveTo(0.14, 0.08, 0, 0.06);
  blade.lineTo(0, -0.06);
  const head = prep(
    new ExtrudeGeometry(blade, { depth: 0.02, bevelEnabled: false, curveSegments: 5 }),
  );
  head.translate(0.02, 0.98, -0.01);
  const axe = [axeHaft, head];
  for (const g of axe) {
    g.rotateZ(0.08);
    g.translate(0.62, 0.06, 0.15);
  }
  wood.push(axeHaft);
  iron.push(head);
  const shield = prep(new CylinderGeometry(0.34, 0.34, 0.04, 16, 1), 0.85);
  shield.rotateX(Math.PI / 2 - 0.35);
  shield.translate(-0.3, 0.34, 0.32);
  wood.push(grain(shield, seed + 11));
  const boss = place(sphere(0.07, 8, 5), 0, 0, 0, 0, 0, 0, 1, 1, 0.5);
  boss.rotateX(-0.35);
  boss.translate(-0.3, 0.35, 0.355);
  const rim = prep(new TorusGeometry(0.34, 0.016, 4, 20));
  rim.rotateX(-0.35);
  rim.translate(-0.3, 0.34, 0.32);
  iron.push(boss, rim);
  return {
    parts: {
      wood: groundAo(mergeParts(wood), 0, 0.4, 0.6),
      iron: groundAo(mergeParts(iron), 0, 0.4, 0.6),
    },
  };
}

/**
 * Chain links along a smooth path through `points` (each link a stretched torus, alternate
 * links turned a quarter so they interlock).
 */
export function chainGeometry(points: readonly Vector3[], link = 0.11): BufferGeometry {
  const curve = new CatmullRomCurve3(points as Vector3[]);
  const len = curve.getLength();
  const n = Math.max(2, Math.round(len / (link * 0.78)));
  const parts: BufferGeometry[] = [];
  const t = new Vector3();
  const nrm = new Vector3();
  const bin = new Vector3();
  const up = new Vector3(0, 1, 0);
  const p = new Vector3();
  const basis = new Matrix4();
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    curve.getPointAt(u, p);
    curve.getTangentAt(u, t).normalize();
    nrm.crossVectors(t, Math.abs(t.y) > 0.95 ? s3.set(1, 0, 0) : up).normalize();
    bin.crossVectors(t, nrm).normalize();
    if (i % 2 === 1) {
      const tmp = nrm.clone();
      nrm.copy(bin);
      bin.copy(tmp).negate();
    }
    const g = prep(new TorusGeometry(link * 0.32, link * 0.085, 3, 6), 0.85);
    g.scale(1.45, 1, 1);
    basis.makeBasis(t, nrm, bin).setPosition(p);
    g.applyMatrix4(basis);
    parts.push(g);
  }
  return mergeParts(parts);
}

/**
 * An iron gibbet cage (2 m tall): base and crown rings, twelve bars, a domed top of arcs and a
 * hanging ring. Origin at the cage floor.
 */
export function cageGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const r = 0.48;
  const h = 1.55;
  for (const y of [0.02, 0.5, h]) {
    const ring = prep(new TorusGeometry(r, y === 0.5 ? 0.014 : 0.024, 4, 24), 0.9);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, y, 0);
    parts.push(ring);
  }
  parts.push(prep(new CylinderGeometry(r, r, 0.03, 16, 1), 0.7));
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    parts.push(
      strut(
        new Vector3(Math.cos(a) * r, 0, Math.sin(a) * r),
        new Vector3(Math.cos(a) * r, h, Math.sin(a) * r),
        0.012,
        0.012,
        4,
        0.9,
      ),
    );
  }
  for (let k = 0; k < 4; k++) {
    const arc = prep(new TorusGeometry(r, 0.016, 4, 12, Math.PI), 0.9);
    arc.scale(1, 0.85, 1);
    arc.rotateY((k / 4) * Math.PI);
    arc.translate(0, h, 0);
    parts.push(arc);
  }
  const hook = prep(new TorusGeometry(0.07, 0.016, 4, 10), 0.9);
  hook.translate(0, h + r * 0.85 + 0.06, 0);
  parts.push(hook);
  return mergeParts(parts);
}

/**
 * A cluster of melted candles on a wax puddle. Returns the wax (bone material) and flame
 * anchors at the wicks.
 */
export function candleClusterGeometry(seed: number, count: number): PropParts {
  const rand = mulberry32(seed);
  const wax: BufferGeometry[] = [];
  const glow: BufferGeometry[] = [];
  const flames: [number, number, number, number][] = [];
  const puddle = prep(new CylinderGeometry(0.2, 0.24, 0.025, 12, 1), 0.85);
  const pp = puddle.getAttribute('position');
  for (let i = 0; i < pp.count; i++) {
    const a = Math.atan2(pp.getZ(i), pp.getX(i));
    const k = 1 + fbm(Math.cos(a) * 2 + seed, Math.sin(a) * 2, 0, 2) * 0.35;
    pp.setXYZ(i, pp.getX(i) * k, pp.getY(i) + 0.012, pp.getZ(i) * k);
  }
  wax.push(puddle);
  for (let k = 0; k < count; k++) {
    const a = rand() * Math.PI * 2;
    const d = k === 0 ? 0 : 0.06 + rand() * 0.12;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const h = 0.08 + rand() * (k === 0 ? 0.32 : 0.22);
    const r = 0.022 + rand() * 0.022;
    const c = prep(new CylinderGeometry(r * 0.95, r * 1.15, h, 7, 3), 1);
    const cp = c.getAttribute('position');
    for (let i = 0; i < cp.count; i++) {
      // Drips run down the sides.
      const drip =
        Math.max(0, fbm(cp.getX(i) * 40 + seed, cp.getY(i) * 6, cp.getZ(i) * 40, 2)) * 0.25;
      cp.setXYZ(i, cp.getX(i) * (1 + drip), cp.getY(i), cp.getZ(i) * (1 + drip));
    }
    c.translate(x, h / 2 + 0.02, z);
    wax.push(c);
    const wick = prep(new CylinderGeometry(0.003, 0.003, 0.02, 3), 1);
    wick.translate(x, h + 0.03, z);
    glow.push(wick);
    flames.push([x, h + 0.035, z, 0.07 + r]);
  }
  const g = mergeParts(wax);
  g.computeVertexNormals();
  return {
    parts: { bone: groundAo(g, 0, 0.12, 0.7), glow: mergeParts(glow) },
    flames,
  };
}

/**
 * Cloth for a banner hanging from its top edge (`w` × `h`, local +Z facing out): the plane
 * carries `aCloth` = (sway weight 0 at the hem line…1, unused, u, v) for the wind shader, which
 * also cuts the swallow-tailed hem and paints the emblem. Colour is plain white (tinted later).
 */
export function bannerClothGeometry(w: number, h: number, flag = false): BufferGeometry {
  const g = new PlaneGeometry(w, h, flag ? 8 : 4, flag ? 4 : 10);
  g.translate(flag ? w / 2 : 0, flag ? 0 : -h / 2, 0);
  const uv = g.getAttribute('uv');
  const n = uv.count;
  const cloth = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    // Hanging banners sway from the top; flags flutter away from the pole.
    const weight = flag ? Math.pow(u, 1.2) : Math.pow(1 - v, 1.3);
    cloth[i * 4] = weight;
    cloth[i * 4 + 1] = flag ? 1 : 0;
    cloth[i * 4 + 2] = u;
    cloth[i * 4 + 3] = v;
  }
  g.deleteAttribute('uv');
  g.setAttribute('aCloth', new BufferAttribute(cloth, 4));
  g.setAttribute('color', new BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return g;
}

/** The iron rod and finials a wall banner hangs from (centred, at y = 0). */
export function bannerRodGeometry(w: number): BufferGeometry {
  const rod = prep(new CylinderGeometry(0.025, 0.025, w + 0.2, 6), 0.9);
  rod.rotateZ(Math.PI / 2);
  return mergeParts([
    rod,
    place(prep(new ConeGeometry(0.04, 0.12, 6)), -w / 2 - 0.16, 0, 0, 0, 0, Math.PI / 2),
    place(prep(new ConeGeometry(0.04, 0.12, 6)), w / 2 + 0.16, 0, 0, 0, 0, -Math.PI / 2),
  ]);
}

/** A tall flag pole (wood, `h` m) with an iron spear tip. */
export function flagPoleGeometry(h: number, seed: number): PropParts {
  const pole = grain(prep(new CylinderGeometry(0.045, 0.06, h, 7, 4)), seed);
  pole.translate(0, h / 2, 0);
  const tip = prep(new ConeGeometry(0.06, 0.32, 4));
  tip.translate(0, h + 0.16, 0);
  const collar = prep(new TorusGeometry(0.06, 0.015, 4, 8));
  collar.rotateX(Math.PI / 2);
  collar.translate(0, h - 0.02, 0);
  return { parts: { wood: groundAo(pole, 0, 0.6, 0.6), iron: mergeParts([tip, collar]) } };
}

// ------------------------------------------------------------------ trees, roots, crystals

/**
 * A dead, charred tree (4–6 m): a twisting trunk with a flared root base and three levels of
 * crooked, tapering branches.
 */
export function deadTreeGeometry(seed: number): BufferGeometry {
  const rand = mulberry32(seed);
  const parts: BufferGeometry[] = [];
  const grow = (from: Vector3, dir: Vector3, len: number, r: number, depth: number): void => {
    const segs = depth === 0 ? 4 : 2;
    let p = from.clone();
    const d = dir.clone();
    for (let s = 0; s < segs; s++) {
      d.x += (rand() - 0.5) * 0.5;
      d.z += (rand() - 0.5) * 0.5;
      d.y += depth === 0 ? 0.15 : -0.05;
      d.normalize();
      const q = p.clone().addScaledVector(d, len / segs);
      const r0 = r * (1 - s / segs) + r * 0.25 * (s / segs);
      const r1 = r * (1 - (s + 1) / segs) + r * 0.25 * ((s + 1) / segs);
      parts.push(
        grain(strut(p, q, r0, Math.max(0.012, r1), depth === 0 ? 7 : 5, 0.95), seed + depth),
      );
      if (depth < 2 && s >= (depth === 0 ? 1 : 0)) {
        const branches = depth === 0 ? 1 + Math.floor(rand() * 2) : rand() < 0.7 ? 1 : 0;
        for (let b = 0; b < branches; b++) {
          const bd = new Vector3(rand() - 0.5, 0.35 + rand() * 0.4, rand() - 0.5).normalize();
          grow(q, bd, len * (0.45 + rand() * 0.2), r1 * 0.75, depth + 1);
        }
      }
      p = q;
    }
  };
  const trunkH = 3.6 + rand() * 1.8;
  grow(new Vector3(0, 0, 0), new Vector3(0, 1, 0), trunkH, 0.22 + rand() * 0.06, 0);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + rand();
    parts.push(
      strut(
        new Vector3(0, 0.45, 0),
        new Vector3(Math.cos(a) * 0.65, -0.05, Math.sin(a) * 0.65),
        0.14,
        0.04,
        5,
        0.8,
      ),
    );
  }
  return groundAo(mergeParts(parts), 0, 1, 0.55);
}

/** Gnarled roots arching out of the ground and back in (about 2 m across). */
export function rootsGeometry(seed: number): BufferGeometry {
  const rand = mulberry32(seed);
  const parts: BufferGeometry[] = [];
  const n = 4 + Math.floor(rand() * 3);
  for (let k = 0; k < n; k++) {
    const a = rand() * Math.PI * 2;
    const len = 0.8 + rand() * 1.2;
    const h = 0.15 + rand() * 0.35;
    const ox = (rand() - 0.5) * 0.6;
    const oz = (rand() - 0.5) * 0.6;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const path = new CatmullRomCurve3([
      new Vector3(ox - c * len * 0.5, -0.12, oz - s * len * 0.5),
      new Vector3(ox - c * len * 0.2 + (rand() - 0.5) * 0.2, h, oz - s * len * 0.2),
      new Vector3(ox + c * len * 0.2, h * 0.8, oz + s * len * 0.2 + (rand() - 0.5) * 0.2),
      new Vector3(ox + c * len * 0.5, -0.12, oz + s * len * 0.5),
    ]);
    parts.push(grain(prep(new TubeGeometry(path, 12, 0.035 + rand() * 0.06, 5, false)), seed + k));
  }
  return groundAo(mergeParts(parts), -0.1, 0.25, 0.5);
}

/**
 * A crystal cluster: `count` hexagonal prisms with pointed tips fanning out from a shared root,
 * the tallest about `size` m. Faceted (drawn flat-shaded).
 */
export function crystalClusterGeometry(seed: number, count: number, size: number): BufferGeometry {
  const rand = mulberry32(seed);
  const parts: BufferGeometry[] = [];
  for (let k = 0; k < count; k++) {
    const h = size * (k === 0 ? 1 : 0.3 + rand() * 0.55);
    const r = h * (0.12 + rand() * 0.05);
    const prism = prep(new CylinderGeometry(r * 0.92, r, h * 0.78, 6, 1), 0.75);
    prism.translate(0, h * 0.39, 0);
    const tip = prep(new ConeGeometry(r * 0.92, h * 0.22, 6, 1), 1);
    tip.translate(0, h * 0.78 + h * 0.11, 0);
    const c = mergeParts([prism, tip]);
    const pos = c.getAttribute('position');
    const col = c.getAttribute('color');
    for (let i = 0; i < pos.count; i++) {
      const t = Math.min(1, pos.getY(i) / h);
      const v = 0.45 + 0.55 * t;
      col.setXYZ(i, v, v, v);
    }
    const tilt = k === 0 ? rand() * 0.15 : 0.35 + rand() * 0.6;
    place(
      c,
      (rand() - 0.5) * size * 0.15,
      -h * 0.05,
      (rand() - 0.5) * size * 0.15,
      tilt,
      rand() * 6.28,
      0,
    );
    c.rotateY(rand() * Math.PI * 2);
    parts.push(c);
  }
  return mergeParts(parts);
}

/** A lumpy stone shard / rubble chunk (unit size), for piles and rims. */
export function chunkGeometry(seed: number): BufferGeometry {
  const g = prep(new IcosahedronGeometry(0.5, 1), 0.9);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = 1 + fbm(x * 2.5 + seed, y * 2.5, z * 2.5, 2) * 0.45;
    pos.setXYZ(i, x * k, Math.max(-0.2, y * k * 0.7), z * k);
  }
  g.computeVertexNormals();
  return groundAo(g, -0.2, 0.25, 0.6);
}

/** Unit box for simple blocks (kept here so props share one attribute layout). */
export function blockGeometry(): BufferGeometry {
  return prep(new BoxGeometry(1, 1, 1));
}
