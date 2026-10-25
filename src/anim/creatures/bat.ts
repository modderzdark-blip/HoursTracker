import { BufferAttribute, BufferGeometry, ConeGeometry, Vector3 } from 'three';
import type { CreatureMotion } from '../../data/creatures';
import { ellipsoid, flipFaces, place, type WeightFn } from '../meshKit';
import { S, bump, darken, easeIn, polylineW, rigidW, smooth } from './shared';
import type { CreaturePlan, PlanBone, PoseInput, PoseOut } from './types';

const SIDES = [
  { s: 1, tag: 'L' },
  { s: -1, tag: 'R' },
] as const;

/** A hovering bat-thing: furred body, big ears, three-bone wings with membranes. */
const BONES: PlanBone[] = [
  { name: 'Root', parent: null, pos: [0, 0, 0] },
  { name: 'Body', parent: 'Root', pos: [0, 1.45, 0] },
  { name: 'Head', parent: 'Body', pos: [0, 0.07, 0.15] },
  { name: 'Jaw', parent: 'Head', pos: [0, -0.04, 0.05] },
  { name: 'Tail', parent: 'Body', pos: [0, -0.03, -0.16] },
  ...SIDES.flatMap(({ s, tag }): PlanBone[] => [
    { name: `W${tag}0`, parent: 'Body', pos: [s * 0.08, 0.04, 0.02] },
    { name: `W${tag}1`, parent: `W${tag}0`, pos: [s * 0.3, 0.04, -0.02] },
    { name: `W${tag}2`, parent: `W${tag}1`, pos: [s * 0.32, -0.02, -0.06] },
    { name: `F${tag}`, parent: 'Body', pos: [s * 0.06, -0.1, -0.04] },
  ]),
];

/** Wing membrane: a fan from the body to the wing bones with a scalloped trailing edge. */
function membrane(
  points: readonly Vector3[],
  body: Vector3,
  ids: readonly number[],
  iBody: number,
  s: number,
): {
  geo: BufferGeometry;
  weigh: WeightFn;
} {
  const pos: number[] = [];
  const idx: number[] = [];
  // Leading edge along the bones, trailing edge scalloped between finger tips.
  const lead = [body, ...points];
  const trail: Vector3[] = [];
  for (let i = 0; i < lead.length; i++) {
    const p = lead[i] ?? body;
    const sag = i === 0 ? 0.24 : i === lead.length - 1 ? 0.02 : 0.2 - i * 0.04;
    trail.push(new Vector3(p.x - s * 0.02, p.y - 0.04, p.z - sag));
  }
  for (let i = 0; i < lead.length; i++) {
    const a = lead[i] ?? body;
    const b = trail[i] ?? body;
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  for (let i = 0; i < lead.length - 1; i++) {
    const a = i * 2;
    if (s > 0) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geo: g, weigh: polylineW([iBody, ...ids], [body, ...points]) };
}

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
  switch (m) {
    case 'pounce':
    case 'charge':
    case 'bite': {
      if (tele) {
        // Rear up, wings spread high, ready to dive.
        add('Body', -0.6 * e);
        for (const { s, tag } of SIDES) {
          add(`W${tag}0`, 0, 0, s * 0.7 * e);
          add(`W${tag}1`, 0, 0, s * 0.3 * e);
        }
        add('Jaw', 0.5 * e);
        return 0.35 * e;
      }
      // Dive: wings swept back, nose down, jaws snap.
      const d = bump(t, 0, 0.7);
      add('Body', 0.7 * d);
      for (const { s, tag } of SIDES) {
        add(`W${tag}0`, 0, s * 0.9 * d, -s * 0.5 * d);
        add(`W${tag}1`, 0, s * 0.6 * d, 0);
      }
      add('Jaw', 0.8 * bump(t, 0.1, 0.5));
      return -0.75 * easeIn(Math.min(1, t * 1.6)) * (1 - smooth(Math.max(0, t - 0.6) * 2.5));
    }
    default: {
      // Shriek / spit: hang back, head thrown forward.
      const k = tele ? e : 1 - smooth(Math.max(0, t - 0.5) * 2);
      add('Head', -0.35 * k);
      add('Jaw', 0.8 * k);
      void time;
      return 0.2 * k;
    }
  }
}

