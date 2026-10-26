/**
 * Rules of the repeatable modes (Dungeon, Demon Tower, Boss Challenge, Hunts, Arena) as pure functions:
 * stage generation, scaling, entry refills, rating changes, seasons and opponents. The App wires
 * them to battles and screens; tests call them directly.
 */
import { mulberry32 } from '../core/random';
import { BOSSES, type BossId } from '../data/bosses';
import type { StatBlock } from '../data/combatTypes';
import type { DifficultyId } from '../data/difficulty';
import type { EnemyId } from '../data/enemies';
import { HEROES, type HeroId } from '../data/heroes';
import { GEAR_SLOTS, type Rarity } from '../data/items';
import {
  ARENA_CONFIG,
  CHALLENGE_CONFIG,
  DUNGEON_CONFIG,
  HUNT_CONFIG,
  HUNT_OMENS,
  TOWER_CONFIG,
  type HuntOmenId,
} from '../data/modes';
import { SKILL_TREES } from '../data/skillTrees';
import { adventureFrontier, chaptersUpTo, findAdventureStage } from '../data/adventure';
import type { StageDef, WaveDef } from '../data/stages';
import { rollItem, type GearItem } from '../progression/gear';
import { computeHeroStats, powerRating } from '../progression/heroStats';
import type { ArenaState, DungeonState } from '../progression/profile';
import { computeMods, type HeroMods } from '../progression/skillTree';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const toWaves = (waves: readonly (readonly (readonly [EnemyId, number])[])[]): WaveDef[] =>
  waves.map((w) => ({
    spawns: w.map(([enemy, count]) => ({ enemy, count })),
    spawnIntervalMs: 450,
  }));

// ------------------------------------------------------------------ Dungeon

/** Adds the entries that refilled since the last tick (never above the cap). */
export function refillDungeon(d: DungeonState, nowMs: number): void {
  const period = DUNGEON_CONFIG.refillHours * HOUR_MS;
  if (d.entries >= DUNGEON_CONFIG.maxEntries) {
    d.refillAtMs = nowMs;
    return;
  }
  const elapsed = Math.max(0, nowMs - d.refillAtMs);
  const gained = Math.floor(elapsed / period);
  if (gained <= 0) return;
  d.entries = Math.min(DUNGEON_CONFIG.maxEntries, d.entries + gained);
  d.refillAtMs = d.entries >= DUNGEON_CONFIG.maxEntries ? nowMs : d.refillAtMs + gained * period;
}

/** Milliseconds until the next entry (0 when full). */
export function nextRefillInMs(d: DungeonState, nowMs: number): number {
  if (d.entries >= DUNGEON_CONFIG.maxEntries) return 0;
  const period = DUNGEON_CONFIG.refillHours * HOUR_MS;
  return Math.max(0, d.refillAtMs + period - nowMs);
}

/** Spends one entry; false if none are left. */
export function consumeDungeonEntry(d: DungeonState, nowMs: number): boolean {
  refillDungeon(d, nowMs);
  if (d.entries <= 0) return false;
  if (d.entries >= DUNGEON_CONFIG.maxEntries) d.refillAtMs = nowMs;
  d.entries--;
  return true;
}

/** Highest Adventure stage level cleared (any difficulty), 1 if none. */
export function highestClearedLevel(cleared: (stageId: string) => boolean): number {
  let best = 1;
  for (const c of chaptersUpTo(adventureFrontier(cleared)))
    for (const s of c.stages) if (cleared(s.id)) best = Math.max(best, s.level);
  return best;
}

/**
 * Plans a dungeon run: `roomsPerRun` rooms drawn in random order; the last room ends with an
 * elite (a defeated mini-boss) when one is available.
 */
