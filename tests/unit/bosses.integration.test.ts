import { Scene } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../../src/actors/Actor';
import { Boss } from '../../src/actors/Boss';
import { Enemy, UNIT_SCALE, type EnemyScale } from '../../src/actors/Enemy';
import { Player } from '../../src/actors/Player';
import { AttackTokenManager } from '../../src/ai/AttackTokens';
import type { BrainContext } from '../../src/ai/EnemyBrain';
import { CombatSystem } from '../../src/combat/CombatSystem';
import { Effects, type EffectVisuals } from '../../src/combat/Effects';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { GameClock } from '../../src/core/GameClock';
import { mulberry32 } from '../../src/core/random';
import type { AffixId } from '../../src/data/affixes';
import { BOSSES, type BossId } from '../../src/data/bosses';
import type { StatBlock } from '../../src/data/combatTypes';
import { ENEMIES, type EnemyId } from '../../src/data/enemies';
import { HEROES } from '../../src/data/heroes';
import { GEAR_SLOTS } from '../../src/data/items';
import { INPUT_SOURCE } from '../../src/input/actions';
import { InputState } from '../../src/input/InputState';
import { separateCrowd } from '../../src/modes/crowd';
import { loadRapier, PhysicsWorld, type Rapier } from '../../src/physics/PhysicsWorld';
import { enemyScaleFor } from '../../src/progression/enemyScale';
import { rollItem } from '../../src/progression/gear';
import { computeHeroStats } from '../../src/progression/heroStats';
import type { TelegraphPort } from '../../src/vfx/telegraphPort';

/**
 * The bosses met past chapter 4 and the elite affixes, on the real Player / Boss / CombatSystem /
 * Effects code and real Rapier physics at the fixed 60 Hz logic rate. A simple pilot plays the
 * hero (closes in, attacks, uses skills, rolls away from wind-ups) so the bosses are fought, not
 * just poked.
 */
let rapier: Rapier;
beforeAll(async () => {
  rapier = await loadRapier();
});

const DT = 1 / 60;
const SRC = INPUT_SOURCE.keyboard;
const stepsFor = (ms: number): number => Math.ceil(ms / (DT * 1000));
const NEW_BOSSES: readonly BossId[] = [
  'headsman',
  'bone_cantor',
  'twin_maw',
  'ossuary_queen',
  'hollow_twin',
];

const noTelegraphs: TelegraphPort = {
  show: () => -1,
  update: () => undefined,
  hide: () => undefined,
};

/** Kael at `level` in epic +3 gear of that level (what a player clearing the stage would wear). */
function heroAt(level: number): StatBlock {
  const rng = mulberry32(level);
  const gear = GEAR_SLOTS.map((slot, i) => {
    const it = rollItem(rng, i + 1, slot, 'epic', level);
    it.plus = 3;
    return it;
  });
  return computeHeroStats(HEROES.kael, Math.min(50, level), gear, null);
}

function makeWorld(stats?: StatBlock) {
  const physics = new PhysicsWorld(rapier);
  physics.addStaticCuboid(0, -0.5, 0, 60, 0.5, 60);
  const scene = new Scene();
  const bus = new EventBus<GameEvents>();
  const clock = new GameClock();
  const input = new InputState(150, () => clock.nowMs, bus);
  const combat = new CombatSystem(physics, bus, mulberry32(11));
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
    mulberry32(5),
  );
  const player = new Player({
    hero: HEROES.kael,
    effects,
    physics,
    scene,
    combat,
    input,
    bus,
    clock: () => clock.nowMs,
    basis: { forwardXZ: { x: 0, z: -1 }, rightXZ: { x: 1, z: 0 } },
    targets: () => targets,
    ...(stats !== undefined ? { stats } : {}),
  });
  combat.register(player);
  playerList.push(player);
  player.resetForRun(0, 0, Math.PI);
  const actors: Actor[] = [player];
  const ctx: BrainContext = {
    player,
    tokens: new AttackTokenManager(2),
    physics,
    combat,
    bus,
    telegraphs: noTelegraphs,
    rng: mulberry32(9),
    difficultyMod: 1,
    effects,
    summon: (id, count) => {
      for (let i = 0; i < count; i++) addEnemy(5 + i * 2, 6, id, UNIT_SCALE);
    },
  };
  const addEnemy = (x: number, z: number, id: EnemyId, scale: EnemyScale): Enemy => {
    const e = new Enemy(ENEMIES[id], { physics, scene, ctx });
    combat.register(e);
    e.activate(x, z, 0, scale);
    actors.push(e);
    targets.push(e);
    return e;
  };
  const addBoss = (id: BossId, scale: EnemyScale): Boss => {
    const b = new Boss(BOSSES[id], { physics, scene, ctx });
    combat.register(b);
    b.activate(0, -8, 0, scale);
    actors.push(b);
    targets.push(b);
    return b;
  };
  const step = (n = 1, each?: () => void): void => {
    for (let i = 0; i < n; i++) {
      clock.tick(DT);
      player.think(DT);
      for (const a of actors) if (a instanceof Enemy) a.think(DT);
      effects.update(DT);
      separateCrowd(actors, actors.length);
      for (const a of actors) a.integrate(DT);
      physics.step(DT);
      each?.();
    }
  };
  return { bus, input, combat, player, effects, step, addEnemy, addBoss };
}