/** Gloom bats: hovering swarmers that dive at the hero. */
export const batPlan: CreaturePlan = {
  bones: BONES,
  core: { Spine: 'Body', Chest: 'Body', Head: 'Head' },
  bodyBone: 'Body',
  tail: ['Tail'],
  sockets: {
    rightBase: { bone: 'Jaw', offset: new Vector3(0, -0.01, 0.02) },
    rightTip: { bone: 'Jaw', offset: new Vector3(0, -0.01, 0.12) },
    leftBase: { bone: 'WL2', offset: new Vector3(0, 0, 0) },
    leftTip: { bone: 'WL2', offset: new Vector3(0.1, 0, -0.05) },
  },
  build(def, body, glow, bi, bind) {
    const c = def.colors;
    const fur = S.hide(c.body);
    const skin = S.hide(c.belly);
    const B = bind('Body');
    const H = bind('Head');
    const J = bind('Jaw');
    const iBody = bi('Body');
    const iHead = bi('Head');
    body.add(ellipsoid([B.x, B.y, B.z], [0.12, 0.12, 0.18], [12, 10]), fur, rigidW(iBody));
    body.add(
      ellipsoid([B.x, B.y - 0.05, B.z + 0.04], [0.09, 0.07, 0.1], [10, 6]),
      skin,
      rigidW(iBody),
    );
    // Head: skull, snout, big swept ears, fangs, glowing eyes.
    body.add(ellipsoid([H.x, H.y, H.z], [0.08, 0.075, 0.08], [12, 8]), fur, rigidW(iHead));
    body.add(
      ellipsoid([H.x, H.y - 0.015, H.z + 0.07], [0.04, 0.035, 0.05], [10, 6]),
      skin,
      rigidW(iHead),
    );
    body.add(
      ellipsoid([J.x, J.y - 0.01, J.z + 0.04], [0.035, 0.015, 0.04], [8, 4]),
      skin,
      rigidW(bi('Jaw')),
    );
    for (const s of [1, -1]) {
      body.add(
        place(
          new ConeGeometry(0.045, 0.16, 6),
          [H.x + s * 0.05, H.y + 0.1, H.z - 0.01],
          [-0.25, 0, -s * 0.45],
        ),
        skin,
        rigidW(iHead),
      );
      body.add(
        place(
          new ConeGeometry(0.008, 0.04, 4),
          [H.x + s * 0.018, H.y - 0.045, H.z + 0.1],
          [Math.PI, 0, 0],
        ),
        S.horn(0xd8ccb8),
        rigidW(iHead),
      );
      glow.add(
        ellipsoid([H.x + s * 0.035, H.y + 0.02, H.z + 0.07], [0.016, 0.014, 0.01], [8, 6]),
        S.glow(c.eyes),
        rigidW(iHead),
      );
    }
    // Wings: bony arms + membranes (both faces).
    for (const { s, tag } of SIDES) {
      const names = [`W${tag}0`, `W${tag}1`, `W${tag}2`];
      const P = names.map((n) => bind(n));
      const ids = names.map((n) => bi(n));
      const tip = (P[2] ?? B).clone().add(new Vector3(s * 0.12, -0.04, -0.06));
      const arm = [B, ...P, tip];
      for (let i = 0; i < arm.length - 1; i++) {
        const a = arm[i] ?? B;
        const b = arm[i + 1] ?? a;
        const mid = a.clone().lerp(b, 0.5);
        const len = a.distanceTo(b);
        body.add(
          ellipsoid([mid.x, mid.y, mid.z], [len / 2, 0.014, 0.014], [6, 4], undefined, [
            0,
            Math.atan2(-(b.z - a.z), b.x - a.x),
            0,
          ]),
          S.horn(darken(c.plates, 0.8)),
          polylineW([iBody, ...ids, ids[2] ?? iBody], arm),
        );
      }
      const m = membrane([...P, tip], B, [...ids, ids[2] ?? iBody], iBody, s);
      body.add(m.geo, S.hide(darken(c.belly, 0.7)), m.weigh);
      body.add(flipFaces(m.geo.clone()), S.hide(darken(c.belly, 0.55)), m.weigh);
      // Little hanging claws.
      const F = bind(`F${tag}`);
      body.add(
        place(new ConeGeometry(0.015, 0.08, 4), [F.x, F.y, F.z], [Math.PI, 0, 0]),
        S.horn(c.plates),
        rigidW(bi(`F${tag}`)),
      );
    }
    // Glowing veins across the chest.
    glow.add(
      ellipsoid([B.x, B.y - 0.02, B.z + 0.12], [0.03, 0.05, 0.02], [6, 6]),
      S.glow(c.glow),
      rigidW(iBody),
    );
  },
  pose(inp: PoseInput, out: PoseOut): number {
    const { time, moving } = inp;
    // Flap: fast beats, a little faster when flying; body bobs with each beat.
    const f = time * (11 + moving * 3);
    let lift = 0.09 * Math.sin(f + 0.8) + 0.05;
    for (const { s, tag } of SIDES) {
      out.set(`W${tag}0`, [0, 0.15 * s, s * (0.75 * Math.sin(f) + 0.1)]);
      out.set(`W${tag}1`, [0, 0, s * (0.45 * Math.sin(f - 0.7))]);
      out.set(`W${tag}2`, [0, 0, s * (0.3 * Math.sin(f - 1.3))]);
      out.set(`F${tag}`, [0.3 + 0.1 * Math.sin(time * 3), 0, 0]);
    }
    out.set('Body', [0.15 * moving + 0.05 * Math.sin(time * 1.3), 0, 0]);
    out.set('Head', [-0.1 * moving, 0, 0]);
    out.set('Tail', [0.2 * Math.sin(time * 2), 0, 0]);
    const add = (b: string, x: number, y = 0, z = 0): void => {
      const cur = out.get(b) ?? [0, 0, 0];
      out.set(b, [cur[0] + x, cur[1] + y, cur[2] + z]);
    };
    switch (inp.mode) {
      case 'tele':
      case 'strike':
        lift += motionPose(inp.motion, inp.mode === 'tele', inp.t, time, out);
        break;
      case 'roar':
        lift += motionPose('howl', true, Math.min(1, inp.t * 2), time, out);
        break;
      case 'stagger':
      case 'knockdown':
        add('Body', 0.6, 0, 0.4 * Math.sin(time * 8));
        lift -= 0.5;
        break;
      case 'getup':
        lift -= 0.6 * (1 - inp.t);
        break;
      case 'death': {
        // Wings fold, it drops to the ground and rolls.
        const e = smooth(inp.t * 1.5);
        for (const { s, tag } of SIDES) {
          out.set(`W${tag}0`, [0, s * 0.8 * e, s * -0.4 * e]);
          out.set(`W${tag}1`, [0, s * 0.9 * e, 0]);
        }
        add('Body', 0, 0, 1.4 * e);
        lift -= 1.38 * easeIn(Math.min(1, inp.t * 1.8));
        break;
      }
      case 'spawn':
        lift += 1.5 * (1 - smooth(inp.t));
        break;
      default:
        break;
    }
    return lift;
  },
};
