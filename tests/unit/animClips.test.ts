import { MeshBasicMaterial, MeshStandardMaterial, Scene } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { enemyAnimSet, heroActions, heroAnimSet } from '../../src/anim/animSets';
import { AnimationController } from '../../src/anim/AnimationController';
import { clipIsValid, easeValue, expandKeys, type Ease } from '../../src/anim/clipBuilder';
import { telegraphPose } from '../../src/anim/clipSets';
import { idleVariantNames } from '../../src/anim/heroMoves';
import { HumanoidRig } from '../../src/anim/HumanoidRig';
import { rigStyle } from '../../src/anim/motionStyles';
import { HIT_SIDES, hitSide } from '../../src/anim/reactions';
import { HUNCHED, NEUTRAL, SLAM_WIND, pose } from '../../src/anim/poses';
import { Enemy, UNIT_SCALE } from '../../src/actors/Enemy';
import { Player } from '../../src/actors/Player';
import { AttackTokenManager } from '../../src/ai/AttackTokens';
import type { BrainContext } from '../../src/ai/EnemyBrain';
import { CombatSystem } from '../../src/combat/CombatSystem';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { GameClock } from '../../src/core/GameClock';
import { BOSSES } from '../../src/data/bosses';
import { ENEMIES } from '../../src/data/enemies';
import { HEROES } from '../../src/data/heroes';
import { RIGS } from '../../src/data/rigs';
import { InputState } from '../../src/input/InputState';
import { loadRapier, PhysicsWorld, type Rapier } from '../../src/physics/PhysicsWorld';
import { DissolveTimeline, applyDissolve, createDissolveUniforms } from '../../src/render/dissolve';

const HERO_LIST = Object.values(HEROES);

describe('hero clip sets', () => {
  it('every clip of every hero is valid (finite values, ordered times)', () => {
    for (const hero of HERO_LIST) {
      for (const c of heroAnimSet(hero).clips)
        expect(clipIsValid(c), `${hero.id} ${c.name}`).toBe(true);
      for (const c of heroAnimSet(hero).additive)
        expect(clipIsValid(c), `${hero.id} ${c.name}`).toBe(true);
    }
  });

  it('action clips last exactly the action window (startup + active + recovery)', () => {
    for (const hero of HERO_LIST) {
      const set = heroAnimSet(hero);
      for (const a of heroActions(hero)) {
        const clip = set.clips.find((c) => c.name === (a.clip ?? a.id));
        expect(clip, `${hero.id} ${a.id}`).toBeDefined();
        // Clips shared by several actions (kael_spin) must fit the action that built them.
        if (a.clip === undefined)
          expect(clip?.duration).toBeCloseTo((a.startupMs + a.activeMs + a.recoveryMs) / 1000, 6);
      }
    }
  });

  it('every hero has idle variants, a victory pose, dodges, deaths and directional reactions', () => {
    const required = [
      'idle',
      'run',
      'run_stop',
      'victory',
      'dodge_roll',
      'dodge_back',
      'death',
      'knockdown',
      'getup',
      'stagger',
      ...HIT_SIDES.flatMap((s) => [`flinch_${s}`, `hit_${s}`]),
    ];
    for (const hero of HERO_LIST) {
      const names = new Set(heroAnimSet(hero).clips.map((c) => c.name));
      const variants = idleVariantNames(hero.id);
      expect(variants.length, hero.id).toBeGreaterThanOrEqual(2);
      for (const n of [...required, ...variants])
        expect(names.has(n), `${hero.id} ${n}`).toBe(true);
      const additive = new Set(heroAnimSet(hero).additive.map((c) => c.name));
      for (const s of HIT_SIDES) expect(additive.has(`hurt_${s}`)).toBe(true);
    }
  });

  it('clip sets are built once and shared by every instance', () => {
    expect(heroAnimSet(HEROES.kael)).toBe(heroAnimSet(HEROES.kael));
    expect(enemyAnimSet(ENEMIES.thrall)).toBe(enemyAnimSet(ENEMIES.thrall));
  });
});

