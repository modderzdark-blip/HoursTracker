import { Scene } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../../src/actors/Actor';
import { Enemy, UNIT_SCALE } from '../../src/actors/Enemy';
import { Player } from '../../src/actors/Player';
import { TrainingDummy } from '../../src/actors/TrainingDummy';
import { AttackTokenManager } from '../../src/ai/AttackTokens';
import { DuelistBrain } from '../../src/ai/DuelistBrain';
import type { BrainContext } from '../../src/ai/EnemyBrain';
import { CombatSystem } from '../../src/combat/CombatSystem';
import { Effects, type EffectVisuals } from '../../src/combat/Effects';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { GameClock } from '../../src/core/GameClock';
import type { ActionDef, HitSpec } from '../../src/data/combatTypes';
import { ENEMIES } from '../../src/data/enemies';
import { HEROES, type HeroDef, type HeroId } from '../../src/data/heroes';
import { INPUT_SOURCE } from '../../src/input/actions';
import { InputState } from '../../src/input/InputState';
import { separateCrowd } from '../../src/modes/crowd';
import { loadRapier, PhysicsWorld, type Rapier } from '../../src/physics/PhysicsWorld';
import type { TelegraphPort } from '../../src/vfx/telegraphPort';

/**
 * The five newer heroes on the real Player / CombatSystem / Effects code and real Rapier physics,
 * stepped at the fixed 60 Hz logic rate: every combo step, skill and ultimate must land, and the
 * kit-specific mechanics (pull, guard stance, life drain, leap, slow) must do what they say.
 */
let rapier: Rapier;
beforeAll(async () => {
  rapier = await loadRapier();
});

const DT = 1 / 60;
const NEW_HEROES: readonly HeroId[] = ['garrick', 'seraphine', 'ryn', 'valka', 'morrow'];
const stepsFor = (ms: number): number => Math.ceil(ms / (DT * 1000));
const totalMs = (a: ActionDef): number => a.startupMs + a.activeMs + a.recoveryMs;

const noTelegraphs: TelegraphPort = {
  show: () => -1,
  update: () => undefined,
  hide: () => undefined,
};

function makeWorld(hero: HeroDef) {
  const physics = new PhysicsWorld(rapier);
  physics.addStaticCuboid(0, -0.5, 0, 60, 0.5, 60);
  const scene = new Scene();
  const bus = new EventBus<GameEvents>();
  const clock = new GameClock();
  const input = new InputState(150, () => clock.nowMs, bus);
  // rng = 0.99: never crits; statuses with chance 1 always apply, lower chances never do.
  const combat = new CombatSystem(physics, bus, () => 0.99);
  const targets: Actor[] = [];
  const playerList: Actor[] = [];
  const visuals: EffectVisuals = {
    showZone: () => -1,
    updateZone: () => undefined,
    hideZone: () => undefined,
    blast: () => undefined,
  };
  const effects = new Effects(
    scene,
    combat,
    physics,
    bus,
    visuals,
    (team) => (team === 'enemy' ? playerList : targets),
    () => 0.5,
  );
  const player = new Player({
    hero,
    effects,
    physics,
    scene,
    combat,
    input,
    bus,
    clock: () => clock.nowMs,
    basis: { forwardXZ: { x: 0, z: -1 }, rightXZ: { x: 1, z: 0 } },
    targets: () => targets,
  });
  combat.register(player);
  playerList.push(player);
  player.resetForRun(0, 0, Math.PI); // facing -Z
  const ctx: BrainContext = {
    player,
    tokens: new AttackTokenManager(2),
    physics,
    combat,
    bus,
    telegraphs: noTelegraphs,
    rng: () => 0.5,
    difficultyMod: 1,
    effects,
    summon: () => undefined,
  };
  const actors: Actor[] = [player];
  const step = (n = 1, each?: () => void): void => {
    for (let i = 0; i < n; i++) {
      clock.tick(DT);
      player.think(DT);
      for (const a of actors) {
        if (a instanceof TrainingDummy) a.think(DT);
        else if (a instanceof Enemy) a.think(DT);
      }
      effects.update(DT);
      separateCrowd(actors, actors.length);
      for (const a of actors) a.integrate(DT);
      physics.step(DT);
      each?.();
    }
  };
  const press = (a: Parameters<InputState['press']>[0]): void => {
    input.press(a, INPUT_SOURCE.keyboard);
    input.release(a, INPUT_SOURCE.keyboard);
  };
  const addDummy = (x: number, z: number): TrainingDummy => {
    const d = new TrainingDummy(physics, scene);
    combat.register(d);
    d.spawnAt(x, z, 0);
    actors.push(d);
    targets.push(d);
    return d;
  };
  const addEnemy = (x: number, z: number): Enemy => {
    const e = new Enemy(ENEMIES.thrall, { physics, scene, ctx });
    combat.register(e);
    e.activate(x, z, 0, UNIT_SCALE);
    actors.push(e);
    targets.push(e);
    return e;
  };
  /** Total damage dealt to `target` from now on (the dummy refills, so count hit events). */
  const damageTo = (target: Actor): (() => number) => {
    let sum = 0;
    bus.on('combat:hit', (e) => {
      if (e.targetId === target.id) sum += e.amount;
    });
    return () => sum;
  };
  return {
    scene,
    clock,
    physics,
    effects,
    bus,
    combat,
    player,
    step,
    press,
    addDummy,
    addEnemy,
    damageTo,
  };
}