export function planDungeon(
  rng: () => number,
  level: number,
  elites: readonly BossId[],
): StageDef[] {
  const pool = [...DUNGEON_CONFIG.rooms];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = pool[i];
    const b = pool[j];
    if (a !== undefined && b !== undefined) {
      pool[i] = b;
      pool[j] = a;
    }
  }
  const rooms = pool.slice(0, DUNGEON_CONFIG.roomsPerRun);
  return rooms.map((r, i): StageDef => {
    const last = i === rooms.length - 1;
    const elite = last && elites.length > 0 ? elites[Math.floor(rng() * elites.length)] : undefined;
    return {
      id: `dungeon_${i + 1}`,
      name: r.name,
      arena: r.arena,
      level: level + i,
      trainingDummy: false,
      introCountdownMs: 2000,
      waves: toWaves(r.waves),
      boss: elite ?? null,
      stars: { maxDamageTakenFrac: 1.2, parTimeSec: 180 },
      interWaveMs: 1800,
    };
  });
}

// ------------------------------------------------------------------ Tower

export function towerLevel(floor: number): number {
  return 1 + Math.floor(Math.max(1, floor) * TOWER_CONFIG.levelPerFloor);
}

export function towerEnemyMult(floor: number): { hp: number; atk: number } {
  return {
    hp: 1 + floor * TOWER_CONFIG.hpPerFloor,
    atk: 1 + floor * TOWER_CONFIG.atkPerFloor,
  };
}

export function isTowerBossFloor(floor: number): boolean {
  return floor > 0 && floor % TOWER_CONFIG.bossEvery === 0;
}

/** Deterministic floor layout (same floor → same fight). */
export function towerStage(floor: number): StageDef {
  const rng = mulberry32(9001 + floor * 7919);
  const allowed = TOWER_CONFIG.enemyUnlocks.filter((u) => u.floor <= floor).map((u) => u.enemy);
  const pick = (): EnemyId => allowed[Math.floor(rng() * allowed.length)] ?? 'thrall';
  const boss = isTowerBossFloor(floor)
    ? TOWER_CONFIG.bosses[(floor / TOWER_CONFIG.bossEvery - 1) % TOWER_CONFIG.bosses.length]
    : undefined;
  const waveCount = boss !== undefined ? 1 : 1 + Math.min(2, Math.floor(floor / 6));
  const perWave = 3 + Math.min(5, Math.floor(floor / 4));
  const waves: WaveDef[] = [];
  for (let w = 0; w < waveCount; w++) {
    const counts = new Map<EnemyId, number>();
    for (let i = 0; i < perWave; i++) {
      const e = pick();
      // Heavy enemies count double toward the wave size.
      if (e === 'brute' || e === 'bulwark') i++;
      counts.set(e, (counts.get(e) ?? 0) + 1);
    }
    waves.push({
      spawns: [...counts].map(([enemy, count]) => ({ enemy, count })),
      spawnIntervalMs: 400,
    });
  }
  const arenas = TOWER_CONFIG.arenas;
  return {
    id: `tower_${floor}`,
    name: boss !== undefined ? `Floor ${floor} — ${BOSSES[boss].name}` : `Floor ${floor}`,
    arena: arenas[floor % arenas.length] ?? 'cinder_court',
    level: towerLevel(floor),
    trainingDummy: false,
    introCountdownMs: 1800,
    waves,
    boss: boss ?? null,
    stars: { maxDamageTakenFrac: 1.2, parTimeSec: 120 + waveCount * 40 },
    interWaveMs: 1500,
  };
}

/** One-time reward for reaching a milestone floor, or null. */
export function towerMilestone(floor: number): { gems: number; tickets: number } | null {
  const n = TOWER_CONFIG.milestoneEvery;
  if (floor <= 0 || floor % n !== 0) return null;
  const k = floor / n;
  return { gems: TOWER_CONFIG.milestoneGems * k, tickets: TOWER_CONFIG.milestoneTickets * k };
}

// ------------------------------------------------------------------ Boss Challenge

export type ChallengeBoss = (typeof CHALLENGE_CONFIG.bosses)[number];

export function challengeMult(tier: number): { hp: number; atk: number } {
  return { hp: 1 + tier * CHALLENGE_CONFIG.hpPerTier, atk: 1 + tier * CHALLENGE_CONFIG.atkPerTier };
}

