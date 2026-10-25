import { ConeGeometry, Vector3, type BufferGeometry } from 'three';
import type { CreatureMotion } from '../../data/creatures';
import { ellipsoid, place, sweep, type Surf, type WeightFn } from '../meshKit';
import { S, bump, darken, easeOut, polylineW, rigidW, scaleAbout, smooth } from './shared';
import type { CreaturePlan, PlanBone, PoseInput, PoseOut } from './types';

const NECK = ['N0', 'N1', 'N2', 'N3'] as const;
const TAIL = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5'] as const;

/** Raised cobra posture: the coil lies on the ground behind, the neck rears up in front. */
const BONES: PlanBone[] = [
  { name: 'Root', parent: null, pos: [0, 0, 0] },
  { name: 'Core', parent: 'Root', pos: [0, 0.27, -0.2] },
  { name: 'N0', parent: 'Core', pos: [0, 0.1, 0.3] },
  { name: 'N1', parent: 'N0', pos: [0, 0.3, 0.12] },
  { name: 'N2', parent: 'N1', pos: [0, 0.3, 0.02] },
  { name: 'N3', parent: 'N2', pos: [0, 0.26, 0] },
  { name: 'Head', parent: 'N3', pos: [0, 0.14, 0.1] },
  { name: 'Jaw', parent: 'Head', pos: [0, -0.08, 0.054] },
  { name: 'T0', parent: 'Core', pos: [0.06, -0.04, -0.34] },
  { name: 'T1', parent: 'T0', pos: [0.12, -0.03, -0.32] },
  { name: 'T2', parent: 'T1', pos: [0.08, -0.03, -0.31] },
  { name: 'T3', parent: 'T2', pos: [-0.06, -0.03, -0.29] },
  { name: 'T4', parent: 'T3', pos: [-0.1, -0.02, -0.26] },
  { name: 'T5', parent: 'T4', pos: [-0.06, -0.02, -0.23] },
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
    case 'tailSwipe': {
      // Coil the tail one way, then whip the whole body round.
      const swing = tele ? -0.7 * e : -0.7 + 2.1 * easeOut(Math.min(1, t * 2.2));
      const k = tele ? 1 : 1 - smooth(Math.max(0, t - 0.55) * 2.2);
      add('Core', 0, 0.55 * swing * k);
      TAIL.forEach((b, i) =>
        add(
          b,
          0,
          -0.35 * swing * k * (1 - i * 0.12) + 0.25 * Math.sin(time * 9 - i) * k * (tele ? 0 : 1),
        ),
      );
      add('N0', 0.15 * k, -0.3 * swing * k);
      add('N1', 0.1 * k);
      break;
    }
    case 'breath': {
      if (tele) {
        // Rear high, throat swelling.
        add('N0', -0.25 * e);
        add('N1', -0.2 * e);
        add('N2', -0.15 * e);
        add('Head', -0.25 * e);
        add('Jaw', 0.25 * e);
      } else {
        // Stream fire down and across.
        const sweepY = 0.35 * Math.sin(t * Math.PI * 2);
        add('N0', 0.15);
        add('N1', 0.2, sweepY * 0.5);
        add('N2', 0.15, sweepY * 0.5);
        add('Head', 0.3 + 0.04 * Math.sin(time * 22));
        add('Jaw', 0.8);
      }
      break;
    }
    case 'spit': {
      if (tele) {
        add('N1', -0.3 * e);
        add('N2', -0.2 * e);
        add('Head', -0.2 * e);
        add('Jaw', 0.2 * e);
      } else {
        const j = bump(t, 0, 0.5);
        add('N1', 0.35 * j - 0.3 * (1 - Math.min(1, t * 5)));
        add('N2', 0.25 * j);
        add('Head', 0.2 * j);
        add('Jaw', 0.9 * bump(t, 0, 0.6));
      }
      break;
    }
    case 'burrow': {
      if (tele) {
        // Dive: the head plunges forward into the ground (the brain sinks the body).
        const d = smooth(Math.min(1, t * 2.4));
        add('N0', 0.7 * d);
        add('N1', 0.6 * d);
        add('N2', 0.4 * d);
        add('Head', 0.5 * d);
        add('Jaw', 0.3 * d);
        TAIL.forEach((b, i) => add(b, 0, 0.3 * Math.sin(time * 10 - i * 0.9) * d));
      } else {
        // Burst out rearing, jaw wide.
        const k = 1 - smooth(Math.max(0, t - 0.4) * 1.7);
        add('N0', -0.35 * k);
        add('N1', -0.3 * k);
        add('N2', -0.2 * k);
        add('Head', -0.35 * k, 0.2 * Math.sin(time * 12) * k);
        add('Jaw', 0.85 * k);
      }
      break;
    }
    case 'stomp':
    case 'pounce':
    case 'charge': {
      // Body slam: rear back, then crash the neck down on the target.
      if (tele) {
        add('Core', -0.12 * e);
        add('N0', -0.3 * e);
        add('N1', -0.35 * e);
        add('N2', -0.2 * e);
        add('Head', -0.2 * e);
        add('Jaw', 0.4 * e);
        lift = 0.08 * e;
      } else {
        const s = easeOut(Math.min(1, t * 3.2));
        const k = 1 - smooth(Math.max(0, t - 0.55) * 2.2);
        add('Core', (-0.12 + 0.3 * s) * k);
        add('N0', (-0.3 + 1.0 * s) * k);
        add('N1', (-0.35 + 0.8 * s) * k);
        add('N2', (-0.2 + 0.4 * s) * k);
        add('Head', (-0.2 + 0.25 * s) * k);
        add('Jaw', 0.6 * k);
        lift = 0.08 * (1 - s);
      }
      break;
    }
    case 'howl':
    case 'summon': {
      const k = tele ? e : 1 - smooth(Math.max(0, t - 0.6) * 2.5);
      add('N0', -0.3 * k);
      add('N1', -0.25 * k);
      add('N2', -0.2 * k);
      add('Head', -0.55 * k, 0.15 * Math.sin(time * 6) * k);
      add('Jaw', (tele ? 0.4 : 0.9) * k);
      lift = 0.06 * k;
      break;
    }
    default: {
      // Strike: coil the neck back into an S, then snap forward.
      if (tele) {
        add('N0', -0.2 * e);
        add('N1', -0.45 * e);
        add('N2', 0.3 * e);
        add('N3', 0.25 * e);
        add('Head', -0.15 * e);
        add('Jaw', 0.3 * e);
      } else {
        const l = bump(t, 0, 0.75);
        const coil = 1 - Math.min(1, t * 5);
        add('N0', -0.2 * coil + 0.55 * l);
        add('N1', -0.45 * coil + 0.55 * l);
        add('N2', 0.3 * coil + 0.15 * l);
        add('N3', 0.25 * coil);
        add('Head', 0.15 * l);
        add('Jaw', 0.9 * bump(t, 0, 0.45));
      }
    }
  }
  return lift;
}

