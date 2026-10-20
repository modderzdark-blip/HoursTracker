import { ConeGeometry, Vector3 } from 'three';
import type { CreatureMotion } from '../../data/creatures';
import { ellipsoid, place, sweep } from '../meshKit';
import { S, bump, darken, easeOut, polylineW, rigidW, smooth } from './shared';
import type { CreaturePlan, PlanBone, PoseInput, PoseOut } from './types';

/** Leg layout: horizontal angle from the side toward the front (rad), femur length. */
const LEGS = [
  { angle: 0.8, femur: 0.56 },
  { angle: 0.28, femur: 0.5 },
  { angle: -0.22, femur: 0.5 },
  { angle: -0.7, femur: 0.56 },
] as const;
const SIDES = [
  { s: 1, tag: 'L' },
  { s: -1, tag: 'R' },
] as const;
const BODY_Y = 0.62;
const UP = new Vector3(0, 1, 0);

interface LegGeo {
  readonly hip: Vector3;
  readonly knee: Vector3;
  readonly tip: Vector3;
}

function legGeometry(s: number, i: number): LegGeo {
  const L = LEGS[i] ?? LEGS[0];
  const h = new Vector3(s * Math.cos(L.angle), 0, Math.sin(L.angle));
  const hip = new Vector3(s * 0.2, BODY_Y, 0.16 - i * 0.1);
  const a = h.clone().multiplyScalar(0.8).addScaledVector(UP, 0.62).normalize();
  const knee = hip.clone().addScaledVector(a, L.femur);
  const b = h.clone().multiplyScalar(0.55).addScaledVector(UP, -1).normalize();
  const lenB = knee.y / -b.y;
  const tip = knee.clone().addScaledVector(b, lenB);
  return { hip, knee, tip };
}

function buildBones(): PlanBone[] {
  const bones: PlanBone[] = [
    { name: 'Root', parent: null, pos: [0, 0, 0] },
    { name: 'Body', parent: 'Root', pos: [0, BODY_Y, 0] },
    { name: 'Abdomen', parent: 'Body', pos: [0, 0.1, -0.3] },
    { name: 'Head', parent: 'Body', pos: [0, 0.02, 0.3] },
    { name: 'FangL', parent: 'Head', pos: [0.07, -0.07, 0.14] },
    { name: 'FangR', parent: 'Head', pos: [-0.07, -0.07, 0.14] },
  ];
  for (const { s, tag } of SIDES) {
    for (let i = 0; i < LEGS.length; i++) {
      const g = legGeometry(s, i);
      bones.push(
        { name: `${tag}${i}a`, parent: 'Body', pos: [g.hip.x, g.hip.y - BODY_Y, g.hip.z] },
        {
          name: `${tag}${i}b`,
          parent: `${tag}${i}a`,
          pos: [g.knee.x - g.hip.x, g.knee.y - g.hip.y, g.knee.z - g.hip.z],
        },
        {
          name: `${tag}${i}c`,
          parent: `${tag}${i}b`,
          pos: [g.tip.x - g.knee.x, g.tip.y - g.knee.y, g.tip.z - g.knee.z],
        },
      );
    }
  }
  return bones;
}

function motionPose(m: CreatureMotion | null, tele: boolean, t: number, out: PoseOut): number {
  const e = smooth(t);
  const set = (b: string, x: number, y: number, z: number): void => {
    const cur = out.get(b) ?? [0, 0, 0];
    out.set(b, [cur[0] + x, cur[1] + y, cur[2] + z]);
  };
  let lift = 0;
  const raiseFront = (k: number, pairs: number): void => {
    for (const { s, tag } of SIDES)
      for (let i = 0; i < pairs; i++) {
        set(`${tag}${i}a`, 0, -s * 0.35 * k, s * (0.95 - i * 0.3) * k);
        set(`${tag}${i}b`, 0, 0, s * 0.4 * k);
      }
  };
  switch (m) {
    case 'stab': {
      if (tele) {
        set('Body', -0.35 * e, 0, 0);
        raiseFront(e, 2);
      } else {
        const k = 1 - easeOut(Math.min(1, t * 3));
        set('Body', -0.35 * k + 0.2 * bump(t, 0, 0.6), 0, 0);
        raiseFront(k - 0.35 * bump(t, 0, 0.7), 2);
        lift = -0.08 * bump(t, 0.1, 0.8);
      }
      break;
    }
    case 'spit':
    case 'summon': {
      // Abdomen swings under the body to spray webs / birth the brood.
      const k = tele ? e : 1 - smooth(Math.max(0, t - 0.5) * 2);
      set('Abdomen', 0.85 * k, 0, 0);
      set('Body', -0.18 * k, 0, 0);
      if (!tele) set('Abdomen', 0.12 * Math.sin(t * 40) * (1 - t), 0, 0);
      break;
    }
    case 'pounce': {
      if (tele) {
        lift = -0.2 * e;
        for (const { s, tag } of SIDES)
          for (let i = 0; i < 4; i++) set(`${tag}${i}a`, 0, 0, -s * 0.25 * e);
      } else {
        lift = 0.06 * bump(t, 0, 0.5);
        set('Body', 0.15 * bump(t, 0, 0.6), 0, 0);
        raiseFront(bump(t, 0, 0.5) * 0.7, 2);
      }
      break;
    }
    default: {
      // Bite: rear back, then lunge with the fangs.
      if (tele) {
        set('Body', -0.28 * e, 0, 0);
        set('Head', -0.15 * e, 0, 0);
        raiseFront(0.55 * e, 1);
        set('FangL', 0, 0, 0.5 * e);
        set('FangR', 0, 0, -0.5 * e);
      } else {
        const lunge = bump(t, 0, 0.7);
        set('Body', -0.28 * (1 - Math.min(1, t * 4)) + 0.3 * lunge, 0, 0);
        set('Head', 0.2 * lunge, 0, 0);
        raiseFront(0.55 * (1 - Math.min(1, t * 3)), 1);
        const close = 0.5 * (1 - Math.min(1, t * 5));
        set('FangL', 0, 0, close - 0.15 * lunge);
        set('FangR', 0, 0, -close + 0.15 * lunge);
        lift = -0.04 * lunge;
      }
    }
  }
  return lift;
}

