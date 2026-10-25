import { ConeGeometry, Vector3, type BufferGeometry } from 'three';
import type { CreatureMotion } from '../../data/creatures';
import { ellipsoid, place, sweep, type Surf, type WeightFn } from '../meshKit';
import { S, bump, darken, easeOut, polylineW, rigidW, scaleAbout, smooth } from './shared';
import type { CreaturePlan, PlanBone, PoseInput, PoseOut } from './types';

const SIDES = [
  { s: 1, tag: 'L' },
  { s: -1, tag: 'R' },
] as const;

const BONES: PlanBone[] = [
  { name: 'Root', parent: null, pos: [0, 0, 0] },
  { name: 'Pelvis', parent: 'Root', pos: [0, 0.78, -0.42] },
  { name: 'Spine', parent: 'Pelvis', pos: [0, 0.04, 0.4] },
  { name: 'Chest', parent: 'Spine', pos: [0, 0.05, 0.38] },
  { name: 'Neck', parent: 'Chest', pos: [0, 0.06, 0.25] },
  { name: 'Head', parent: 'Neck', pos: [0, 0.02, 0.22] },
  { name: 'Jaw', parent: 'Head', pos: [0, -0.084, 0.07] },
  { name: 'Tail0', parent: 'Pelvis', pos: [0, 0.08, -0.18] },
  { name: 'Tail1', parent: 'Tail0', pos: [0, -0.06, -0.24] },
  { name: 'Tail2', parent: 'Tail1', pos: [0, -0.07, -0.24] },
  ...SIDES.flatMap(({ s, tag }): PlanBone[] => [
    { name: `F${tag}a`, parent: 'Chest', pos: [s * 0.17, -0.12, 0.03] },
    { name: `F${tag}b`, parent: `F${tag}a`, pos: [0, -0.32, 0.03] },
    { name: `F${tag}c`, parent: `F${tag}b`, pos: [0, -0.33, -0.01] },
    { name: `B${tag}a`, parent: 'Pelvis', pos: [s * 0.16, -0.06, -0.02] },
    { name: `B${tag}b`, parent: `B${tag}a`, pos: [0, -0.3, 0.1] },
    { name: `B${tag}c`, parent: `B${tag}b`, pos: [0, -0.22, -0.14] },
    { name: `B${tag}d`, parent: `B${tag}c`, pos: [0, -0.18, 0.04] },
  ]),
];