type World = ReturnType<typeof makeWorld>;

/**
 * Plays the hero against `foe`: walk in, attack inside reach, use skills now and then, and roll
 * sideways out of a wind-up. Returns the press count (for sanity).
 */
function pilot(w: World, foe: Enemy, rng: () => number): () => void {
  let attackMs = 0;
  let lastTele: string | null = null;
  let skill = 0;
  const tap = (a: Parameters<InputState['press']>[0]): void => {
    w.input.press(a, SRC);
    w.input.release(a, SRC);
  };
  return () => {
    attackMs -= DT * 1000;
    const p = w.player;
    const dx = foe.currFeet.x - p.currFeet.x;
    const dz = foe.currFeet.z - p.currFeet.z;
    const d = Math.hypot(dx, dz) || 1;
    const nx = dx / d;
    const nz = dz / d;
    const gap = p.gapTo(foe);
    // Stick: x = world +X, y = world −Z (the test camera basis).
    const tele = foe.brain.state === 'telegraph' ? (foe.brain.attack?.id ?? null) : null;
    if (tele !== null && tele !== lastTele && gap < 6 && rng() < 0.6) {
      const side = rng() < 0.5 ? 1 : -1;
      w.input.setMove(SRC, -nz * side - nx * 0.5, -(nx * side - nz * 0.5));
      tap('dodge');
      lastTele = tele;
      return;
    }
    lastTele = tele;
    if (gap > 1.6) w.input.setMove(SRC, nx, -nz);
    else w.input.setMove(SRC, nx * 0.3, -nz * 0.3);
    if (gap < 3.2 && attackMs <= 0) {
      if (rng() < 0.08) {
        skill = (skill + 1) % 3;
        tap((['skill1', 'skill2', 'skill3'] as const)[skill] ?? 'skill1');
      } else if (p.ultimate.isReady) tap('ultimate');
      else tap('attack');
      attackMs = 160;
    }
  };
}

describe('new bosses (integration)', () => {
  it.each(NEW_BOSSES)('%s lands hits on a hero who stands and takes it', (id) => {
    const w = makeWorld();
    const boss = w.addBoss(id, UNIT_SCALE);
    boss.bossBrain.beginFight();
    const hp = w.player.health.current;
    let hits = 0;
    w.bus.on('combat:hit', (e) => {
      if (e.targetId === w.player.id && !e.dot) hits++;
    });
    for (let i = 0; i < stepsFor(25_000) && hits === 0; i++) w.step(1);
    expect(hits).toBeGreaterThan(0);
    expect(w.player.health.current).toBeLessThan(hp);
  });

  it.each(NEW_BOSSES)(
    '%s is defeated in a piloted fight at level 40, through every phase, before it enrages',
    (id) => {
      const level = 40;
      const w = makeWorld(heroAt(level));
      // The fight itself is real; the hero cannot die so the run always reaches the end.
      w.player.god = true;
      const boss = w.addBoss(id, enemyScaleFor(level, 'normal'));
      boss.bossBrain.beginFight();
      const used = new Set<string>();
      w.bus.on('enemy:telegraph', (e) => {
        if (e.actorId === boss.id) used.add(e.attackId);
      });
      let phases = 0;
      w.bus.on('boss:phase', () => phases++);
      const drive = pilot(w, boss, mulberry32(77));
      let ms = 0;
      const limit = BOSSES[id].enrageAfterMs;
      while (!boss.health.dead && ms < limit) {
        drive();
        w.step(1);
        ms += DT * 1000;
      }
      expect(boss.health.dead, `${id} still at ${boss.health.frac.toFixed(2)}`).toBe(true);
      expect(phases).toBe(BOSSES[id].phases.length - 1);
      expect(used.size).toBeGreaterThanOrEqual(3);
    },
    60_000,
  );
});

