import { Scene } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../../src/actors/Actor';
import { Boss } from '../../src/actors/Boss';
import { Enemy, UNIT_SCALE } from '../../src/actors/Enemy';
import { Player } from '../../src/actors/Player';
import { TrainingDummy } from '../../src/actors/TrainingDummy';
import { AttackTokenManager } from '../../src/ai/AttackTokens';
import type { BrainContext } from '../../src/ai/EnemyBrain';
import { CombatSystem } from '../../src/combat/CombatSystem';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { GameClock } from '../../src/core/GameClock';
import { BOSSES, type BossId } from '../../src/data/bosses';
import { ENEMIES, type EnemyId } from '../../src/data/enemies';
import { HEROES, type HeroDef } from '../../src/data/heroes';
import { Effects, type EffectVisuals } from '../../src/combat/Effects';
import { DuelistBrain } from '../../src/ai/DuelistBrain';
import { INPUT_SOURCE } from '../../src/input/actions';
import { InputState } from '../../src/input/InputState';
import { separateCrowd } from '../../src/modes/crowd';
import { loadRapier, PhysicsWorld, type Rapier } from '../../src/physics/PhysicsWorld';
import type { TelegraphPort } from '../../src/vfx/telegraphPort';

/**
 * Integration tests: the real Player / Enemy / Boss / CombatSystem on real Rapier physics,
 * stepped at the fixed 60 Hz logic rate exactly like the game loop does.
 */
let rapier: Rapier;
beforeAll(async () => {
  rapier = await loadRapier();
});

const DT = 1 / 60;
const kael = HEROES.kael;

const noTelegraphs: TelegraphPort = {
  show: () => -1,
  update: () => undefined,
  hide: () => undefined,
};

function makeWorld(hero: HeroDef = kael) {
  const physics = new PhysicsWorld(rapier);
  physics.addStaticCuboid(0, -0.5, 0, 60, 0.5, 60);
  const scene = new Scene();
  const bus = new EventBus<GameEvents>();
  const clock = new GameClock();
  const input = new InputState(150, () => clock.nowMs, bus);
  // rng = 0.99: never crits, status chances < 0.99 never apply (deterministic damage).
  const combat = new CombatSystem(physics, bus, () => 0.99);
  const targets: Actor[] = [];
  const zonesShown: number[] = [];
  const visuals: EffectVisuals = {
    showZone: () => {
      zonesShown.push(1);
      return -1;
    },
    updateZone: () => undefined,
    hideZone: () => undefined,
    blast: () => undefined,
  };
  const playerList: Actor[] = [];
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
  const tokens = new AttackTokenManager(2);
  const ctx: BrainContext = {
    player,
    tokens,
    physics,
    combat,
    bus,
    telegraphs: noTelegraphs,
    rng: (() => {
      let s = 9;
      return () => {
        s = (s * 48271) % 2147483647;
        return s / 2147483647;
      };
    })(),
    difficultyMod: 1,
    effects,
    summon: (id, count) => {
      for (let i = 0; i < count; i++) summoned.push(addEnemy(6 + i, 6, id));
    },
  };
  const summoned: Enemy[] = [];
  const actors: Actor[] = [player];
  const enemies: Enemy[] = [];
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
  const addEnemy = (x: number, z: number, id: EnemyId = 'thrall'): Enemy => {
    const e = new Enemy(ENEMIES[id], { physics, scene, ctx });
    combat.register(e);
    e.activate(x, z, 0, UNIT_SCALE);
    actors.push(e);
    targets.push(e);
    enemies.push(e);
    return e;
  };
  const addBoss = (x: number, z: number, id: BossId = 'hollow_warden'): Boss => {
    const b = new Boss(BOSSES[id], { physics, scene, ctx });
    combat.register(b);
    b.activate(x, z, 0, UNIT_SCALE);
    actors.push(b);
    targets.push(b);
    return b;
  };
  return {
    scene,
    targets,
    summoned,
    physics,
    effects,
    zonesShown,
    bus,
    clock,
    input,
    combat,
    player,
    tokens,
    step,
    press,
    addDummy,
    addEnemy,
    addBoss,
    enemies,
  };
}