function motionPose(
  m: CreatureMotion | null,
  tele: boolean,
  t: number,
  time: number,
  out: PoseOut,
): number {
  const e = smooth(t);
  const add = (b: string, x: number, y = 0, z = 0): void => {
    const cur = out.get(b) ?? [0, 0, 0];
    out.set(b, [cur[0] + x, cur[1] + y, cur[2] + z]);
  };
  let lift = 0;
  switch (m) {
    case 'claw': {
      // Rise onto the haunches and rake with the right forepaw.
      const k = tele ? e : 1 - easeOut(Math.min(1, t * 2.5));
      add('Pelvis', -0.22 * k);
      add('BLa', 0.22 * k);
      add('BRa', 0.22 * k);
      add(
        'FRa',
        -1.2 * k + (tele ? 0 : 1.4 * bump(t, 0, 0.5)),
        0,
        -0.3 * (tele ? 0 : bump(t, 0, 0.6)),
      );
      add('FRb', 0.9 * k);
      add('Neck', -0.15 * k);
      break;
    }
    case 'pounce':
    case 'charge': {
      if (tele) {
        lift = -0.12 * e;
        add('Neck', 0.35 * e);
        for (const { tag } of SIDES) {
          add(`F${tag}a`, 0.25 * e);
          add(`F${tag}b`, -0.5 * e);
          add(`B${tag}a`, -0.45 * e);
          add(`B${tag}b`, 0.5 * e);
        }
        if (m === 'charge') add('FRa', 0.35 * Math.sin(time * 14) * e);
      } else {
        // Full-stretch gallop.
        const ph = time * 2 * Math.PI * 2.6;
        for (const { tag } of SIDES) {
          add(`F${tag}a`, -0.75 * Math.sin(ph));
          add(`F${tag}b`, 0.6 * Math.max(0, Math.cos(ph)));
          add(`B${tag}a`, 0.7 * Math.sin(ph + 0.6));
          add(`B${tag}b`, -0.5 * Math.max(0, Math.cos(ph + 0.6)));
        }
        add('Spine', 0.08 * Math.sin(ph * 2));
        add('Neck', 0.3);
        lift = 0.06 * Math.abs(Math.sin(ph));
      }
      break;
    }
    case 'howl':
    case 'summon': {
      const k = tele ? e : 1 - smooth(Math.max(0, t - 0.6) * 2.5);
      add('Pelvis', 0.3 * k);
      for (const { tag } of SIDES) {
        add(`B${tag}a`, -0.75 * k);
        add(`B${tag}b`, 0.9 * k);
        add(`B${tag}c`, -0.5 * k);
        add(`F${tag}a`, -0.3 * k);
      }
      lift = -0.12 * k;
      add('Neck', -0.95 * k);
      add('Head', -0.3 * k);
      add('Jaw', 0.55 * k * (tele ? 0.4 : 1));
      break;
    }
    case 'breath': {
      if (tele) {
        add('Neck', -0.45 * e);
        add('Head', -0.2 * e);
        add('Chest', -0.08 * e);
        add('Jaw', 0.3 * e);
      } else {
        add('Neck', 0.25 + 0.05 * Math.sin(time * 20));
        add('Head', 0.1, 0.35 * Math.sin(t * Math.PI * 2));
        add('Jaw', 0.75);
      }
      break;
    }
    case 'stomp': {
      // Rear up on the hind legs, then slam down.
      const k = tele ? e : 1 - easeOut(Math.min(1, t * 3.5));
      add('Pelvis', -0.75 * k);
      for (const { tag } of SIDES) {
        add(`B${tag}a`, 0.75 * k);
        add(`F${tag}a`, -0.7 * k + 0.4 * Math.sin(time * 8) * k);
        add(`F${tag}b`, 0.8 * k);
      }
      add('Neck', -0.3 * k);
      add('Jaw', 0.4 * k);
      lift = tele ? 0.05 * e : -0.06 * bump(t, 0.15, 0.7);
      break;
    }
    case 'tailSwipe': {
      const k = tele ? e : 1 - smooth(Math.max(0, t - 0.5) * 2);
      const swing = tele ? -0.6 * e : -0.6 + 1.6 * easeOut(Math.min(1, t * 2.5));
      add('Pelvis', 0, 0.45 * swing);
      add('Chest', 0, -0.25 * swing);
      add('Tail0', 0, 0.9 * swing * k, 0);
      add('Tail1', 0, 0.6 * swing * k, 0);
      break;
    }
    default: {
      // Bite: draw back, lunge, snap.
      if (tele) {
        add('Neck', -0.35 * e);
        add('Head', -0.15 * e);
        add('Jaw', 0.25 * e);
        add('Chest', -0.06 * e);
      } else {
        const l = bump(t, 0, 0.7);
        add('Neck', -0.35 * (1 - Math.min(1, t * 4)) + 0.45 * l);
        add('Head', 0.25 * l);
        add('Jaw', 0.8 * bump(t, 0, 0.45));
        add('Spine', 0.08 * l);
        lift = -0.05 * l;
      }
    }
  }
  return lift;
}