/** Nearest point on a polyline and the direction of that segment (first → last). */
function nearest(points: readonly Vector3[], p: Vector3, outC: Vector3, outD: Vector3): number {
  const ab = new Vector3();
  const ap = new Vector3();
  let best = Infinity;
  let bestU = 0;
  let bestI = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a === undefined || b === undefined) continue;
    ab.subVectors(b, a);
    ap.subVectors(p, a);
    const u = Math.min(1, Math.max(0, ap.dot(ab) / (ab.lengthSq() || 1)));
    const d = ap.addScaledVector(ab, -u).lengthSq();
    if (d < best) {
      best = d;
      bestI = i;
      bestU = u;
      outD.copy(ab);
    }
  }
  const a = points[bestI] ?? p;
  const b = points[bestI + 1] ?? a;
  outC.lerpVectors(a, b, bestU);
  outD.normalize();
  return (bestI + bestU) / Math.max(1, points.length - 1);
}

/** Giant serpent (the Cinder Wyrm): reared neck with a hood, coiled tail, burrows and breathes fire. */
export const wyrmPlan: CreaturePlan = {
  bones: BONES,
  core: { Spine: 'Core', Chest: 'N1', Head: 'Head' },
  bodyBone: 'Core',
  tail: ['T0', 'T1', 'T2', 'T3', 'T4', 'T5'],
  sockets: {
    rightBase: { bone: 'T5', offset: new Vector3(0, 0, 0) },
    rightTip: { bone: 'T5', offset: new Vector3(0, 0, -0.3) },
    leftBase: { bone: 'Jaw', offset: new Vector3(0, -0.02, 0.04) },
    leftTip: { bone: 'Jaw', offset: new Vector3(0, -0.02, 0.3) },
  },
  build(def, body, glow, bi, bind) {
    const c = def.colors;
    const hide = S.chitin(c.body);
    const plates = S.horn(c.plates);
    const beltA = S.hide(c.belly);
    const beltB = S.hide(darken(c.belly, 0.72));
    const H = bind('Head');
    const J = bind('Jaw');
    const iHead = bi('Head');
    const iJaw = bi('Jaw');

    // One continuous body: tail tip → coil → neck → head, weighted along the chain.
    const chain = ['T5', ...[...TAIL].reverse().slice(1), 'Core', ...NECK, 'Head'];
    const joints = chain.map((n) => bind(n));
    const tip = (joints[0] ?? new Vector3()).clone().add(new Vector3(-0.02, -0.01, -0.28));
    const pts = [tip, ...joints];
    const ids = [bi('T5'), ...chain.map((n) => bi(n))];
    const W = polylineW(ids, pts);
    // Radius along the body: thin tail tip, thick coil, slimmer neck, a little swell at the head.
    const rad = (k: number): number => {
      if (k < 0.55) return 0.025 + 0.24 * Math.pow(k / 0.55, 0.8);
      if (k < 0.85) return 0.265 - 0.13 * ((k - 0.55) / 0.3);
      return 0.135 - 0.02 * ((k - 0.85) / 0.15);
    };
    const centre = new Vector3();
    const dir = new Vector3();
    const off = new Vector3();
    const dorsal = new Vector3();
    const X = new Vector3(1, 0, 0);
    const skin = (v: Vector3): Surf => {
      const k = nearest(pts, v, centre, dir);
      off.subVectors(v, centre).normalize();
      dorsal.crossVectors(dir, X).normalize();
      const d = off.dot(dorsal);
      if (d < -0.35) return Math.floor(k * 46) % 2 === 0 ? beltA : beltB;
      return d > 0.75 ? S.chitin(darken(c.body, 0.75)) : hide;
    };
    body.add(sweep(pts, rad, 54, 12), skin, W);

    // Back spikes along the coil and neck, pointing out of the back and raking toward the tail.
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (a === undefined || b === undefined) continue;
      const k = i / (pts.length - 1);
      const r = rad(k);
      dir.subVectors(b, a).normalize();
      dorsal.crossVectors(dir, X).normalize();
      for (const u of [0, 0.5]) {
        const at = a
          .clone()
          .lerp(b, u)
          .addScaledVector(dorsal, r * 0.85);
        const h = 0.06 + 0.12 * Math.min(1, r / 0.2);
        const pitch = Math.atan2(dorsal.z, dorsal.y) - 0.45;
        body.add(place(new ConeGeometry(0.03 + r * 0.12, h, 5), at, [pitch, 0, 0]), plates, W);
      }
    }

    // Hood: two flared ribbed wings behind the neck, glowing eye-spots on the front.
    const N1 = bind('N1');
    const N2 = bind('N2');
    const N3 = bind('N3');
    const hoodW = polylineW([bi('N1'), bi('N2'), bi('N3')], [N1, N2, N3]);
    for (const s of [1, -1]) {
      body.add(
        ellipsoid(
          [N2.x + s * 0.17, N2.y + 0.04, N2.z - 0.05],
          [0.2, 0.3, 0.035],
          [12, 8],
          undefined,
          [0, s * 0.35, s * -0.12],
        ),
        hide,
        hoodW,
      );
      for (let r = 0; r < 3; r++) {
        body.add(
          sweep(
            [
              new Vector3(N2.x + s * 0.05, N2.y - 0.12 + r * 0.12, N2.z - 0.04),
              new Vector3(N2.x + s * 0.22, N2.y - 0.1 + r * 0.14, N2.z - 0.07),
              new Vector3(N2.x + s * 0.34, N2.y - 0.12 + r * 0.17, N2.z - 0.12),
            ],
            (k) => 0.018 * (1 - 0.7 * k),
            6,
            5,
          ),
          plates,
          hoodW,
        );
      }
      glow.add(
        ellipsoid([N2.x + s * 0.2, N2.y + 0.1, N2.z - 0.012], [0.03, 0.045, 0.006], [8, 6]),
        S.glow(c.glow),
        hoodW,
      );
    }

    // Head parts are modelled at base size, then scaled up about the head bone.
    const hb = {
      add: (g: BufferGeometry, sf: Surf, w: WeightFn): void =>
        body.add(scaleAbout(g, H, 1.35), sf, w),
    };
    const hg = {
      add: (g: BufferGeometry, sf: Surf, w: WeightFn): void =>
        glow.add(scaleAbout(g, H, 1.35), sf, w),
    };
    // Head: long wedge skull, brow ridges, swept horns, jaw, fangs, eyes, burning mouth.
    hb.add(
      ellipsoid([H.x, H.y + 0.01, H.z + 0.1], [0.13, 0.085, 0.2], [14, 10]),
      hide,
      rigidW(iHead),
    );
    hb.add(
      ellipsoid([H.x, H.y - 0.01, H.z + 0.26], [0.085, 0.055, 0.12], [12, 8]),
      hide,
      rigidW(iHead),
    );
    for (const s of [1, -1]) {
      hb.add(
        ellipsoid(
          [H.x + s * 0.07, H.y + 0.065, H.z + 0.12],
          [0.045, 0.025, 0.11],
          [8, 6],
          undefined,
          [0, s * 0.15, 0],
        ),
        plates,
        rigidW(iHead),
      );
      const o = new Vector3(H.x + s * 0.08, H.y + 0.06, H.z - 0.02);
      hb.add(
        sweep(
          [
            o,
            o.clone().add(new Vector3(s * 0.08, 0.06, -0.14)),
            o.clone().add(new Vector3(s * 0.1, 0.02, -0.34)),
          ],
          (k) => 0.04 * (1 - 0.88 * k),
          10,
          6,
        ),
        plates,
        rigidW(iHead),
      );
      const o2 = new Vector3(H.x + s * 0.11, H.y - 0.01, H.z + 0.02);
      hb.add(
        sweep(
          [o2, o2.clone().add(new Vector3(s * 0.08, -0.02, -0.12))],
          (k) => 0.022 * (1 - 0.9 * k),
          6,
          5,
        ),
        plates,
        rigidW(iHead),
      );
      hg.add(
        ellipsoid([H.x + s * 0.085, H.y + 0.035, H.z + 0.2], [0.026, 0.016, 0.014], [8, 6]),
        S.glow(c.eyes),
        rigidW(iHead),
      );
      // Fangs: long curved, hanging from the upper jaw front.
      const f = new Vector3(H.x + s * 0.045, H.y - 0.05, H.z + 0.3);
      hb.add(
        sweep(
          [
            f,
            f.clone().add(new Vector3(0, -0.07, 0.02)),
            f.clone().add(new Vector3(0, -0.13, -0.02)),
          ],
          (k) => 0.014 * (1 - 0.9 * k),
          6,
          5,
        ),
        S.horn(0xb0a490),
        rigidW(iHead),
      );
    }
    hb.add(
      ellipsoid([J.x, J.y - 0.025, J.z + 0.18], [0.09, 0.035, 0.18], [12, 6]),
      S.hide(c.belly),
      rigidW(iJaw),
    );
    hg.add(
      ellipsoid([J.x, J.y + 0.012, J.z + 0.16], [0.06, 0.012, 0.13], [10, 4]),
      S.glow(c.glow),
      rigidW(iJaw),
    );
    // Glowing throat under the jaw (swells visually with the glow pulse).
    glow.add(
      ellipsoid([J.x, J.y - 0.08, J.z - 0.02], [0.045, 0.03, 0.05], [10, 6]),
      S.glow(c.glow),
      polylineW([bi('N3'), iHead], [N3, H]),
    );

    // Ember seams down the flanks of the coil.
    for (let i = 2; i < pts.length - 4; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (a === undefined || b === undefined) continue;
      const r = rad(i / (pts.length - 1));
      dir.subVectors(b, a).normalize();
      for (const s of [1, -1]) {
        off
          .crossVectors(dir, new Vector3(0, 1, 0))
          .normalize()
          .multiplyScalar(s * r * 0.96);
        const at = a.clone().lerp(b, 0.5).add(off);
        glow.add(
          place(ellipsoid([0, 0, 0], [0.005, 0.007, r * 0.4], [4, 4]), at, [
            0,
            Math.atan2(dir.x, dir.z),
            0,
          ]),
          S.glow(c.glow),
          W,
        );
      }
    }
  },
  pose(inp: PoseInput, out: PoseOut): number {
    const { time, gait, moving } = inp;
    const add = (b: string, x: number, y = 0, z = 0): void => {
      const cur = out.get(b) ?? [0, 0, 0];
      out.set(b, [cur[0] + x, cur[1] + y, cur[2] + z]);
    };
    // Slither: a sideways wave travels down the tail; it grows with speed. The neck sways
    // gently against it so the head stays on the target.
    const ph = Math.PI * 2 * gait;
    const idle = 0.12;
    TAIL.forEach((b, i) => {
      const amp =
        idle * (1 - moving) * Math.sin(time * 1.4 - i * 0.8) +
        moving * 0.5 * Math.sin(ph - i * 1.1);
      out.set(b, [0.02 * Math.sin(time * 1.1 - i), amp, 0]);
    });
    out.set('Core', [0.02 * Math.sin(time * 1.6), moving * 0.25 * Math.sin(ph + 1.2), 0]);
    // Breathing rise and the slow weave of a watching serpent.
    const weave = Math.sin(time * 1.15);
    out.set('N0', [
      0.03 * Math.sin(time * 1.6) + moving * 0.25,
      -moving * 0.2 * Math.sin(ph + 1.2),
      0,
    ]);
    out.set('N1', [0.02 * Math.sin(time * 1.6 + 0.6) + moving * 0.12, 0.09 * weave, 0.05 * weave]);
    out.set('N2', [
      0.02 * Math.sin(time * 1.6 + 1.2),
      0.07 * Math.sin(time * 1.15 - 0.7),
      -0.04 * weave,
    ]);
    out.set('N3', [-moving * 0.2, 0.05 * Math.sin(time * 1.15 - 1.4), 0]);
    out.set('Head', [-moving * 0.15 + 0.03 * Math.sin(time * 0.9), 0, 0]);
    out.set('Jaw', [0.04 + 0.03 * Math.max(0, Math.sin(time * 0.7)), 0, 0]);
    let lift = 0;
    switch (inp.mode) {
      case 'tele':
      case 'strike':
        lift += motionPose(inp.motion, inp.mode === 'tele', inp.t, time, out);
        break;
      case 'roar': {
        const e = smooth(Math.min(1, inp.t * 3)) * (1 - smooth(Math.max(0, inp.t - 0.8) * 5));
        add('N0', -0.25 * e);
        add('N1', -0.2 * e);
        add('Head', -0.55 * e, 0.18 * Math.sin(time * 5) * e);
        add('Jaw', 0.85 * e);
        TAIL.forEach((b, i) => add(b, 0, 0.25 * Math.sin(time * 8 - i) * e));
        break;
      }
      case 'stagger':
      case 'knockdown': {
        const down = inp.mode === 'knockdown' ? 1 : 0.4;
        add('N0', 0.45 * down, 0.15 * Math.sin(time * 5));
        add('N1', 0.35 * down, 0.15 * Math.sin(time * 5 - 0.6));
        add('N2', 0.2 * down);
        add('Head', 0.2 * down, 0.2 * Math.sin(time * 6));
        add('Jaw', 0.3);
        lift -= 0.06 * down;
        break;
      }
      case 'getup': {
        const k = 1 - smooth(inp.t);
        add('N0', 0.45 * k);
        add('N1', 0.35 * k);
        add('N2', 0.2 * k);
        break;
      }
      case 'death': {
        // The neck topples and the body rolls onto its side.
        const e = smooth(inp.t * 1.25);
        add('Core', 0, 0, 1.1 * e);
        add('N0', 0.9 * e);
        add('N1', 0.7 * e);
        add('N2', 0.4 * e);
        add('N3', 0.3 * e);
        add('Jaw', 0.5 * e);
        TAIL.forEach((b, i) => add(b, 0, 0.12 * e * (i % 2 === 0 ? 1 : -1)));
        lift -= 0.12 * e;
        break;
      }
      case 'spawn': {
        // Rises out of the ground.
        const k = 1 - smooth(inp.t);
        lift -= 1.5 * k;
        add('N0', -0.3 * k);
        add('Head', -0.4 * k);
        add('Jaw', 0.7 * k);
        break;
      }
      default:
        break;
    }
    return lift;
  },
};