const stepsFor = (ms: number): number => Math.ceil(ms / (DT * 1000));

describe('player combat (integration)', () => {
  it('ATTACK starts the combo and the hit lands on a target in front', () => {
    const w = makeWorld();
    const dummy = w.addDummy(0, -1.4);
    w.press('attack');
    w.step(1);
    expect(w.player.state).toBe('attack');
    expect(w.player.actionId).toBe('kael_atk1');
    w.step(stepsFor(kael.combo[0]?.startupMs ?? 0) + 2);
    // 100 ATK × 0.9 × 100/(100+30) = 69
    expect(dummy.health.max - dummy.health.current).toBe(69);
  });

  it('attack magnetism: a hit lunges to connect with an enemy out of reach', () => {
    const w = makeWorld();
    // Gap ≈ 3.6 m: the arc reaches 2.4 m and the plain lunge is 0.6 m, so without
    // magnetism this swing would hit air.
    const dummy = w.addDummy(0, -4.0);
    const z0 = w.player.currFeet.z;
    w.press('attack');
    w.step(stepsFor(400));
    expect(dummy.health.current).toBeLessThan(dummy.health.max);
    expect(z0 - w.player.currFeet.z).toBeGreaterThan(1.2);
  });

  it('attack magnetism: no lunge into an enemy that is already close', () => {
    const w = makeWorld();
    w.addDummy(0, -1.1);
    const z0 = w.player.currFeet.z;
    w.press('attack');
    w.step(stepsFor(400));
    expect(Math.abs(z0 - w.player.currFeet.z)).toBeLessThan(0.15);
  });

  it('presses inside the cancel window chain all 5 combo steps', () => {
    const w = makeWorld();
    w.addDummy(0, -1.4);
    const seen: string[] = [];
    w.press('attack');
    for (let i = 0; i < 400; i++) {
      w.step(1);
      const id = w.player.actionId;
      if (id !== null && seen[seen.length - 1] !== id) seen.push(id);
      if (w.player.runner.canCancel()) w.press('attack');
      if (seen.length === 5) break;
    }
    expect(seen).toEqual(['kael_atk1', 'kael_atk2', 'kael_atk3', 'kael_atk4', 'kael_atk5']);
  });

  it('input buffer: a press 100 ms before the cancel window is executed when it opens', () => {
    const w = makeWorld();
    w.press('attack');
    w.step(1);
    const step = kael.combo[0];
    if (step === undefined) throw new Error('combo missing');
    // Advance to 100 ms before cancelAt, press, then let the window open.
    w.step(stepsFor(step.cancelAtMs - 100) - 1);
    expect(w.player.runner.canCancel()).toBe(false);
    w.press('attack');
    w.step(stepsFor(120));
    expect(w.player.actionId).toBe('kael_atk2');
  });

  it('input buffer: a press 300 ms too early is dropped (no chain)', () => {
    const w = makeWorld();
    w.press('attack');
    w.step(1);
    w.press('attack'); // ~17 ms into atk1; cancel window opens at 250 ms → outside 150 ms buffer
    w.step(stepsFor(600));
    expect(w.player.state).toBe('locomotion');
    expect(w.player.actionId).toBeNull();
  });

  it('dodge cancels attack recovery once the cancel window is open', () => {
    const w = makeWorld();
    w.press('attack');
    w.step(stepsFor((kael.combo[0]?.cancelAtMs ?? 0) + 20));
    w.press('dodge');
    w.step(1);
    expect(w.player.state).toBe('dodge');
  });

  it('dodge i-frames: hits early in the dodge are evaded (perfect dodge), late hits land', () => {
    const w = makeWorld();
    const attacker = w.addDummy(0, -1.4);
    let perfect = 0;
    w.bus.on('player:perfectDodge', () => perfect++);
    const spec = {
      damage: 1,
      poise: 0,
      reaction: 'flinch' as const,
      knockback: 0,
      hitStopMs: 0,
      shake: 0,
      shape: { kind: 'circle' as const, radius: 9, forward: 0 },
    };
    w.press('dodge');
    w.step(stepsFor(60));
    expect(w.combat.applyHit(attacker, w.player, spec, 0, 1, { difficultyMod: 1 })).toBe(false);
    expect(perfect).toBe(1);
    expect(w.player.counterReady).toBe(true);
    // Second evade in the same dodge doesn't re-trigger the perfect dodge.
    w.step(stepsFor(100));
    w.combat.applyHit(attacker, w.player, spec, 0, 1, { difficultyMod: 1 });
    expect(perfect).toBe(1);
    w.step(stepsFor(kael.dodge.durationMs));
    expect(w.combat.applyHit(attacker, w.player, spec, 0, 1, { difficultyMod: 1 })).toBe(true);
  });

  it('after a perfect dodge the next attack is a counter (bonus damage, forced crit)', () => {
    const w = makeWorld();
    const dummy = w.addDummy(0, -1.4);
    const spec = {
      damage: 1,
      poise: 0,
      reaction: 'flinch' as const,
      knockback: 0,
      hitStopMs: 0,
      shake: 0,
      shape: { kind: 'circle' as const, radius: 9, forward: 0 },
    };
    let counterHit = false;
    let amount = 0;
    w.bus.on('combat:hit', (e) => {
      if (e.targetId === dummy.id) {
        counterHit = e.counter;
        amount = e.amount;
      }
    });
    // Perfect dodge: a hit lands 40 ms into the dodge.
    w.press('dodge');
    w.step(stepsFor(40));
    w.combat.applyHit(dummy, w.player, spec, 0, 1, { difficultyMod: 1 });
    w.step(stepsFor(kael.dodge.durationMs + 20));
    expect(w.player.counterReady).toBe(true);
    // The backstep moved the player away; put them back in reach (keeps the counter armed).
    w.player.spawnAt(0, 0, Math.PI);
    w.press('attack');
    w.step(stepsFor(200));
    expect(counterHit).toBe(true);
    // 100 × 0.9 × 1.5 (counter) × 1.6 (forced crit) × 100/130 = 166
    expect(amount).toBe(166);
    expect(w.player.counterReady).toBe(false);
  });

  it('skills respect cooldowns; the ultimate needs a full meter and grants invulnerability', () => {
    const w = makeWorld();
    w.press('skill2');
    w.step(1);
    expect(w.player.state).toBe('skill');
    expect(w.player.cooldowns.isReady(1)).toBe(false);
    w.step(stepsFor(1400));
    w.press('skill2');
    w.step(2);
    expect(w.player.state).toBe('locomotion');
    w.press('ultimate');
    w.step(2);
    expect(w.player.state).toBe('locomotion');
    w.player.ultimate.add(1);
    w.press('ultimate');
    w.step(2);
    expect(w.player.state).toBe('ultimate');
    expect(w.player.isInvulnerable()).toBe(true);
    expect(w.player.ultimate.value).toBe(0);
  });
});

