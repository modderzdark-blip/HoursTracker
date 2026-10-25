import { ConeGeometry, Vector3 } from 'three';
import type { CreatureMotion } from '../../data/creatures';
import { ellipsoid, place, sweep } from '../meshKit';
import { S, bump, darken, easeOut, mixHex, polylineW, rigidW, smooth } from './shared';
import type { CreaturePlan, PlanBone, PoseInput, PoseOut } from './types';

const TAIL = ['T0', 'T1', 'T2', 'T3'] as const;
const SIDES = [
  { s: 1, tag: 'L' },
  { s: -1, tag: 'R' },
] as const;

/** A floating spirit: a charred skull mask over a burning core, flame tendrils trailing below. */
const BONES: PlanBone[] = [
  { name: 'Root', parent: null, pos: [0, 0, 0] },
  { name: 'Core', parent: 'Root', pos: [0, 1.15, 0] },
  { name: 'Head', parent: 'Core', pos: [0, 0.16, 0.06] },
  { name: 'Jaw', parent: 'Head', pos: [0, -0.07, 0.05] },
  { name: 'T0', parent: 'Core', pos: [0, -0.14, -0.04] },
  { name: 'T1', parent: 'T0', pos: [0, -0.17, -0.05] },
  { name: 'T2', parent: 'T1', pos: [0, -0.16, -0.05] },
  { name: 'T3', parent: 'T2', pos: [0, -0.14, -0.04] },
  ...SIDES.flatMap(({ s, tag }): PlanBone[] => [
    { name: `S${tag}0`, parent: 'Core', pos: [s * 0.16, 0.02, 0] },
    { name: `S${tag}1`, parent: `S${tag}0`, pos: [s * 0.16, -0.06, -0.04] },
    { name: `S${tag}2`, parent: `S${tag}1`, pos: [s * 0.14, -0.08, -0.05] },
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
  switch (m) {
    case 'summon':
    case 'howl': {
      // Flare: arms of flame thrown wide, the core rising.
      const k = tele ? e : 1 - smooth(Math.max(0, t - 0.5) * 2);
      for (const { s, tag } of SIDES) {
        add(`S${tag}0`, 0, 0, s * 0.9 * k);
        add(`S${tag}1`, 0, 0, s * 0.5 * k);
      }
      add('Head', -0.4 * k);
      add('Jaw', 0.6 * k);
      return 0.25 * k;
    }
    case 'pounce':
    case 'charge': {
      const k = tele ? e : 1 - easeOut(Math.min(1, t * 2));
      add('Core', tele ? -0.5 * e : 0.6 * (1 - t));
      for (const tag of TAIL) add(tag, tele ? 0.2 * e : -0.4 * k);
      return tele ? 0.15 * e : -0.1 * k;
    }
    default: {
      // Spit: rear back, then lunge the mask forward with the jaw wide.
      if (tele) {
        add('Core', -0.35 * e);
        add('Head', -0.3 * e);
        add('Jaw', 0.35 * e);
        for (const { s, tag } of SIDES) add(`S${tag}0`, 0, -s * 0.4 * e, s * 0.5 * e);
        return 0.1 * e;
      }
      const l = bump(t, 0, 0.6);
      add('Core', 0.35 * l - 0.35 * (1 - Math.min(1, t * 5)));
      add('Head', 0.25 * l);
      add('Jaw', 0.9 * bump(t, 0, 0.5));
      for (const { s, tag } of SIDES) add(`S${tag}0`, 0, s * 0.5 * l, -s * 0.2 * l);
      void time;
      return 0;
    }
  }
}

/** Ember wisps and other floating spirits. */
export const wispPlan: CreaturePlan = {
  bones: BONES,
  core: { Spine: 'Core', Chest: 'Core', Head: 'Head' },
  bodyBone: 'Core',
  tail: ['T0', 'T1', 'T2', 'T3'],
  additiveGlow: true,
  sockets: {
    rightBase: { bone: 'Jaw', offset: new Vector3(0, -0.02, 0.04) },
    rightTip: { bone: 'Jaw', offset: new Vector3(0, -0.02, 0.22) },
    leftBase: { bone: 'Core', offset: new Vector3(0, 0, 0.1) },
    leftTip: { bone: 'Core', offset: new Vector3(0, 0, 0.3) },
  },
  build(def, body, glow, bi, bind) {
    const c = def.colors;
    const shell = S.horn(c.body);
    const bone = S.horn(c.plates);
    const H = bind('Head');
    const J = bind('Jaw');
    const C = bind('Core');
    const iHead = bi('Head');
    const iJaw = bi('Jaw');
    const iCore = bi('Core');
    // Burning core (glow), with a hot inner heart.
    glow.add(
      ellipsoid([C.x, C.y, C.z], [0.15, 0.19, 0.15], [14, 10]),
      S.glow(mixHex(c.glow, c.eyes, 0.25)),
      rigidW(iCore),
    );
    glow.add(
      ellipsoid([C.x, C.y + 0.02, C.z + 0.02], [0.08, 0.1, 0.08], [10, 8]),
      S.glow(c.eyes),
      rigidW(iCore),
    );
    // Charred skull mask with brow ridge, cheek bones and small horns.
    body.add(
      ellipsoid([H.x, H.y + 0.02, H.z], [0.12, 0.13, 0.12], [14, 10], {
        phiStart: -Math.PI / 2,
        phiLength: Math.PI,
      }),
      shell,
      rigidW(iHead),
    );
    body.add(
      ellipsoid([H.x, H.y + 0.07, H.z + 0.06], [0.11, 0.035, 0.06], [10, 6]),
      bone,
      rigidW(iHead),
    );
    for (const s of [1, -1]) {
      body.add(
        ellipsoid([H.x + s * 0.07, H.y - 0.03, H.z + 0.07], [0.035, 0.03, 0.04], [8, 6]),
        bone,
        rigidW(iHead),
      );
      const o = new Vector3(H.x + s * 0.07, H.y + 0.1, H.z);
      body.add(
        sweep(
          [
            o,
            o.clone().add(new Vector3(s * 0.05, 0.08, -0.05)),
            o.clone().add(new Vector3(s * 0.04, 0.16, -0.14)),
          ],
          (k) => 0.025 * (1 - 0.85 * k),
          8,
          5,
        ),
        bone,
        rigidW(iHead),
      );
      glow.add(
        ellipsoid([H.x + s * 0.045, H.y + 0.02, H.z + 0.1], [0.025, 0.02, 0.01], [8, 6]),
        S.glow(c.eyes),
        rigidW(iHead),
      );
    }
    // Jaw with teeth.
    body.add(
      ellipsoid([J.x, J.y - 0.02, J.z + 0.03], [0.07, 0.03, 0.06], [10, 6]),
      shell,
      rigidW(iJaw),
    );
    for (let k = -2; k <= 2; k++) {
      body.add(
        place(new ConeGeometry(0.008, 0.03, 4), [J.x + k * 0.02, J.y + 0.005, J.z + 0.07]),
        S.horn(0xc8bca8),
        rigidW(iJaw),
      );
    }
    // Flame tendrils trailing below (glow), weighted along the tail chain.
    const T = TAIL.map((n) => bind(n));
    const tip = (T[3] ?? C).clone().add(new Vector3(0, -0.12, -0.03));
    const pts = [C.clone().add(new Vector3(0, -0.05, 0)), ...T, tip];
    const ids = [iCore, ...TAIL.map((n) => bi(n)), bi('T3')];
    // White-hot near the core, the flame colour along the body, smouldering at the tips.
    const flame = (v: Vector3, reach: number): number => {
      const k = Math.min(1, v.distanceTo(C) / reach);
      return k < 0.3
        ? mixHex(c.eyes, c.glow, k / 0.3)
        : mixHex(c.glow, darken(c.glow, 0.25), (k - 0.3) / 0.7);
    };
    glow.add(
      sweep(pts, (k) => 0.13 * (1 - 0.9 * k), 16, 8),
      (v) => S.glow(flame(v, 0.75)),
      polylineW(ids, pts),
    );
    for (const { tag } of SIDES) {
      const P = [C, bind(`S${tag}0`), bind(`S${tag}1`), bind(`S${tag}2`)];
      const sid = [iCore, bi(`S${tag}0`), bi(`S${tag}1`), bi(`S${tag}2`)];
      glow.add(
        sweep(P, (k) => 0.06 * (1 - 0.85 * k), 10, 6),
        (v) => S.glow(flame(v, 0.55)),
        polylineW(sid, P),
      );
    }
  },
  pose(inp: PoseInput, out: PoseOut): number {
    const { time, gait, moving } = inp;
    // Hover: bob and sway; tendrils ripple; faster when drifting.
    let lift = 0.07 * Math.sin(time * 2.2) + 0.05;
    out.set('Core', [0.05 * Math.sin(time * 1.7) + moving * 0.35, 0, 0.06 * Math.sin(time * 1.3)]);
    TAIL.forEach((b, i) => {
      out.set(b, [
        0.2 * Math.sin(time * 3 - i * 0.9) + moving * 0.25,
        0,
        0.25 * Math.sin(time * 2.4 - i * 1.1),
      ]);
    });
    for (const { s, tag } of SIDES)
      for (let i = 0; i < 3; i++)
        out.set(`S${tag}${i}`, [
          0.15 * Math.sin(time * 2.6 + i),
          0,
          s * 0.25 * Math.sin(time * 3.1 - i * 0.8 + s),
        ]);
    out.set('Jaw', [0.08 + 0.06 * Math.max(0, Math.sin(time * 1.9)), 0, 0]);
    void gait;
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
        lift += motionPose('summon', true, Math.min(1, inp.t * 2), time, out);
        break;
      case 'stagger':
      case 'knockdown':
        add('Core', -0.4, 0.3 * Math.sin(time * 9));
        add('Head', 0.3);
        lift -= 0.15;
        break;
      case 'getup':
        lift -= 0.3 * (1 - inp.t);
        break;
      case 'death': {
        // Gutters out: sinks, the mask tips forward, tendrils go limp.
        const e = smooth(inp.t * 1.4);
        add('Head', 0.8 * e);
        add('Jaw', 0.5 * e);
        TAIL.forEach((b) => add(b, 0.3 * e));
        lift -= 1.05 * e;
        break;
      }
      case 'spawn':
        lift -= 1.2 * (1 - smooth(inp.t));
        break;
      default:
        break;
    }
    return lift;
  },
};