/** Eight-legged brood mother / broodling: tetrapod gait, rearing bites, leg stabs, web spray. */
export const spiderPlan: CreaturePlan = {
  bones: buildBones(),
  core: { Spine: 'Body', Chest: 'Body', Head: 'Head' },
  bodyBone: 'Body',
  sockets: {
    rightBase: { bone: 'FangR', offset: new Vector3(0, 0, 0) },
    rightTip: { bone: 'FangR', offset: new Vector3(0, -0.14, 0.05) },
    leftBase: { bone: 'FangL', offset: new Vector3(0, 0, 0) },
    leftTip: { bone: 'FangL', offset: new Vector3(0, -0.14, 0.05) },
  },
  build(def, body, glow, bi, bind) {
    const c = def.colors;
    const chitin = S.chitin(c.body);
    const band = S.chitin(darken(c.body, 0.6));
    const plates = S.chitin(c.plates);
    const belly = S.hide(c.belly);
    const B = bind('Body');
    const iBody = bi('Body');
    // Cephalothorax: armoured top, softer underside.
    body.add(
      ellipsoid([B.x, B.y, B.z], [0.3, 0.19, 0.34], [16, 10]),
      (v) => (v.y < B.y - 0.04 ? belly : chitin),
      rigidW(iBody),
    );
    body.add(
      ellipsoid([B.x, B.y + 0.07, B.z + 0.02], [0.24, 0.12, 0.28], [14, 8], {
        thetaLength: Math.PI * 0.5,
      }),
      plates,
      rigidW(iBody),
    );
    // Abdomen with glowing chevrons.
    const A = bind('Abdomen');
    const iAbd = bi('Abdomen');
    const ac = new Vector3(A.x, A.y + 0.12, A.z - 0.42);
    body.add(
      ellipsoid([ac.x, ac.y, ac.z], [0.46, 0.4, 0.58], [18, 12]),
      (v) => (v.y < ac.y - 0.12 ? belly : chitin),
      polylineW([iBody, iAbd], [B, ac]),
    );
    for (let k = 0; k < 3; k++) {
      const z = ac.z + 0.25 - k * 0.2;
      for (const s of [1, -1]) {
        glow.add(
          place(
            ellipsoid([0, 0, 0], [0.12 - k * 0.02, 0.012, 0.03], [8, 4]),
            [s * 0.08, ac.y + 0.37 - k * 0.04, z],
            [0, s * 0.6, 0],
          ),
          S.glow(c.glow),
          rigidW(iAbd),
        );
      }
    }
    body.add(
      place(new ConeGeometry(0.06, 0.16, 8), [ac.x, ac.y - 0.05, ac.z - 0.6], [-Math.PI / 2, 0, 0]),
      plates,
      rigidW(iAbd),
    );
    // Head, eight eyes, fangs.
    const H = bind('Head');
    const iHead = bi('Head');
    body.add(
      ellipsoid([H.x, H.y, H.z + 0.06], [0.17, 0.14, 0.18], [14, 10]),
      chitin,
      rigidW(iHead),
    );
    const eyes: [number, number, number, number][] = [
      [0.05, 0.08, 0.2, 0.035],
      [-0.05, 0.08, 0.2, 0.035],
      [0.11, 0.06, 0.17, 0.025],
      [-0.11, 0.06, 0.17, 0.025],
      [0.03, 0.12, 0.16, 0.02],
      [-0.03, 0.12, 0.16, 0.02],
      [0.13, 0.1, 0.1, 0.02],
      [-0.13, 0.1, 0.1, 0.02],
    ];
    for (const [x, y, z, r] of eyes)
      glow.add(
        ellipsoid([H.x + x, H.y + y, H.z + z], [r, r, r * 0.7], [8, 6]),
        S.glow(c.eyes),
        rigidW(iHead),
      );
    for (const [name, s] of [
      ['FangL', 1],
      ['FangR', -1],
    ] as const) {
      const F = bind(name);
      body.add(
        sweep(
          [
            F,
            F.clone().add(new Vector3(s * 0.01, -0.07, 0.04)),
            F.clone().add(new Vector3(-s * 0.025, -0.15, 0.02)),
          ],
          (k) => 0.026 * (1 - 0.9 * k),
          8,
          6,
        ),
        S.horn(c.plates),
        rigidW(bi(name)),
      );
    }
    // Legs: femur + tibia with joint knobs and banding.
    for (const { s, tag } of SIDES) {
      for (let i = 0; i < LEGS.length; i++) {
        const g = legGeometry(s, i);
        const ia = bi(`${tag}${i}a`);
        const ib = bi(`${tag}${i}b`);
        const ic = bi(`${tag}${i}c`);
        const midA = g.hip.clone().lerp(g.knee, 0.5).addScaledVector(UP, 0.04);
        body.add(
          sweep([g.hip, midA, g.knee], (k) => 0.055 - 0.015 * k, 10, 8),
          (v) => (Math.floor(v.distanceTo(g.hip) / 0.14) % 2 === 0 ? chitin : plates),
          rigidW(ia),
        );
        body.add(
          ellipsoid([g.knee.x, g.knee.y, g.knee.z], [0.05, 0.05, 0.05], [8, 6]),
          plates,
          polylineW([ia, ib], [g.hip, g.tip]),
        );
        const midB = g.knee
          .clone()
          .lerp(g.tip, 0.45)
          .add(new Vector3(s * 0.04, 0, 0));
        body.add(
          sweep([g.knee, midB, g.tip], (k) => 0.042 * (1 - 0.75 * k), 12, 7),
          (v) => (Math.floor(v.distanceTo(g.knee) / 0.16) % 2 === 0 ? chitin : band),
          polylineW([ib, ib, ic], [g.knee, midB, g.tip]),
        );
      }
    }
  },
  pose(inp: PoseInput, out: PoseOut): number {
    const { time, gait, moving } = inp;
    let lift = 0.015 * Math.sin(time * 2.2);
    // Breathing abdomen.
    out.set('Abdomen', [0.04 * Math.sin(time * 1.8), 0, 0]);
    // Gait: alternating tetrapod (L0 R1 L2 R3 vs the rest).
    for (const { s, tag } of SIDES) {
      for (let i = 0; i < LEGS.length; i++) {
        const group = (i + (s > 0 ? 0 : 1)) % 2;
        const ph = Math.PI * 2 * (gait + group * 0.5);
        const swing = moving * 0.32 * Math.sin(ph);
        const up =
          moving * Math.max(0, Math.cos(ph)) * 0.32 + 0.03 * Math.sin(time * 3 + i * 1.7 + s);
        out.set(`${tag}${i}a`, [0, -s * swing, s * up]);
        out.set(`${tag}${i}b`, [0, 0, -s * up * 0.5]);
      }
    }
    lift += moving * 0.03 * Math.abs(Math.sin(Math.PI * 4 * gait));
    const add = (b: string, x: number, y: number, z: number): void => {
      const cur = out.get(b) ?? [0, 0, 0];
      out.set(b, [cur[0] + x, cur[1] + y, cur[2] + z]);
    };
    switch (inp.mode) {
      case 'tele':
      case 'strike':
        lift += motionPose(inp.motion, inp.mode === 'tele', inp.t, out);
        break;
      case 'roar': {
        const e = smooth(Math.min(1, inp.t * 3)) * (1 - smooth(Math.max(0, inp.t - 0.8) * 5));
        add('Body', -0.5 * e, 0, 0);
        add('Abdomen', -0.3 * e, 0, 0);
        for (const { s, tag } of SIDES)
          for (let i = 0; i < 2; i++)
            add(
              `${tag}${i}a`,
              0,
              -s * 0.3 * e,
              s * (1.0 - i * 0.35 + 0.15 * Math.sin(time * 9 + i)) * e,
            );
        add('FangL', 0, 0, 0.5 * e);
        add('FangR', 0, 0, -0.5 * e);
        break;
      }
      case 'stagger':
      case 'knockdown':
        add('Body', 0.08 * Math.sin(time * 6), 0, 0.18 * Math.sin(time * 7));
        lift -= inp.mode === 'knockdown' ? 0.22 : 0.1;
        for (const { s, tag } of SIDES)
          for (let i = 0; i < 4; i++)
            add(`${tag}${i}a`, 0, 0, -s * (0.2 + 0.06 * Math.sin(time * 14 + i)));
        break;
      case 'getup':
        lift -= 0.22 * (1 - inp.t);
        break;
      case 'death': {
        const e = smooth(inp.t * 1.4);
        lift -= 0.5 * e;
        add('Body', 0, 0, 0.25 * e);
        for (const { s, tag } of SIDES)
          for (let i = 0; i < 4; i++) {
            add(`${tag}${i}a`, 0, 0, s * 0.7 * e);
            add(`${tag}${i}b`, 0, 0, -s * 1.3 * e);
          }
        break;
      }
      case 'spawn':
        lift -= 0.9 * (1 - smooth(inp.t));
        break;
      default:
        break;
    }
    return lift;
  },
};