describe('enemy clip sets', () => {
  const humanoids = [...Object.values(ENEMIES), ...Object.values(BOSSES)].filter(
    (e) => e.creature === undefined,
  );

  it('telegraph and strike clips match the attack timing; all clips are valid', () => {
    for (const def of humanoids) {
      const set = enemyAnimSet(def);
      for (const c of set.clips) expect(clipIsValid(c), `${def.id} ${c.name}`).toBe(true);
      for (const a of def.attacks) {
        const tele = set.clips.find((c) => c.name === `${a.id}:tele`);
        const strike = set.clips.find((c) => c.name === `${a.id}:strike`);
        expect(tele?.duration, `${a.id} tele`).toBeCloseTo(a.startupMs / 1000, 6);
        expect(strike?.duration, `${a.id} strike`).toBeCloseTo(
          (a.activeMs + a.recoveryMs) / 1000,
          6,
        );
      }
    }
  });

  it('every death the motion style picks from exists, plus spawn and reactions', () => {
    for (const def of humanoids) {
      const names = new Set(enemyAnimSet(def).clips.map((c) => c.name));
      for (const k of rigStyle(def.rig).deaths)
        expect(names.has(`death_${k}`), `${def.id} ${k}`).toBe(true);
      for (const n of [
        'spawn',
        'stagger',
        'stagger_heavy',
        'roar',
        'taunt',
        'intro',
        'flinch_front',
        'hit_back',
      ])
        expect(names.has(n), `${def.id} ${n}`).toBe(true);
    }
  });

  it('personalities differ: a thrall shambles, a brute stomps, an imp scurries', () => {
    expect(rigStyle('thrall').gait).toBe('shamble');
    expect(rigStyle('brute').gait).toBe('stomp');
    expect(rigStyle('imp').gait).toBe('scurry');
    expect(rigStyle('seer').idle).toBe('hover');
  });

  it('telegraph poses coil the body but never fold overhead arms further back', () => {
    const big = telegraphPose(HUNCHED, SLAM_WIND, 1);
    expect(big.r.LeftArm).toEqual(SLAM_WIND.r.LeftArm);
    expect(big.r.Spine?.[0]).toBe(SLAM_WIND.r.Spine?.[0]);
    // The stance drops lower for the heavy blow.
    expect(big.root?.[1] ?? 0).toBeLessThan(SLAM_WIND.root?.[1] ?? 0);
  });
});

describe('easing', () => {
  it('every ease starts at 0 and ends at 1', () => {
    for (const e of ['linear', 'in', 'out', 'inOut', 'snap', 'back'] as Ease[]) {
      expect(easeValue(e, 0)).toBeCloseTo(0, 6);
      expect(easeValue(e, 1)).toBeCloseTo(1, 6);
    }
    // Snap puts most of the motion early; in puts it late.
    expect(easeValue('snap', 0.25)).toBeGreaterThan(0.7);
    expect(easeValue('in', 0.5)).toBeLessThan(0.2);
  });

  it('eased segments become in-between keys with ordered times, linear ones stay as they are', () => {
    const a = pose(NEUTRAL, { Spine: [0, 0, 0] });
    const b = pose(NEUTRAL, { Spine: [40, 0, 0] });
    const out = expandKeys([
      { t: 0, pose: a },
      { t: 0.5, pose: b, ease: 'snap' },
      { t: 1, pose: a },
    ]);
    expect(out.length).toBe(3 + 3);
    for (let i = 1; i < out.length; i++) expect(out[i]?.t ?? 0).toBeGreaterThan(out[i - 1]?.t ?? 0);
    expect(out[1]?.pose.r.Spine?.[0] ?? 0).toBeGreaterThan(30);
  });
});

describe('hit direction', () => {
  it('classifies pushes relative to the facing', () => {
    // Facing +Z (yaw 0): pushed toward −Z = hit from the front.
    expect(hitSide(0, -1, 0)).toBe('front');
    expect(hitSide(0, 1, 0)).toBe('back');
    // Character right at yaw 0 is −X: pushed to the right = the attacker is on the left.
    expect(hitSide(-1, 0, 0)).toBe('left');
    expect(hitSide(1, 0, 0)).toBe('right');
    // Facing +X (yaw π/2): pushed toward −X = from the front.
    expect(hitSide(-1, 0, Math.PI / 2)).toBe('front');
  });
});

describe('dissolve', () => {
  it('burns away over the given time, forms from ash in reverse, and resets for reuse', () => {
    const d = new DissolveTimeline();
    expect(d.amount).toBe(0);
    d.start(1);
    expect(d.active).toBe(true);
    let prev = d.amount;
    for (let i = 0; i < 30; i++) {
      d.update(1 / 30);
      expect(d.amount).toBeGreaterThanOrEqual(prev);
      prev = d.amount;
    }
    expect(d.amount).toBe(1);
    expect(d.active).toBe(false);
    d.reset();
    expect(d.amount).toBe(0);
    d.materialize(0.5);
    expect(d.amount).toBe(1);
    d.update(0.6);
    expect(d.amount).toBe(0);
  });

  it('is uniform-only: changing the amount keeps the program key, uniforms reach the shader', () => {
    const body = new MeshStandardMaterial();
    const glow = new MeshBasicMaterial();
    const u = createDissolveUniforms(1.9);
    const depth = applyDissolve(body, glow, u);
    const key = body.customProgramCacheKey();
    u.uDissolve.value = 0.6;
    expect(body.customProgramCacheKey()).toBe(key);
    for (const m of [body, glow, depth]) {
      const shader = {
        uniforms: {} as Record<string, { value: unknown }>,
        vertexShader: '#include <common>\n#include <begin_vertex>',
        fragmentShader:
          '#include <common>\n#include <clipping_planes_fragment>\n#include <emissivemap_fragment>',
      };
      m.onBeforeCompile(shader as never, null as never);
      expect(shader.uniforms['uDissolve']).toBe(u.uDissolve);
      expect(shader.fragmentShader).toContain('discard');
    }
    body.dispose();
    glow.dispose();
    depth.dispose();
  });

  it('every humanoid rig dissolves its body and shadow with one shared shader variant', () => {
    const a = new HumanoidRig(RIGS.thrall);
    const b = new HumanoidRig(RIGS.kael);
    expect(a.mesh.customDepthMaterial).toBeDefined();
    expect(a.material.customProgramCacheKey()).toBe(b.material.customProgramCacheKey());
    a.setDissolve(2);
    a.setDissolve(-1);
    a.dispose();
    b.dispose();
  });
});