describe('new heroes: every move lands (integration)', () => {
  it.each(NEW_HEROES)('%s: each combo step damages a dummy in front', (id) => {
    const hero = HEROES[id];
    for (let i = 0; i < hero.combo.length; i++) {
      const w = makeWorld(hero);
      const dummy = w.addDummy(0, -2.4);
      const dealt = w.damageTo(dummy);
      w.player.startAttack(i);
      expect(w.player.actionId).toBe(hero.combo[i]?.id);
      w.step(stepsFor(totalMs(hero.combo[i] as ActionDef) + 700));
      expect(dealt(), `${hero.combo[i]?.id}`).toBeGreaterThan(0);
    }
  });

  it.each(NEW_HEROES)('%s: the attack button chains the whole combo', (id) => {
    const hero = HEROES[id];
    const w = makeWorld(hero);
    w.addDummy(0, -2.4);
    const seen = new Set<string>();
    for (let i = 0; i < stepsFor(6000) && seen.size < hero.combo.length; i++) {
      if (i % 6 === 0) w.press('attack');
      w.step(1);
      if (w.player.actionId !== null) seen.add(w.player.actionId);
    }
    expect([...seen]).toEqual(hero.combo.map((a) => a.id));
  });

  it.each(NEW_HEROES)('%s: each skill and the ultimate damage a dummy', (id) => {
    const hero = HEROES[id];
    const keys = ['skill1', 'skill2', 'skill3'] as const;
    const moves = hero.skills.map((def, i) => ({ def, key: keys[i] ?? 'skill1' }));
    for (const { def, key } of moves) {
      const w = makeWorld(hero);
      const dummy = w.addDummy(0, -2.6);
      const dealt = w.damageTo(dummy);
      w.press(key);
      w.step(1);
      expect(w.player.actionId).toBe(def.id);
      w.step(stepsFor(totalMs(def) + 3200));
      expect(dealt(), def.id).toBeGreaterThan(0);
      expect(w.player.cooldowns.isReady(hero.skills.indexOf(def))).toBe(false);
    }
    const w = makeWorld(hero);
    const dummy = w.addDummy(0, -2.6);
    const dealt = w.damageTo(dummy);
    w.player.ultimate.add(1);
    w.press('ultimate');
    w.step(1);
    expect(w.player.actionId).toBe(hero.ultimate.id);
    expect(w.player.isInvulnerable()).toBe(true);
    w.step(stepsFor(totalMs(hero.ultimate) + 1500));
    expect(dealt(), hero.ultimate.id).toBeGreaterThan(0);
    expect(w.player.state).toBe('locomotion');
  });
});