describe('enemy AI (integration)', () => {
  it('never more than 2 enemies attack at once; the rest circle; they do attack', () => {
    const w = makeWorld();
    w.player.god = true;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      w.addEnemy(Math.cos(a) * 7, Math.sin(a) * 7);
    }
    let maxTokens = 0;
    let evaded = 0;
    let positioned = 0;
    w.bus.on('combat:evaded', () => evaded++);
    w.step(stepsFor(12000), () => {
      maxTokens = Math.max(maxTokens, w.tokens.count);
      const attacking = w.enemies.filter((e) => e.brain.busyAttacking).length;
      expect(attacking).toBeLessThanOrEqual(2);
      positioned += w.enemies.filter((e) => e.brain.state === 'position').length;
    });
    expect(maxTokens).toBe(2);
    expect(evaded).toBeGreaterThan(2);
    expect(positioned).toBeGreaterThan(0);
  });

  it('poise break staggers an enemy and releases its token', () => {
    const w = makeWorld();
    const e = w.addEnemy(0, -1.6);
    w.step(stepsFor(1000));
    const spec = {
      damage: 0.01,
      poise: 999,
      reaction: 'flinch' as const,
      knockback: 0,
      hitStopMs: 0,
      shake: 0,
      shape: { kind: 'circle' as const, radius: 9, forward: 0 },
    };
    w.combat.applyHit(w.player, e, spec, 0, -1, { difficultyMod: 1 });
    expect(e.brain.state).toBe('stagger');
    expect(w.tokens.holds(e.id)).toBe(false);
  });

  it('killed enemies play their death and become poolable', () => {
    const w = makeWorld();
    const e = w.addEnemy(0, -1.6);
    w.step(stepsFor(1000));
    const spec = {
      damage: 100,
      poise: 0,
      reaction: 'flinch' as const,
      knockback: 0,
      hitStopMs: 0,
      shake: 0,
      shape: { kind: 'circle' as const, radius: 9, forward: 0 },
    };
    w.combat.applyHit(w.player, e, spec, 0, -1, { difficultyMod: 1 });
    expect(e.health.dead).toBe(true);
    expect(e.readyForRelease).toBe(false);
    w.step(stepsFor(ENEMIES.thrall.deathMs + 50));
    expect(e.readyForRelease).toBe(true);
  });
});