describe('elite affixes (integration)', () => {
  const scale = (affixes: readonly AffixId[]): EnemyScale =>
    enemyScaleFor(1, 'normal', undefined, affixes);
  const blow = {
    damage: 1,
    poise: 0,
    reaction: 'flinch' as const,
    knockback: 0,
    hitStopMs: 0,
    shake: 0,
    shape: { kind: 'circle' as const, radius: 20, forward: 0 },
  };

  it('Warded: the ward soaks blows until it shatters, then reforms after a quiet spell', () => {
    const plain = makeWorld();
    const a = plain.addEnemy(0, -3, 'brute', UNIT_SCALE);
    plain.step(stepsFor(1000));
    plain.combat.applyHit(plain.player, a, blow, 0, -1, { difficultyMod: 1 });
    const full = a.health.max - a.health.current;
    const w = makeWorld();
    const e = w.addEnemy(0, -3, 'brute', scale(['warded']));
    w.step(stepsFor(1000));
    w.combat.applyHit(w.player, e, blow, 0, -1, { difficultyMod: 1 });
    const soaked = e.health.max - e.health.current;
    expect(soaked).toBeLessThan(full * 0.5);
    let broken = 0;
    let reformed = 0;
    w.bus.on('enemy:affix', (ev) => {
      if (ev.kind === 'wardBroken') broken++;
      if (ev.kind === 'wardUp') reformed++;
    });
    for (let i = 0; i < 40 && e.wardHp > 0; i++)
      w.combat.applyHit(w.player, e, blow, 0, -1, { difficultyMod: 1 });
    expect(broken).toBe(1);
    expect(e.damageTakenMult()).toBe(1);
    w.player.god = true;
    w.step(stepsFor(7500));
    expect(reformed).toBe(1);
    expect(e.wardHp).toBeGreaterThan(0);
  });

  it('Bloodsworn: an enemy heals from the damage it deals', () => {
    const w = makeWorld();
    const e = w.addEnemy(0, -2, 'revenant', scale(['bloodsworn']));
    e.health.damage(e.health.max * 0.5);
    const before = e.health.current;
    w.combat.applyHit(e, w.player, blow, 0, 1, { difficultyMod: 1 });
    expect(e.health.current).toBeGreaterThan(before);
  });

  it('Cinderburst: a fallen enemy erupts under a hero who stays close', () => {
    const w = makeWorld();
    const e = w.addEnemy(0, -1.6, 'thrall', scale(['cinderburst']));
    w.step(stepsFor(1000));
    w.combat.applyHit(w.player, e, { ...blow, damage: 99 }, 0, -1, { difficultyMod: 1 });
    expect(e.health.dead).toBe(true);
    const hp = w.player.health.current;
    w.step(stepsFor(1300));
    expect(w.player.health.current).toBeLessThan(hp);
  });

  it('Frenzied: a boss hits harder and moves faster below 40% health, through its phases', () => {
    const w = makeWorld();
    w.player.god = true;
    const boss = w.addBoss('headsman', scale(['frenzied', 'quickened']));
    boss.bossBrain.beginFight();
    expect(boss.speedMult).toBeCloseTo(1.15);
    let frenzy = 0;
    w.bus.on('enemy:affix', (ev) => {
      if (ev.kind === 'frenzy') frenzy++;
    });
    boss.health.damage(boss.health.max * 0.65);
    w.combat.applyHit(w.player, boss, { ...blow, damage: 0.01 }, 0, -1, { difficultyMod: 1 });
    expect(frenzy).toBe(1);
    w.step(stepsFor(BOSSES.headsman.transitionMs + 100));
    const ph = BOSSES.headsman.phases[boss.bossBrain.phase];
    expect(boss.damageMult).toBeCloseTo((ph?.damageMult ?? 1) * 1.3);
    expect(boss.speedMult).toBeCloseTo((ph?.speedMult ?? 1) * 1.15 * 1.12);
  });

  it('Ironclad and Hulking fold into the spawn stats', () => {
    const w = makeWorld();
    const base = w.addEnemy(0, -3, 'brute', UNIT_SCALE);
    const tough = w.addEnemy(3, -3, 'brute', scale(['ironclad', 'hulking']));
    expect(tough.stats.def).toBe(Math.round(base.stats.def * 1.6));
    expect(tough.stats.maxHp).toBe(Math.round(base.stats.maxHp * 1.4));
  });
});