/** Four-legged ash beast (Behemoth, hounds): trot, bite, claw rake, charge, howl, fire breath. */
export const beastPlan: CreaturePlan = {
  bones: BONES,
  core: { Spine: 'Spine', Chest: 'Chest', Head: 'Head' },
  bodyBone: 'Pelvis',
  tail: ['Tail0', 'Tail1', 'Tail2'],
  sockets: {
    rightBase: { bone: 'FRc', offset: new Vector3(0, -0.02, 0.02) },
    rightTip: { bone: 'FRc', offset: new Vector3(0, -0.06, 0.16) },
    leftBase: { bone: 'Jaw', offset: new Vector3(0, -0.02, 0.02) },
    leftTip: { bone: 'Jaw', offset: new Vector3(0, -0.02, 0.24) },
  },
  build(def, body, glow, bi, bind) {
    const c = def.colors;
    const hide = S.hide(c.body);
    const belly = S.hide(c.belly);
    const plates = S.horn(c.plates);
    const P = bind('Pelvis');
    const Sp = bind('Spine');
    const C = bind('Chest');
    const N = bind('Neck');
    const H = bind('Head');
    // Torso: rump → deep chest → neck, weighted along the spine.
    const pts = [
      new Vector3(0, 0.8, -0.62),
      new Vector3(0, 0.82, -0.4),
      new Vector3(0, 0.8, -0.04),
      new Vector3(0, 0.86, 0.32),
      new Vector3(0, 0.94, 0.52),
      new Vector3(0, 0.95, 0.7),
    ];
    const rad = (k: number): number =>
      k < 0.2
        ? 0.18 + 0.4 * k
        : k < 0.45
          ? 0.26 - 0.1 * (k - 0.2)
          : k < 0.7
            ? 0.235 + 0.4 * (k - 0.45)
            : 0.335 - 0.75 * (k - 0.7);
    const torsoW = polylineW(
      [bi('Pelvis'), bi('Pelvis'), bi('Spine'), bi('Chest'), bi('Neck'), bi('Head')],
      [new Vector3(0, 0.8, -0.62), P, Sp, C, N, H],
    );
    const torso = sweep(pts, rad, 22, 14);
    // Deeper chest and belly: stretch the lower half downward.
    const pos = torso.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const centre = 0.8 + Math.max(0, z + 0.04) * 0.25;
      if (y < centre) pos.setY(i, centre + (y - centre) * (z > 0 ? 1.35 : 1.1));
    }
    torso.computeVertexNormals();
    body.add(torso, (v) => (v.y < 0.7 ? belly : hide), torsoW);
    // Spinal ridge of plates.
    for (let k = 0; k < 7; k++) {
      const z = -0.5 + k * 0.17;
      const y = 0.98 + (z > 0.2 ? (z - 0.2) * 0.45 : 0) + 0.02 * Math.sin(k);
      body.add(
        place(
          new ConeGeometry(0.045, 0.16 - Math.abs(k - 3) * 0.015, 6),
          [0, y + 0.04, z],
          [-0.5, 0, 0],
        ),
        plates,
        torsoW,
      );
    }
    // Shoulder hump: a mane of long backswept spikes fanned around the top of the chest.
    for (let k = 0; k < 9; k++) {
      const a = (k / 8 - 0.5) * 2.3;
      const h = 0.34 - Math.abs(a) * 0.1;
      body.add(
        place(
          new ConeGeometry(0.055, h, 6),
          [Math.sin(a) * 0.3, 0.88 + Math.cos(a) * 0.3, 0.3 - Math.abs(a) * 0.05 + (k % 2) * 0.08],
          [-0.8, 0, -a],
        ),
        plates,
        torsoW,
      );
    }
    // Head parts are modelled at base size, then scaled up about the head bone.
    const hb = {
      add: (g: BufferGeometry, sf: Surf, w: WeightFn): void =>
        body.add(scaleAbout(g, H, 1.4), sf, w),
    };
    const hg = {
      add: (g: BufferGeometry, sf: Surf, w: WeightFn): void =>
        glow.add(scaleAbout(g, H, 1.4), sf, w),
    };
    // Head: skull, snout, jaw with teeth, horns, eyes.
    const iHead = bi('Head');
    const iJaw = bi('Jaw');
    hb.add(
      ellipsoid([H.x, H.y + 0.02, H.z + 0.04], [0.14, 0.12, 0.16], [14, 10]),
      hide,
      rigidW(iHead),
    );
    hb.add(
      ellipsoid([H.x, H.y - 0.02, H.z + 0.2], [0.085, 0.07, 0.15], [12, 8]),
      hide,
      rigidW(iHead),
    );
    const J = bind('Jaw');
    hb.add(
      ellipsoid([J.x, J.y - 0.02, J.z + 0.13], [0.075, 0.035, 0.13], [12, 6]),
      belly,
      rigidW(iJaw),
    );
    for (let k = 0; k < 4; k++) {
      for (const s of [1, -1]) {
        hb.add(
          place(new ConeGeometry(0.012, 0.05, 4), [
            s * (0.05 - k * 0.006),
            J.y + 0.02,
            J.z + 0.08 + k * 0.045,
          ]),
          S.horn(0xa89c88),
          rigidW(iJaw),
        );
        hb.add(
          place(
            new ConeGeometry(0.012, 0.05, 4),
            [s * (0.055 - k * 0.006), H.y - 0.07, H.z + 0.1 + k * 0.045],
            [Math.PI, 0, 0],
          ),
          S.horn(0xa89c88),
          rigidW(iHead),
        );
      }
    }
    for (const s of [1, -1]) {
      const o = new Vector3(H.x + s * 0.09, H.y + 0.1, H.z - 0.02);
      hb.add(
        sweep(
          [
            o,
            o.clone().add(new Vector3(s * 0.08, 0.1, -0.06)),
            o.clone().add(new Vector3(s * 0.1, 0.12, -0.22)),
          ],
          (k) => 0.035 * (1 - 0.85 * k),
          8,
          6,
        ),
        plates,
        rigidW(iHead),
      );
      hg.add(
        ellipsoid([H.x + s * 0.075, H.y + 0.05, H.z + 0.15], [0.022, 0.016, 0.012], [8, 6]),
        S.glow(c.eyes),
        rigidW(iHead),
      );
    }
    // Ember cracks along the flanks and a glowing throat.
    for (let k = 0; k < 6; k++) {
      for (const s of [1, -1]) {
        glow.add(
          place(
            ellipsoid([0, 0, 0], [0.006, 0.07, 0.008], [4, 4]),
            [s * (0.24 + (k % 2) * 0.02), 0.78 - (k % 3) * 0.04, -0.4 + k * 0.15],
            [0.3 * k, 0, s * 0.4],
          ),
          S.glow(c.glow),
          torsoW,
        );
      }
    }
    // Legs.
    for (const { s, tag } of SIDES) {
      for (const front of [true, false]) {
        const names = front
          ? [`F${tag}a`, `F${tag}b`, `F${tag}c`]
          : [`B${tag}a`, `B${tag}b`, `B${tag}c`, `B${tag}d`];
        const joints = names.map((n) => bind(n));
        const ids = names.map((n) => bi(n));
        const paw = joints[joints.length - 1] ?? new Vector3();
        const top = joints[0] ?? paw;
        const upper = front ? 0.12 : 0.115;
        body.add(
          sweep(
            [top.clone().add(new Vector3(0, 0.08, 0)), ...joints],
            (k) => upper * (1 - 0.55 * k),
            16,
            9,
          ),
          hide,
          polylineW(ids, joints),
        );
        body.add(
          ellipsoid([paw.x, paw.y - 0.02, paw.z + 0.05], [0.065, 0.045, 0.09], [10, 6]),
          S.hide(darken(c.body, 0.8)),
          rigidW(ids[ids.length - 1] ?? 0),
        );
        for (let k = -1; k <= 1; k++) {
          body.add(
            place(
              new ConeGeometry(0.012, 0.06, 4),
              [paw.x + k * 0.03, paw.y - 0.03, paw.z + 0.14],
              [Math.PI / 2, 0, 0],
            ),
            plates,
            rigidW(ids[ids.length - 1] ?? 0),
          );
        }
        void s;
      }
    }
    // Tail.
    const T = ['Tail0', 'Tail1', 'Tail2'].map((n) => bind(n));
    const end = (T[2] ?? P).clone().add(new Vector3(0, -0.05, -0.22));
    body.add(
      sweep([...T, end], (k) => 0.07 * (1 - 0.8 * k), 14, 8),
      hide,
      polylineW([bi('Tail0'), bi('Tail1'), bi('Tail2'), bi('Tail2')], [...T, end]),
    );
    body.add(
      place(
        new ConeGeometry(0.04, 0.12, 6),
        [end.x, end.y - 0.02, end.z - 0.04],
        [-Math.PI / 2 - 0.3, 0, 0],
      ),
      plates,
      rigidW(bi('Tail2')),
    );
  },
  pose(inp: PoseInput, out: PoseOut): number {
    const { time, gait, moving } = inp;
    let lift = 0;
    // Trot: diagonal pairs.
    for (const { s, tag } of SIDES) {
      const phF = Math.PI * 2 * (gait + (s > 0 ? 0 : 0.5));
      const phB = phF + Math.PI;
      const upF = Math.max(0, Math.cos(phF));
      const upB = Math.max(0, Math.cos(phB));
      out.set(`F${tag}a`, [-0.45 * moving * Math.sin(phF), 0, 0]);
      out.set(`F${tag}b`, [0.9 * moving * upF, 0, 0]);
      out.set(`B${tag}a`, [-0.42 * moving * Math.sin(phB), 0, 0]);
      out.set(`B${tag}b`, [-0.5 * moving * upB, 0, 0]);
      out.set(`B${tag}c`, [0.7 * moving * upB, 0, 0]);
    }
    lift += moving * 0.035 * Math.abs(Math.sin(Math.PI * 2 * gait));
    out.set('Chest', [0.04 * Math.sin(time * 1.6), 0, 0]);
    out.set('Neck', [0.05 * Math.sin(time * 1.3) + moving * 0.1, 0, 0]);
    out.set('Head', [moving * 0.06 * Math.sin(Math.PI * 4 * gait), 0, 0]);
    out.set('Jaw', [0.05 + 0.03 * Math.sin(time * 2.4), 0, 0]);
    out.set('Tail0', [-0.15 - 0.25 * moving, 0.3 * Math.sin(time * 2.6), 0]);
    out.set('Tail1', [0.1, 0.3 * Math.sin(time * 2.6 - 0.8), 0]);
    out.set('Tail2', [0.1, 0.3 * Math.sin(time * 2.6 - 1.6), 0]);
    const add = (b: string, x: number, y = 0, z = 0): void => {
      const cur = out.get(b) ?? [0, 0, 0];
      out.set(b, [cur[0] + x, cur[1] + y, cur[2] + z]);
    };
    switch (inp.mode) {
      case 'tele':
      case 'strike':
        lift += motionPose(inp.motion, inp.mode === 'tele', inp.t, time, out);
        break;
      case 'roar': {
        const e = smooth(Math.min(1, inp.t * 3)) * (1 - smooth(Math.max(0, inp.t - 0.8) * 5));
        add('Neck', -0.7 * e);
        add('Head', -0.25 * e, 0.15 * Math.sin(time * 5) * e);
        add('Jaw', 0.7 * e);
        add('FLa', -0.5 * e * (0.5 + 0.5 * Math.sin(time * 6)));
        break;
      }
      case 'stagger':
      case 'knockdown':
        add('Neck', 0.35, 0.2 * Math.sin(time * 6));
        add('Pelvis', 0, 0, 0.12 * Math.sin(time * 5));
        lift -= inp.mode === 'knockdown' ? 0.25 : 0.1;
        break;
      case 'getup':
        lift -= 0.25 * (1 - inp.t);
        break;
      case 'death': {
        const e = smooth(inp.t * 1.3);
        add('Pelvis', 0, 0, 1.35 * e);
        lift -= 0.5 * e;
        add('Neck', 0.4 * e);
        add('Jaw', 0.4 * e);
        break;
      }
      case 'spawn':
        lift -= 1.0 * (1 - smooth(inp.t));
        break;
      default:
        break;
    }
    return lift;
  },
};