describe('boss (integration)', () => {
  it('intro → fight; HP thresholds trigger invulnerable phase transitions with a shockwave', () => {
    const w = makeWorld();
    w.player.god = true;
    const boss = w.addBoss(0, -8);
    expect(boss.brain.state).toBe('intro');
    expect(boss.isInvulnerable()).toBe(true);
    boss.bossBrain.beginFight();
    let shock = 0;
    boss.bossBrain.onShockwave = () => shock++;
    let phaseEvents = 0;
    w.bus.on('boss:phase', () => phaseEvents++);
    boss.health.damage(boss.health.max * 0.45);
    boss.bossBrain.checkPhase();
    expect(boss.brain.state).toBe('transition');
    expect(boss.isInvulnerable()).toBe(true);
    w.step(stepsFor(BOSSES.hollow_warden.transitionMs + 50));
    expect(boss.bossBrain.phase).toBe(1);
    expect(shock).toBe(1);
    expect(phaseEvents).toBe(1);
    expect(boss.isInvulnerable()).toBe(false);
    // Skipping straight past phase 2's threshold goes to phase 3.
    boss.health.damage(boss.health.max * 0.35);
    boss.bossBrain.checkPhase();
    w.step(stepsFor(BOSSES.hollow_warden.transitionMs + 50));
    expect(boss.bossBrain.phase).toBe(2);
  });

  it('break bar: enough poise damage stuns the boss with a damage bonus, then it recovers', () => {
    const w = makeWorld();
    w.player.god = true;
    const boss = w.addBoss(0, -6);
    boss.bossBrain.beginFight();
    const spec = {
      damage: 0.01,
      poise: 700,
      reaction: 'flinch' as const,
      knockback: 0,
      hitStopMs: 0,
      shake: 0,
      shape: { kind: 'circle' as const, radius: 20, forward: 0 },
    };
    w.combat.applyHit(w.player, boss, spec, 0, -1, { difficultyMod: 1 });
    expect(boss.isBroken).toBe(true);
    expect(boss.damageTakenMult()).toBe(1 + BOSSES.hollow_warden.breakDamageBonus);
    w.step(stepsFor(BOSSES.hollow_warden.breakStunMs + 50));
    expect(boss.isBroken).toBe(false);
    expect(boss.poise.frac).toBe(1);
  });

  it('enrages after the enrage timer (damage and speed up)', () => {
    const w = makeWorld();
    w.player.god = true;
    const boss = w.addBoss(0, -8);
    boss.bossBrain.beginFight();
    const dmgBefore = boss.damageMult;
    let enraged = 0;
    w.bus.on('boss:enrage', () => enraged++);
    boss.bossBrain.fightMs = BOSSES.hollow_warden.enrageAfterMs - 20;
    w.step(3);
    expect(enraged).toBe(1);
    expect(boss.damageMult).toBeCloseTo(dmgBefore * BOSSES.hollow_warden.enrageDamageMult);
  });

  it('attacks the player in a real fight', () => {
    const w = makeWorld();
    w.player.god = true;
    const boss = w.addBoss(0, -6);
    boss.bossBrain.beginFight();
    let evaded = 0;
    w.bus.on('combat:evaded', () => evaded++);
    w.step(stepsFor(8000));
    expect(evaded).toBeGreaterThan(0);
  });
});