export function challengeStage(entry: ChallengeBoss, tier: number): StageDef {
  const base = findAdventureStage(entry.stage)?.level ?? 1;
  return {
    id: `challenge_${entry.boss}_${tier}`,
    name: `${BOSSES[entry.boss].name} · Tier ${tier}`,
    arena: entry.arena,
    level: base + tier * CHALLENGE_CONFIG.levelPerTier,
    trainingDummy: false,
    introCountdownMs: 1500,
    waves: [],
    boss: entry.boss,
    stars: { maxDamageTakenFrac: 1, parTimeSec: 150 + tier * 10 },
    interWaveMs: 1000,
  };
}

// ------------------------------------------------------------------ Hunts

export interface HuntDef {
  /** `day:slot` — unique per day, stored when the hunt is won. */
  readonly id: string;
  /** 1..perDay; later slots carry more omens and more gems. */
  readonly slot: number;
  readonly entry: ChallengeBoss;
  readonly omens: readonly HuntOmenId[];
  readonly level: number;
}

export function huntRank(completed: number): number {
  return Math.min(HUNT_CONFIG.maxRank, 1 + Math.floor(completed / HUNT_CONFIG.huntsPerRank));
}

/** Hunts completed toward the next rank, and how many that rank needs. */
export function huntRankProgress(completed: number): { done: number; need: number } {
  if (huntRank(completed) >= HUNT_CONFIG.maxRank) return { done: 1, need: 1 };
  return { done: completed % HUNT_CONFIG.huntsPerRank, need: HUNT_CONFIG.huntsPerRank };
}

/**
 * The day's board: `perDay` different bosses (from those the player has defeated in Adventure),
 * each with its own omens. Deterministic for a day, so the board survives app restarts.
 */
export function dailyHunts(
  day: number,
  unlocked: readonly ChallengeBoss[],
  rank: number,
  highestLevel: number,
): HuntDef[] {
  if (unlocked.length === 0) return [];
  const rng = mulberry32(day * 7919 + 17);
  const pool = [...unlocked];
  const omenIds = Object.keys(HUNT_OMENS) as HuntOmenId[];
  const out: HuntDef[] = [];
  for (let slot = 1; slot <= HUNT_CONFIG.perDay; slot++) {
    if (pool.length === 0) pool.push(...unlocked);
    const entry = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    if (entry === undefined) break;
    const n =
      HUNT_CONFIG.minOmens +
      Math.round(
        ((slot - 1) / Math.max(1, HUNT_CONFIG.perDay - 1)) *
          (HUNT_CONFIG.maxOmens - HUNT_CONFIG.minOmens),
      );
    const left = [...omenIds];
    const omens: HuntOmenId[] = [];
    for (let i = 0; i < n && left.length > 0; i++)
      omens.push(...left.splice(Math.floor(rng() * left.length), 1));
    const base = findAdventureStage(entry.stage)?.level ?? 1;
    out.push({
      id: `${day}:${slot}`,
      slot,
      entry,
      omens,
      level: Math.max(base, highestLevel - 2) + (rank - 1) * HUNT_CONFIG.levelPerRank,
    });
  }
  return out;
}

/** Combined omen multipliers (enemy stats and rewards). */
export function huntMult(h: HuntDef): { hp: number; atk: number; speed: number; reward: number } {
  let hp = 1;
  let atk = 1;
  let speed = 1;
  let reward = 1;
  for (const id of h.omens) {
    const o = HUNT_OMENS[id];
    hp *= o.hp;
    atk *= o.atk;
    speed *= o.speed;
    reward *= o.reward;
  }
  return { hp, atk, speed, reward };
}