describe('new heroes: kit mechanics (integration)', () => {
  it('Garrick: Challenge Roar drags enemies in and slows them', () => {
    const w = makeWorld(HEROES.garrick);
    const e = w.addEnemy(0, -5);
    w.step(stepsFor(1000)); // finish spawning
    const pullSpec = HEROES.garrick.skills[1].hits[0]?.spec as HitSpec;
    expect(pullSpec.pull).toBe(true);
    const before = e.distanceTo(w.player);
    w.combat.applyHit(w.player, e, pullSpec, 0, -1, { difficultyMod: 1 });
    expect(e.status.speedMult()).toBeLessThan(1);
    w.step(stepsFor(250));
    const pulled = e.distanceTo(w.player);

    // The same hit without `pull` pushes the enemy away instead.
    const w2 = makeWorld(HEROES.garrick);
    const e2 = w2.addEnemy(0, -5);
    w2.step(stepsFor(1000));
    w2.combat.applyHit(w2.player, e2, { ...pullSpec, pull: false }, 0, -1, { difficultyMod: 1 });
    w2.step(stepsFor(250));
    const pushed = e2.distanceTo(w2.player);
    expect(pulled).toBeLessThan(before - 0.8);
    expect(pushed - pulled).toBeGreaterThan(2);
  });

  it('Garrick: Iron Vigil takes far less damage while it lasts', () => {
    const hit: HitSpec = {
      damage: 1,
      poise: 0,
      reaction: 'flinch',
      knockback: 0,
      hitStopMs: 0,
      shake: 0,
      shape: { kind: 'circle', radius: 1, forward: 0 },
    };
    const run = (guard: boolean): number => {
      const w = makeWorld(HEROES.garrick);
      const attacker = w.addEnemy(0, 8);
      w.step(stepsFor(1000));
      if (guard) {
        w.press('skill3');
        w.step(stepsFor(300));
        expect(w.player.actionId).toBe('garrick_vigil');
      }
      const hp = w.player.health.current;
      w.combat.applyHit(attacker, w.player, hit, 0, 1, { difficultyMod: 1 });
      return hp - w.player.health.current;
    };
    const open = run(false);
    const guarded = run(true);
    expect(open).toBeGreaterThan(0);
    expect(guarded / open).toBeLessThan(0.4);
  });

  it('Valka: Thunderdive lands on a distant target; with none it leaps its data distance', () => {
    const w = makeWorld(HEROES.valka);
    const dummy = w.addDummy(0, -7.5);
    const dealt = w.damageTo(dummy);
    w.press('skill1');
    w.step(stepsFor(900));
    expect(dummy.distanceTo(w.player)).toBeLessThan(dummy.radius + w.player.radius + 1.2);
    expect(dealt()).toBeGreaterThan(0);

    const empty = makeWorld(HEROES.valka);
    empty.press('skill1');
    empty.step(stepsFor(900));
    expect(empty.player.currFeet.z).toBeCloseTo(-(HEROES.valka.skills[0].move?.distance ?? 0), 0);
  });

  it('Morrow: Grave Tithe drains life from what stands in it', () => {
    const w = makeWorld(HEROES.morrow);
    w.addDummy(0, -3.4);
    w.player.health.damage(600);
    const hp = w.player.health.current;
    w.press('skill1');
    w.step(stepsFor(3500));
    expect(w.player.health.current).toBeGreaterThan(hp + 20);
  });

  it('Seraphine: bolts fly at range; Frost Nova slows everything around her', () => {
    const w = makeWorld(HEROES.seraphine);
    const far = w.addDummy(0, -10);
    const dealt = w.damageTo(far);
    w.press('attack');
    w.step(stepsFor(260));
    expect(w.effects.activeProjectiles).toBeGreaterThan(0);
    w.step(stepsFor(900));
    expect(dealt()).toBeGreaterThan(0);

    const w2 = makeWorld(HEROES.seraphine);
    const a = w2.addEnemy(3, 0);
    const b = w2.addEnemy(-3, -1);
    w2.step(stepsFor(1000));
    w2.press('skill2');
    w2.step(stepsFor(500));
    expect(a.status.speedMult()).toBeLessThan(1);
    expect(b.status.speedMult()).toBeLessThan(1);
  });

  it('Ryn: Comet Kick crosses the arena with i-frames', () => {
    const w = makeWorld(HEROES.ryn);
    w.press('skill1');
    w.step(stepsFor(120));
    expect(w.player.isInvulnerable()).toBe(true);
    w.step(stepsFor(600));
    expect(w.player.currFeet.z).toBeLessThan(-6);
  });
});

describe('new heroes in the arena (integration)', () => {
  it.each(NEW_HEROES)('an AI-controlled %s closes in, lands hits and uses several moves', (id) => {
    const w = makeWorld(HEROES.kael);
    let brain: DuelistBrain | null = null;
    const idle = new InputState(150, () => w.clock.nowMs, new EventBus<GameEvents>());
    const opp = new Player({
      hero: HEROES[id],
      physics: w.physics,
      scene: w.scene,
      combat: w.combat,
      input: idle,
      bus: w.bus,
      clock: () => w.clock.nowMs,
      basis: { forwardXZ: { x: 0, z: 1 }, rightXZ: { x: 1, z: 0 } },
      targets: () => [w.player],
      effects: w.effects,
      team: 'enemy',
      human: false,
      inputSource: () => brain?.input ?? idle,
    });
    w.combat.register(opp);
    opp.resetForRun(0, -8, 0);
    brain = new DuelistBrain(opp, w.player, () => 0.3, 0.8);
    const used = new Set<string>();
    const hp = w.player.health.current;
    for (let i = 0; i < stepsFor(20_000); i++) {
      brain.think(DT);
      opp.think(DT);
      opp.integrate(DT);
      w.step(1);
      if (opp.actionId !== null) used.add(opp.actionId);
      if (w.player.health.dead) break;
    }
    expect(w.player.health.current).toBeLessThan(hp);
    expect(used.size).toBeGreaterThanOrEqual(2);
  });
});