describe('creature bosses (integration)', () => {
  it.each(['ash_behemoth', 'brood_weaver', 'cinder_wyrm'] as const)(
    '%s fights the player through all of its phases',
    (id) => {
      const w = makeWorld();
      w.player.god = true;
      const boss = w.addBoss(0, -7, id);
      boss.bossBrain.beginFight();
      const used = new Set<string>();
      w.bus.on('enemy:telegraph', (e) => {
        if (e.actorId === boss.id) used.add(e.attackId);
      });
      let evaded = 0;
      w.bus.on('combat:evaded', () => evaded++);
      for (const frac of [0.55, 0.25]) {
        w.step(stepsFor(9000));
        boss.health.damage(boss.health.current - boss.health.max * frac);
        boss.bossBrain.checkPhase();
      }
      w.step(stepsFor(12000));
      expect(boss.bossBrain.phase).toBe(2);
      expect(evaded).toBeGreaterThan(0);
      expect(used.size).toBeGreaterThanOrEqual(4);
      for (const b of [boss.rig.bone('Head'), boss.rig.bone('Chest')])
        expect(Number.isFinite(b.quaternion.w)).toBe(true);
    },
  );

  it('burrow: the wyrm sinks out of reach, tunnels to the player and erupts there', () => {
    const w = makeWorld();
    w.player.god = true;
    const boss = w.addBoss(0, -12, 'cinder_wyrm');
    boss.bossBrain.beginFight();
    const atk = boss.attackById('wyrm_burrow');
    if (atk === undefined) throw new Error('no burrow');
    (boss.bossBrain as unknown as { startTelegraph(a: typeof atk): void }).startTelegraph(atk);
    w.step(stepsFor(atk.startupMs * 0.5));
    expect(boss.visualLift).toBeLessThan(-0.8);
    expect(boss.isInvulnerable()).toBe(true);
    let launched = 0;
    w.bus.on('combat:evaded', () => launched++);
    w.step(stepsFor(atk.startupMs * 0.5 + atk.activeMs + 100));
    const d = Math.hypot(
      boss.currFeet.x - w.player.currFeet.x,
      boss.currFeet.z - w.player.currFeet.z,
    );
    expect(d).toBeLessThan(boss.radius + w.player.radius + 1);
    expect(boss.visualLift).toBeGreaterThan(-0.8);
    expect(boss.isInvulnerable()).toBe(false);
    expect(launched).toBeGreaterThan(0);
  });

  it('a Swift hunt omen speeds the boss up through its phases and enrage', () => {
    const w = makeWorld();
    const boss = w.addBoss(0, -8, 'ash_behemoth');
    boss.activate(0, -8, 0, { ...UNIT_SCALE, speed: 1.15 });
    boss.bossBrain.beginFight();
    expect(boss.speedMult).toBeCloseTo(1.15);
    boss.applyPhaseMultipliers(1.1, 1, true);
    expect(boss.speedMult).toBeCloseTo(1.15 * 1.1 * BOSSES.ash_behemoth.enrageSpeedMult);
  });

  it('the Brood Weaver calls broodlings; creature minions attack the player', () => {
    const w = makeWorld();
    w.player.god = true;
    const boss = w.addBoss(0, -8, 'brood_weaver');
    boss.bossBrain.beginFight();
    const atk = boss.attackById('weaver_brood');
    if (atk === undefined) throw new Error('no brood');
    (boss.bossBrain as unknown as { startTelegraph(a: typeof atk): void }).startTelegraph(atk);
    w.step(stepsFor(atk.startupMs + 100));
    expect(w.summoned.map((e) => e.def.id)).toEqual(['broodling', 'broodling', 'broodling']);
    const w2 = makeWorld();
    w2.player.god = true;
    w2.addEnemy(0, -5, 'ash_hound');
    w2.addEnemy(2, -5, 'broodling');
    let evaded = 0;
    w2.bus.on('combat:evaded', () => evaded++);
    w2.step(stepsFor(6000));
    expect(evaded).toBeGreaterThan(1);
  });
});