export function huntStage(h: HuntDef): StageDef {
  const swarming = h.omens.some((id) => HUNT_OMENS[id].adds);
  const adds = findAdventureStage(h.entry.stage)?.waves[0];
  return {
    id: `hunt_${h.entry.boss}`,
    name: `Hunt · ${BOSSES[h.entry.boss].name}`,
    arena: h.entry.arena,
    level: h.level,
    trainingDummy: false,
    introCountdownMs: 1500,
    waves: swarming && adds !== undefined ? [adds] : [],
    boss: h.entry.boss,
    stars: { maxDamageTakenFrac: 1, parTimeSec: 180 },
    interWaveMs: 1500,
  };
}

/** Gold / XP / gems for winning a hunt (a replay of one already won today pays less). */
export function huntRewards(
  h: HuntDef,
  replay: boolean,
): { gold: number; xp: number; gems: number } {
  const m = huntMult(h).reward * (replay ? HUNT_CONFIG.replayShare : 1);
  return {
    gold: Math.round((HUNT_CONFIG.gold + HUNT_CONFIG.goldPerLevel * h.level) * m),
    xp: Math.round((HUNT_CONFIG.xp + HUNT_CONFIG.xpPerLevel * h.level) * m),
    gems: replay ? 0 : HUNT_CONFIG.gemsPerSlot * h.slot,
  };
}

// ------------------------------------------------------------------ Arena

export interface ArenaOpponent {
  readonly name: string;
  readonly heroId: HeroId;
  readonly level: number;
  readonly rating: number;
  readonly power: number;
  readonly stats: StatBlock;
  readonly mods: HeroMods;
}

/** Rating change for the player after a duel (positive on a win, negative on a loss). */
export function ratingChange(player: number, opponent: number, won: boolean): number {
  const c = ARENA_CONFIG;
  const diff = (opponent - player) / c.ratingSpread;
  const raw = won ? c.winBase + diff : -(c.lossBase - diff);
  const mag = Math.min(c.maxChange, Math.max(c.minChange, Math.abs(raw)));
  return Math.round(won ? mag : -mag);
}

function rarityForRating(rating: number, rng: () => number): Rarity {
  const t = rating + (rng() - 0.5) * 200;
  if (t > 1550) return 'mythic';
  if (t > 1350) return 'legendary';
  if (t > 1180) return 'epic';
  if (t > 1000) return 'rare';
  return 'common';
}

/** Builds an opponent hero (level, gear, skills) whose power lands near `targetPower`. */
export function buildOpponent(
  rng: () => number,
  name: string,
  heroId: HeroId,
  rating: number,
  targetPower: number,
): ArenaOpponent {
  const def = HEROES[heroId];
  const skillT = Math.min(0.9, Math.max(0.1, (rating - 800) / 900));
  const ranks: Record<string, number> = {};
  for (const n of SKILL_TREES[heroId]) {
    const r = Math.round(n.maxRank * skillT * (0.6 + rng() * 0.6));
    if (r > 0) ranks[n.id] = Math.min(n.maxRank, r);
  }
  const mods = computeMods(SKILL_TREES[heroId], ranks);
  let best: { level: number; stats: StatBlock; power: number } | null = null;
  const rarities = GEAR_SLOTS.map(() => rarityForRating(rating, rng));
  const gearRng = mulberry32(Math.floor(rng() * 2 ** 31) | 1);
  const seed = Math.floor(gearRng() * 2 ** 31) | 1;
  // Search level × number of equipped slots for the closest power (low targets wear less gear).
  search: for (let level = 1; level <= 50; level++) {
    for (let slots = 0; slots <= GEAR_SLOTS.length; slots++) {
      const g = mulberry32(seed);
      const gear: GearItem[] = GEAR_SLOTS.slice(0, slots).map((slot, i) =>
        rollItem(g, i + 1, slot, rarities[i] ?? 'common', level),
      );
      const stats = computeHeroStats(def, level, gear, mods);
      const power = powerRating(stats);
      if (best === null || Math.abs(power - targetPower) < Math.abs(best.power - targetPower))
        best = { level, stats, power };
      if (power > targetPower && slots === 0) break search;
      if (power > targetPower) break;
    }
  }
  const b = best ?? { level: 1, stats: def.stats, power: powerRating(def.stats) };
  return { name, heroId, level: b.level, rating, power: b.power, stats: b.stats, mods };
}