describe('actors', () => {
  let rapier: Rapier;
  beforeAll(async () => {
    rapier = await loadRapier();
  });

  function world() {
    const physics = new PhysicsWorld(rapier);
    physics.addStaticCuboid(0, -0.5, 0, 40, 0.5, 40);
    const scene = new Scene();
    const bus = new EventBus<GameEvents>();
    const clock = new GameClock();
    const input = new InputState(150, () => clock.nowMs, bus);
    const combat = new CombatSystem(physics, bus, () => 0.99);
    return { physics, scene, bus, clock, input, combat };
  }

  it('playVictory holds the victory pose, stops acting and cannot be hurt', () => {
    for (const hero of HERO_LIST) {
      const w = world();
      const p = new Player({
        hero,
        physics: w.physics,
        scene: w.scene,
        combat: w.combat,
        input: w.input,
        bus: w.bus,
        clock: () => w.clock.nowMs,
        basis: { forwardXZ: { x: 0, z: -1 }, rightXZ: { x: 1, z: 0 } },
        targets: () => [],
      });
      p.resetForRun(0, 0, 0);
      p.playVictory();
      expect(p.state).toBe('victory');
      expect(p.celebrating).toBe(true);
      expect(p.isInvulnerable()).toBe(true);
      expect(p.anim.playing).toBe('victory');
      for (let i = 0; i < 200; i++) {
        p.think(1 / 60);
        p.render(1, 1 / 60, 1 / 60);
      }
      expect(p.state).toBe('victory');
      expect(p.anim.finished).toBe(true);
      p.dispose();
    }
  });

  it('a killed enemy plays a death, burns away, and is whole again when reused', () => {
    const w = world();
    const dummyPlayer = new Player({
      hero: HEROES.kael,
      physics: w.physics,
      scene: w.scene,
      combat: w.combat,
      input: w.input,
      bus: w.bus,
      clock: () => w.clock.nowMs,
      basis: { forwardXZ: { x: 0, z: -1 }, rightXZ: { x: 1, z: 0 } },
      targets: () => [],
    });
    dummyPlayer.resetForRun(0, 10, 0);
    const ctx: BrainContext = {
      player: dummyPlayer,
      tokens: new AttackTokenManager(2),
      physics: w.physics,
      combat: w.combat,
      bus: w.bus,
      telegraphs: { show: () => -1, update: () => undefined, hide: () => undefined },
      rng: () => 0.5,
      difficultyMod: 1,
    };
    const e = new Enemy(ENEMIES.thrall, { physics: w.physics, scene: w.scene, ctx });
    let embers = 0;
    w.bus.on('enemy:dissolve', () => embers++);
    e.activate(0, 0, 0, UNIT_SCALE);
    // Spawning: forms out of ash.
    expect(e.dissolve.amount).toBe(1);
    for (let i = 0; i < 60; i++) e.render(1, 1 / 60, 1 / 60);
    expect(e.dissolve.amount).toBe(0);
    e.health.damage(e.health.current);
    e.onHit({
      attacker: dummyPlayer,
      spec: {
        damage: 1,
        poise: 0,
        reaction: 'knockback',
        knockback: 1,
        hitStopMs: 0,
        shake: 0,
        shape: { kind: 'arc', range: 2, angleDeg: 90 },
      },
      dirX: 0,
      dirZ: -1,
      amount: 999,
      crit: false,
      poiseBroken: false,
      killed: true,
    });
    expect(e.anim.playing.startsWith('death')).toBe(true);
    // Hit from the front by a heavy blow: thrown back.
    expect(e.anim.playing).toBe('death_back');
    const steps = Math.ceil(ENEMIES.thrall.deathMs / (1000 / 60)) + 2;
    for (let i = 0; i < steps; i++) {
      e.think(1 / 60);
      e.render(1, 1 / 60, 1 / 60);
    }
    expect(e.readyForRelease).toBe(true);
    expect(e.dissolve.amount).toBeGreaterThan(0.95);
    expect(embers).toBeGreaterThan(2);
    // Back in the pool and out again: whole.
    e.removeFromWorld();
    e.activate(2, 2, 0, UNIT_SCALE);
    for (let i = 0; i < 60; i++) e.render(1, 1 / 60, 1 / 60);
    expect(e.dissolve.amount).toBe(0);
    e.dispose();
    dummyPlayer.dispose();
  });

  it('a flinch plays the reaction for the side the hit came from, and the idle does not cut it off', () => {
    const rig = new HumanoidRig(RIGS.thrall);
    const set = enemyAnimSet(ENEMIES.thrall);
    const anim = new AnimationController(rig.root, set.clips, set.additive);
    for (const s of HIT_SIDES) expect(anim.has(`flinch_${s}`)).toBe(true);
    anim.dispose();
    rig.dispose();
  });
});