describe('Brann and Lyra (integration)', () => {
  const brann = HEROES.brann;
  const lyra = HEROES.lyra;

  it('Brann: holding Oathbreaker charges it; a full charge hits much harder than a tap', () => {
    const run = (holdMs: number): number => {
      const w = makeWorld(brann);
      const dummy = w.addDummy(0, -2.2);
      w.input.press('skill2', INPUT_SOURCE.keyboard);
      w.step(stepsFor(holdMs));
      w.input.release('skill2', INPUT_SOURCE.keyboard);
      w.step(stepsFor(900));
      return dummy.health.max - dummy.health.current;
    };
    const tap = run(30);
    const full = run(2000);
    expect(tap).toBeGreaterThan(0);
    expect(full / tap).toBeGreaterThan(2.2);
  });

  it('Brann: Earthsplitter shockwave reaches enemies well beyond the slam itself', () => {
    const w = makeWorld(brann);
    const near = w.addDummy(0, -2.5);
    const far = w.addDummy(4.5, -2.5);
    w.press('skill1');
    w.step(stepsFor(900));
    expect(near.health.current).toBeLessThan(near.health.max);
    expect(far.health.current).toBeLessThan(far.health.max);
  });

  it('Lyra: shoots arrows at distant enemies and stabs with the dagger up close', () => {
    const w = makeWorld(lyra);
    const far = w.addDummy(0, -9);
    w.press('attack');
    w.step(1);
    expect(w.player.actionId).toBe('lyra_shot1');
    w.step(stepsFor(200));
    expect(w.effects.activeProjectiles).toBe(1);
    w.step(stepsFor(600));
    expect(far.health.current).toBeLessThan(far.health.max);
    expect(w.effects.activeProjectiles).toBe(0);
    const w2 = makeWorld(lyra);
    w2.addDummy(0, -1.4);
    w2.press('attack');
    w2.step(1);
    expect(w2.player.actionId).toBe('lyra_stab1');
  });

  it('Lyra: Snare Leap backflips away and leaves a trap that springs on an enemy', () => {
    const w = makeWorld(lyra);
    w.press('skill3');
    w.step(stepsFor(500));
    expect(w.player.currFeet.z).toBeGreaterThan(3);
    expect(w.effects.activeZones).toBe(1);
    // The trap waits while the enemy is still spawning (invulnerable), then springs.
    const e = w.addEnemy(0, 0.3);
    w.step(stepsFor(400));
    expect(w.effects.activeZones).toBe(1);
    w.step(stepsFor(900));
    expect(e.health.current).toBeLessThan(e.health.max);
    expect(w.effects.activeZones).toBe(0);
  });

  it('Lyra: Gloamstorm fires homing arrows that find targets around her', () => {
    const w = makeWorld(lyra);
    const a = w.addDummy(5, 0);
    const b = w.addDummy(-5, 0);
    w.player.ultimate.add(1);
    w.press('ultimate');
    w.step(stepsFor(2600));
    expect(a.health.current).toBeLessThan(a.health.max);
    expect(b.health.current).toBeLessThan(b.health.max);
  });
});