/** Three opponents around the player's rating and power (deterministic for a seed). */
export function generateOpponents(
  seed: number,
  playerRating: number,
  playerPower: number,
): ArenaOpponent[] {
  const rng = mulberry32(seed);
  const c = ARENA_CONFIG;
  const heroes = Object.keys(HEROES) as HeroId[];
  const out: ArenaOpponent[] = [];
  const used = new Set<string>();
  for (let i = 0; i < c.opponents; i++) {
    // Easy / even / hard: spread across the rating window.
    const offset = ((i - (c.opponents - 1) / 2) / ((c.opponents - 1) / 2 || 1)) * c.ratingRange;
    const rating = Math.max(400, Math.round(playerRating + offset + (rng() - 0.5) * 40));
    const [lo, hi] = c.powerRange;
    const t = c.opponents > 1 ? i / (c.opponents - 1) : 0.5;
    const power = playerPower * (lo + (hi - lo) * t);
    let name = c.names[Math.floor(rng() * c.names.length)] ?? 'Shade';
    while (used.has(name)) name = c.names[Math.floor(rng() * c.names.length)] ?? `${name}′`;
    used.add(name);
    const hero = heroes[Math.floor(rng() * heroes.length)] ?? 'kael';
    out.push(buildOpponent(rng, name, hero, rating, power));
  }
  return out;
}

export interface SeasonResult {
  readonly season: number;
  readonly finalRating: number;
  readonly label: string;
  readonly gems: number;
  readonly tickets: number;
}

/** Ends every season that has elapsed: soft-resets the rating and returns the rewards earned. */
export function settleSeasons(a: ArenaState, nowMs: number): SeasonResult[] {
  const c = ARENA_CONFIG;
  const length = c.seasonDays * DAY_MS;
  const out: SeasonResult[] = [];
  while (nowMs - a.seasonStartMs >= length) {
    const tier = [...c.seasonRewards].reverse().find((t) => a.rating >= t.minRating);
    out.push({
      season: a.season,
      finalRating: a.rating,
      label: tier?.label ?? 'Ash',
      gems: tier?.gems ?? 0,
      tickets: tier?.tickets ?? 0,
    });
    a.rating = Math.round(c.startRating + (a.rating - c.startRating) * c.seasonSoftReset);
    a.season++;
    a.seasonStartMs += length;
    a.streak = 0;
    a.opponentSeed = (a.opponentSeed * 48271 + 1) % 2147483647 || 1;
  }
  return out;
}

export function seasonEndsInMs(a: ArenaState, nowMs: number): number {
  return Math.max(0, a.seasonStartMs + ARENA_CONFIG.seasonDays * DAY_MS - nowMs);
}

export interface LeaderboardEntry {
  readonly name: string;
  readonly rating: number;
  readonly you: boolean;
}

/** Local season leaderboard: generated rivals (stable per season) plus the player. */
export function leaderboard(season: number, playerRating: number): LeaderboardEntry[] {
  const rng = mulberry32(31337 + season * 101);
  const c = ARENA_CONFIG;
  const entries: LeaderboardEntry[] = [];
  for (let i = 0; i < c.leaderboardSize - 1; i++) {
    const name = c.names[i % c.names.length] ?? 'Shade';
    const rating = Math.round(900 + rng() * 700 + i * 3);
    entries.push({ name: i >= c.names.length ? `${name} II` : name, rating, you: false });
  }
  entries.push({ name: 'You', rating: playerRating, you: true });
  return entries.sort((x, y) => y.rating - x.rating);
}

/** Season reward tier label for a rating. */
export function rankLabel(rating: number): string {
  const tier = [...ARENA_CONFIG.seasonRewards].reverse().find((t) => rating >= t.minRating);
  return tier?.label ?? 'Ash';
}

export const DIFFICULTY_LIST: readonly DifficultyId[] = ['normal', 'hard', 'nightmare'];
