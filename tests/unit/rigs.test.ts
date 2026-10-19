import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { HumanoidRig } from '../../src/anim/HumanoidRig';
import { buildRigTemplate } from '../../src/anim/rigBuilder';
import { RIGS, type RigId } from '../../src/data/rigs';

const ids = Object.keys(RIGS) as RigId[];
/** Rigs that appear in numbers get a tighter triangle budget than heroes and bosses. */
const CROWD: readonly RigId[] = ['thrall', 'imp', 'brute', 'bulwark', 'seer', 'wretch', 'dummy'];

describe('procedural character rigs', () => {
  it.each(ids)('%s builds valid skinned geometry within the triangle budget', (id) => {
    const t = buildRigTemplate(RIGS[id]);
    const g = t.geometry;
    for (const a of ['position', 'normal', 'color', 'surf', 'skinIndex', 'skinWeight'])
      expect(g.getAttribute(a), a).toBeDefined();
    const w = g.getAttribute('skinWeight');
    const idx = g.getAttribute('skinIndex');
    for (let i = 0; i < w.count; i += 7) {
      const sum = w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i);
      expect(sum).toBeCloseTo(1, 3);
      for (const k of [idx.getX(i), idx.getY(i), idx.getZ(i), idx.getW(i)])
        expect(k).toBeLessThan(t.boneCount);
    }
    const tris = (g.getIndex()?.count ?? 0) / 3;
    expect(tris).toBeGreaterThan(1000);
    expect(tris).toBeLessThan(CROWD.includes(id) ? 9000 : 12000);
    const surf = g.getAttribute('surf');
    for (let i = 0; i < surf.count; i += 13) {
      expect(surf.getX(i)).toBeGreaterThanOrEqual(0);
      expect(surf.getX(i)).toBeLessThanOrEqual(1);
      expect(surf.getY(i)).toBeGreaterThanOrEqual(0);
      expect(surf.getY(i)).toBeLessThanOrEqual(1);
    }
    g.dispose();
    t.glowGeometry.dispose();
  });

  it('heroes wear cloth that hangs on spring bones', () => {
    for (const id of ['kael', 'brann', 'lyra'] as const) {
      const t = buildRigTemplate(RIGS[id]);
      expect(t.chains.some((c) => c.kind === 'cape')).toBe(true);
      t.geometry.dispose();
      t.glowGeometry.dispose();
    }
  });

  it('weapon sockets span the blade (trails have length)', () => {
    for (const id of ['kael', 'brann', 'lyra', 'warden'] as const) {
      const t = buildRigTemplate(RIGS[id]);
      expect(t.sockets.rightTip.offset.distanceTo(t.sockets.rightBase.offset)).toBeGreaterThan(0.3);
      t.geometry.dispose();
      t.glowGeometry.dispose();
    }
  });

  it('cloth streams back when running, stays bounded, settles at rest', () => {
    const rig = new HumanoidRig(RIGS.kael);
    const cape = rig.bones.get('Cape1');
    if (cape === undefined) throw new Error('no cape bone');
    for (let i = 0; i < 120; i++) rig.updateSecondary(1 / 60, 7, 0, 0);
    const e = new Vector3(1, 0, 0);
    const running = Math.abs(cape.quaternion.x);
    expect(running).toBeGreaterThan(0.05);
    for (let i = 0; i < 600; i++) rig.updateSecondary(1 / 60, 0, 0, 0);
    expect(Math.abs(cape.quaternion.x)).toBeLessThan(running);
    // A long hitch and wild input never explode.
    rig.updateSecondary(3, 40, -40, 30);
    for (const b of rig.bones.values()) {
      expect(Number.isFinite(b.quaternion.x)).toBe(true);
      expect(Math.abs(b.quaternion.length() - 1)).toBeLessThan(1e-4);
    }
    rig.resetSecondary();
    expect(cape.quaternion.x).toBe(0);
    void e;
    rig.dispose();
  });
});