describe('new enemies and boss mechanics (integration)', () => {
  it('Bulwark Sentinel blocks frontal hits but not hits from behind', () => {
    const front = makeWorld();
    const a = front.addEnemy(0, -1.6, 'bulwark');
    a.yaw = 0; // facing +Z, toward the player at the origin
    front.step(stepsFor(950)); // finish spawning
    a.yaw = 0;
    a.brain.enter('idle');
    const hpA = a.health.current;
    front.combat.applyHit(front.player, a, kael.combo[0]!.hits[0]!.spec, 0, -1, {
      difficultyMod: 1,
    });
    const blocked = hpA - a.health.current;
    const back = makeWorld();
    const b = back.addEnemy(0, -1.6, 'bulwark');
    back.step(stepsFor(950));
    b.yaw = Math.PI; // facing away
    b.brain.enter('idle');
    const hpB = b.health.current;
    back.combat.applyHit(back.player, b, kael.combo[0]!.hits[0]!.spec, 0, -1, { difficultyMod: 1 });
    const open = hpB - b.health.current;
    expect(blocked).toBeGreaterThan(0);
    expect(open / blocked).toBeGreaterThan(5);
  });

  it('Ember Seer keeps its distance and shoots bolts that hurt the player', () => {
    const w = makeWorld();
    const s = w.addEnemy(0, -3, 'seer');
    const hp = w.player.health.current;
    w.step(stepsFor(3000));
    expect(s.distanceTo(w.player)).toBeGreaterThan(4);
    w.step(stepsFor(5000));
    expect(w.player.health.current).toBeLessThan(hp);
  });

  it('Cinder Wretch rushes in, explodes and is destroyed', () => {
    const w = makeWorld();
    const e = w.addEnemy(0, -8, 'wretch');
    const hp = w.player.health.current;
    let died = false;
    w.bus.on('combat:death', (d) => {
      if (d.actorId === e.id) died = true;
    });
    w.step(stepsFor(5000));
    expect(died).toBe(true);
    expect(e.health.dead).toBe(true);
    expect(w.player.health.current).toBeLessThan(hp);
  });

  it('Mother of Ash flies out of reach (invulnerable) and summons adds in phase III', () => {
    const w = makeWorld();
    w.player.god = true;
    const m = w.addBoss(0, -6, 'mother_of_ash');
    m.bossBrain.beginFight();
    m.health.damage(m.health.max * 0.75);
    m.bossBrain.checkPhase();
    let flew = false;
    let invulnWhileAirborne = true;
    for (let i = 0; i < stepsFor(40_000); i++) {
      w.step(1);
      if (m.visualLift > 2) {
        flew = true;
        if (!m.isInvulnerable()) invulnWhileAirborne = false;
      }
      if (flew && w.summoned.length > 0) break;
    }
    expect(m.bossBrain.phase).toBe(2);
    expect(flew).toBe(true);
    expect(invulnWhileAirborne).toBe(true);
    expect(w.summoned.length).toBeGreaterThan(0);
  });

  it('The Bound King grabs the player, holds them, then slams for heavy damage', () => {
    const w = makeWorld();
    const k = w.addBoss(0, -3.2, 'bound_king');
    k.bossBrain.beginFight();
    const grabs: boolean[] = [];
    w.bus.on('boss:grab', (e) => grabs.push(e.holding));

    // A real player hugs the boss; keep the scripted one close (knockbacks push it away).
    for (let i = 0; i < stepsFor(40_000) && grabs.length < 2; i++) {
      w.step(1);
      if (w.player.health.dead) w.player.revive();
      if (grabs.length === 0 && w.player.state === 'locomotion' && k.gapTo(w.player) > 2) {
        const a = k.yaw;
        w.player.spawnAt(
          k.currFeet.x + Math.sin(a) * 2.8,
          k.currFeet.z + Math.cos(a) * 2.8,
          a + Math.PI,
        );
      }
    }
    expect(grabs).toEqual([true, false]);
  });
});

describe('arena duelist (integration)', () => {
  it('an AI-controlled Brann closes in, lands hits and uses several moves', () => {
    const w = makeWorld();
    let brain: DuelistBrain | null = null;
    const opp = new Player({
      hero: HEROES.brann,
      physics: w.physics,
      scene: w.scene,
      combat: w.combat,
      input: w.input,
      bus: w.bus,
      clock: () => w.clock.nowMs,
      basis: { forwardXZ: { x: 0, z: 1 }, rightXZ: { x: 1, z: 0 } },
      targets: () => [w.player],
      effects: w.effects,
      team: 'enemy',
      human: false,
      inputSource: () => brain?.input ?? w.input,
    });
    w.combat.register(opp);
    opp.resetForRun(0, -8, 0);
    brain = new DuelistBrain(opp, w.player, () => 0.3, 0.8);
    w.targets.push(opp);
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
