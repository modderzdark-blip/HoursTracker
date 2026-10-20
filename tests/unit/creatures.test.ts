import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CreatureAnimator } from '../../src/anim/creatures/CreatureAnimator';
import { CreatureRig } from '../../src/anim/creatures/CreatureRig';
import { BOSSES, type BossId } from '../../src/data/bosses';
import { CREATURES, type CreatureId, type CreatureMotion } from '../../src/data/creatures';
import { ENEMIES } from '../../src/data/enemies';

const ids = Object.keys(CREATURES) as CreatureId[];
const MOTIONS: CreatureMotion[] = [
  'bite',
  'claw',
  'stab',
  'spit',
  'pounce',
  'charge',
  'howl',
  'breath',
  'stomp',
  'tailSwipe',
  'burrow',
  'summon',
];
const motionMap = new Map<string, CreatureMotion>(MOTIONS.map((m) => [m, m]));

describe('creature bodies', () => {
  it.each(ids)('%s builds valid skinned geometry within the triangle budget', (id) => {
    const rig = new CreatureRig(CREATURES[id]);
    for (const g of [rig.mesh.geometry, rig.glow.geometry]) {
      const w = g.getAttribute('skinWeight');
      const idx = g.getAttribute('skinIndex');
      for (let i = 0; i < w.count; i += 5) {
        expect(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i)).toBeCloseTo(1, 3);
        for (const k of [idx.getX(i), idx.getY(i), idx.getZ(i), idx.getW(i)])
          expect(k).toBeLessThan(rig.skeleton.bones.length);
      }
    }
    const tris = (rig.mesh.geometry.getIndex()?.count ?? 0) / 3;
    expect(tris).toBeGreaterThan(1500);
    // Minions (broodlings, hounds) come in packs: tighter budget than the bosses.
    expect(tris).toBeLessThan(CREATURES[id].scale < 1.5 ? 9000 : 14000);
    rig.dispose();
  });

  it.each(ids)('%s: every mode and motion gives a finite pose and blends without jumps', (id) => {
    const rig = new CreatureRig(CREATURES[id]);
    const anim = new CreatureAnimator(rig.plan, rig.bones, motionMap);
    const names = [
      'idle',
      'run',
      'roar',
      'stagger',
      'knockdown',
      'getup',
      'death',
      'spawn',
      ...MOTIONS.flatMap((m) => [`${m}:tele`, `${m}:strike`]),
    ];
    const head = rig.bone('Head');
    const prev = new Quaternion();
    for (const name of names) {
      expect(anim.has(name), name).toBe(true);
      anim.play(name, { durationSec: 0.8, fade: 0.12, restart: true });
      prev.copy(head.quaternion);
      anim.update(1 / 60);
      // The first frame of a new clip stays close to the last pose (cross-fade from a snapshot).
      expect(head.quaternion.angleTo(prev), name).toBeLessThan(0.35);
      for (let i = 0; i < 50; i++) anim.update(1 / 60);
      for (const b of rig.bones.values()) {
        const q = b.quaternion;
        expect(Number.isFinite(q.x + q.y + q.z + q.w), `${name} ${b.name}`).toBe(true);
      }
    }
    expect(anim.has('nonsense')).toBe(false);
    rig.dispose();
  });

  it('the run cycle moves the legs / tail and the head looks toward the target', () => {
    for (const id of ['brood_weaver', 'ash_behemoth', 'cinder_wyrm'] as const) {
      const rig = new CreatureRig(CREATURES[id]);
      const anim = new CreatureAnimator(rig.plan, rig.bones, motionMap);
      anim.play('run', { loop: true, durationSec: 0.6, fade: 0 });
      const tip = new Vector3();
      const seen: number[] = [];
      for (let i = 0; i < 60; i++) {
        anim.update(1 / 60);
        rig.root.updateMatrixWorld(true);
        rig.socketWorld('rightTip', tip);
        seen.push(tip.x + tip.y + tip.z);
      }
      expect(Math.max(...seen) - Math.min(...seen), id).toBeGreaterThan(0.05);
      anim.play('idle', { loop: true, fade: 0 });
      anim.setLookYaw(0.8);
      for (let i = 0; i < 60; i++) anim.update(1 / 60);
      const fwd = new Vector3(0, 0, 1).applyQuaternion(
        rig.bone('Head').getWorldQuaternion(new Quaternion()),
      );
      expect(fwd.x, id).toBeGreaterThan(0.1);
      rig.dispose();
    }
  });
});

describe('creature data', () => {
  const creatureBosses = (Object.keys(BOSSES) as BossId[]).filter(
    (id) => BOSSES[id].creature !== undefined,
  );

  it('there are three creature bosses with different body plans', () => {
    const plans = new Set(
      creatureBosses.map((id) => CREATURES[BOSSES[id].creature ?? 'broodling'].plan),
    );
    expect(plans).toEqual(new Set(['spider', 'beast', 'wyrm']));
  });

  it.each(creatureBosses)('%s: every phase attack exists and has a motion', (id) => {
    const def = BOSSES[id];
    for (const ph of def.phases)
      for (const a of ph.attacks) {
        const atk = def.attacks.find((x) => x.id === a);
        expect(atk, a).toBeDefined();
        expect(atk?.motion, a).toBeDefined();
      }
    for (const a of def.attacks) {
      if (a.chainNext !== undefined)
        expect(def.attacks.some((x) => x.id === a.chainNext)).toBe(true);
      if (a.summon !== undefined) expect(ENEMIES[a.summon.enemy]).toBeDefined();
    }
  });
});
